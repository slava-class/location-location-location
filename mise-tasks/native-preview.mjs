import {readFile, writeFile, unlink, readdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {prepareProfile, normalizeLocale} from "./factorio-env.mjs";

export function ownedNativePid(processList, executable, directory) {
  const argument = (command, flag, path) => command.includes(`${flag} ${path} `) || command.endsWith(`${flag} ${path}`);
  const matching = processList.split("\n").filter(line => {
    const command = line.trim().replace(/^\d+\s+/, "");
    return command.startsWith(executable + " ") && argument(command, "--mod-directory", join(directory, "mods")) && argument(command, "-c", join(directory, "config.ini"));
  });
  if (matching.length > 1) throw new Error("Multiple processes own this exact native profile; refusing cleanup");
  return matching.length ? Number(matching[0].trim().split(/\s+/)[0]) : undefined;
}
export function nativeResults(log) {
  const tests = [];
  for (const line of log.split("\n")) {
    const match = line.match(/\b(PASS|FAIL) ((?:tests\.native_preview > )?native UI gallery > \d{2} [a-z-]+)/);
    if (match) tests.push({path: match[2], result: match[1] === "PASS" ? "passed" : "failed"});
  }
  return tests;
}
async function main() {
  const language = normalizeLocale(process.argv[2] || "en");
  const context = await prepareProfile("native", language);
  const marker = join(context.directory, "script-output/native-preview-complete.txt");
  let child, output = "";
  const stopNative = () => {
    const list = spawnSync("ps", ["-ax", "-o", "pid=,command="], {encoding: "utf8"});
    if (list.status !== 0) throw new Error("Cannot inspect native process ownership for cleanup");
    const nativePid = ownedNativePid(list.stdout, context.engine.executable, context.directory);
    if (nativePid) process.kill(nativePid, "SIGTERM");
  };
  try {
    await unlink(marker).catch(error => {if (error.code !== "ENOENT") throw error;});
    await unlink(join(context.directory, "script-output/native-preview.jsonl")).catch(error => {if (error.code !== "ENOENT") throw error;});
    await rm(join(context.directory, "script-output/release-ui"), {recursive: true, force: true});
    await unlink(join(context.directory, "native-suite-results.json")).catch(error => {if (error.code !== "ENOENT") throw error;});
    // Remove the previous preview generator's owned copy; the CLI now symlinks source.
    const info = JSON.parse(await readFile("info.json", "utf8"));
    await rm(join(context.directory, "mods", `${info.name}_${info.version}`), {recursive: true, force: true});
    // Run unmodified source through the canonical CLI and actual tagged suites.
    child = Bun.spawn(["bun", "node_modules/factorio-test-cli/cli.js", "run", "--graphics", "--config", join(context.directory, "runner.json"), "--quiet"], {
      env: {...process.env, SteamAppId: "427520", SteamGameId: "427520"}, stdout: "pipe", stderr: "pipe"});
    const pump = async stream => {for await (const chunk of stream) output += Buffer.from(chunk).toString();};
    const streams = Promise.all([pump(child.stdout), pump(child.stderr)]);
    const deadline = Date.now() + 180000;
    let completed = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`FactorioTest graphics exited early (${child.exitCode})`);
      try { await readFile(marker); completed = true; break; } catch (error) {if (error.code !== "ENOENT") throw error;}
      await Bun.sleep(500);
    }
    if (!completed) throw new Error("FactorioTest graphics timed out before its after_all completion hook");
    // Graphics deliberately stays open: flush screenshots and the canonical result,
    // then close only the engine whose command identifies this exact profile.
    await Bun.sleep(2000);
    stopNative();
    const code = await child.exited;
    await streams;
    await writeFile(join(context.directory, "console.log"), output);
    if (code) throw new Error(`FactorioTest native suite failed (${code})`);
    // CLI 3.6 emits structured events only headlessly. Use real framework log records
    // for graphics results; screenshot existence never implies a passing assertion.
    const log = await readFile(join(context.directory, "factorio-current.log"), "utf8");
    const tests = nativeResults(log);
    if (tests.length !== 9 || new Set(tests.map(test => test.path)).size !== 9 || tests.some(test => test.result !== "passed")) throw new Error(`Expected nine actual FactorioTest passes, found ${tests.length}; inspect factorio-current.log`);
    const images = (await readdir(join(context.directory, "script-output/release-ui"))).filter(name => name.endsWith(".png"));
    if (images.length !== 9) throw new Error(`Expected nine freshly rendered scenes, found ${images.length}`);
    await writeFile(join(context.directory, "native-suite-results.json"), JSON.stringify({framework: "FactorioTest 3.1.0", locale: language, engine: context.engine.version, summary: {passed: 9, failed: 0}, tests, screenshots: images.sort()}, null, 2));
    console.log(`FactorioTest native UI (${language}): 9 passed; ${context.directory}/script-output/release-ui`);
  } catch (error) {
    console.error(output.slice(-6000));
    throw new Error(`${error.message}\nInspect ${context.directory}/console.log and factorio-current.log`, {cause: error});
  } finally {
    if (child && child.exitCode === null) {stopNative(); child.kill("SIGTERM"); await child.exited;}
    await writeFile(join(context.directory, "console.log"), output);
    await context.release();
  }
}
if (import.meta.main) await main();
