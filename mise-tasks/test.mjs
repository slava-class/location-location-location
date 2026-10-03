import {readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {prepareProfile} from "./factorio-env.mjs";
const profile = process.argv[2] || "base";
if (!["base", "space-age"].includes(profile)) throw new Error("Choose base or space-age");
const context = await prepareProfile(profile);
try {
  console.log(`Factorio ${context.engine.version}; FactorioTest ${profile} suite`);
  const child = Bun.spawn(["bun", "node_modules/factorio-test-cli/cli.js", "run", "--config", join(context.directory, "runner.json"), "--quiet"], {stdout: "pipe", stderr: "pipe", env: {...process.env, SteamAppId: "427520", SteamGameId: "427520"}});
  const pump = async stream => {
    let output = "";
    for await (const chunk of stream) { const text = Buffer.from(chunk).toString(); output += text; process.stdout.write(text); }
    return output;
  };
  const output = await Promise.all([pump(child.stdout), pump(child.stderr)]);
  const code = await child.exited;
  await writeFile(join(context.directory, "console.log"), output.join("\n"));
  if (code) throw new Error(`FactorioTest ${profile} failed (${code}); inspect ${context.directory}/console.log and factorio-current.log`);
  const result = JSON.parse(await readFile(context.config.outputFile, "utf8"));
  if (result.summary?.status !== "passed" || !result.summary.passed || result.summary.failed || result.summary.describeBlockErrors || result.summary.cancelled || result.summary.todo) throw new Error("FactorioTest returned no passing suite or reported failures");
  await writeFile(resolve(".factorio-test", `results-${profile}.json`), JSON.stringify(result, null, 2));
  console.log(`Results: ${context.config.outputFile}`);
} finally { await context.release(); }
