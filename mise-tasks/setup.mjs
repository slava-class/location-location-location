import {readFile, mkdir} from "node:fs/promises";
const expected = JSON.parse(await readFile("package.json", "utf8")).devDependencies;
let ready = true;
for (const [name, version] of Object.entries(expected)) {
  try { ready &&= JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")).version === version; }
  catch { ready = false; }
}
try { ready &&= (await readFile("node_modules/factorio-test-cli/factorio-process.js", "utf8")).includes("}, 120_000);"); }
catch { ready = false; }
if (!ready) {
  await mkdir(".factorio-test/tmp", {recursive: true});
  await mkdir(".factorio-test/bun-cache", {recursive: true});
  const child = Bun.spawn(["bun", "install", "--frozen-lockfile"], {stdout: "inherit", stderr: "inherit",
    env: {...process.env, TMPDIR: `${process.cwd()}/.factorio-test/tmp`, BUN_INSTALL_CACHE_DIR: `${process.cwd()}/.factorio-test/bun-cache`}});
  if (await child.exited) process.exit(child.exitCode);
}
const {ensureDependencies} = await import("./factorio-env.mjs");
await ensureDependencies();
console.log("Pinned FactorioTest 3.1.0, CLI 3.6.0, FMTK 2.1.9 and flib 0.17.2 ready.");
