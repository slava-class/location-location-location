import {mkdir, writeFile, copyFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {ensureDependencies, resolveEngine, profileConfig} from "./factorio-env.mjs";
import {readInfo} from "./release-info.mjs";
const engine = await resolveEngine();
const dependencies = await ensureDependencies();
const info = await readInfo(resolve("."));
const archive = `${info.name}_${info.version}.zip`;
for (const profile of ["base", "space-age"]) {
  const directory = resolve(".factorio-test/package-smoke", info.version, profile);
  const mods = join(directory, "mods");
  await mkdir(mods, {recursive: true});
  await copyFile(resolve(archive), join(mods, archive));
  await copyFile(join(dependencies, "flib_0.17.2.zip"), join(mods, "flib_0.17.2.zip"));
  const builtin = profileConfig(profile, directory, engine).mods.map(spec => {const [name, value] = spec.split("="); return {name, enabled: value === "true"};});
  await writeFile(join(mods, "mod-list.json"), JSON.stringify({mods: [{name: "base", enabled: true}, {name: "flib", enabled: true}, {name: info.name, enabled: true}, {name: "factorio-test", enabled: false}, ...builtin]}, null, 2));
  await writeFile(join(directory, "config.ini"), `[path]\nread-data=${engine.readData}\nwrite-data=${directory}\n[general]\nlocale=en\n[other]\ncheck-updates=false\n`);
  const child = Bun.spawn([engine.executable, "--benchmark", resolve("node_modules/factorio-test-cli/headless-save.zip"), "--benchmark-ticks", "10", "--benchmark-runs", "1", "--mod-directory", mods, "-c", join(directory, "config.ini")], {stdout: "pipe", stderr: "pipe", env: {...process.env, SteamAppId: "427520", SteamGameId: "427520"}});
  const timeout = setTimeout(() => child.kill("SIGTERM"), 120000);
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timeout);
  await writeFile(join(directory, "console.log"), stdout + stderr);
  if (code || !stdout.includes("Performed 10 updates")) throw new Error(`Packaged ${profile} smoke failed (${code}); inspect ${directory}/console.log`);
  console.log(`Packaged ${profile}: loaded ${archive} with FactorioTest disabled; 10 engine updates completed.`);
}
