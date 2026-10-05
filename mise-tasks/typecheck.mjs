import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(".");
const cache = resolve(".factorio-test");
await mkdir(cache, { recursive: true });
let child = Bun.spawn(["uv", "run", "--no-project", "python", "-B", "mise-tasks/prepare-types.py"], { stdout: "inherit", stderr: "inherit" });
if (await child.exited) process.exit(child.exitCode);
const report = resolve(cache, "typecheck.json");
child = Bun.spawn([resolve(cache, "tools/emmylua_check"), root, "-c", resolve(".emmyrc.json"), "-f", "json", "--output", report, "--warnings-as-errors", "--severity", "warn"], { stdout: "inherit", stderr: "inherit" });
const code = await child.exited;
const files = JSON.parse(await readFile(report, "utf8"));
for (const file of files) for (const issue of file.diagnostics) console.error(`${file.file.replace(`${root}/`, "")}:${issue.range.start.line + 1}: ${issue.code}: ${issue.message}`);
if (code) process.exit(code);
// Prove that the configured API library diagnoses an invalid real-engine call.
const probe = resolve(root, "typecheck-probe.lua");
try {
  await writeFile(probe, 'local surface = game.surfaces[1]\nif surface then surface.create_entity({name="transport-belt", position="invalid-position"}) end\n');
  child = Bun.spawn([resolve(cache, "tools/emmylua_check"), root, "-c", resolve(".emmyrc.json"), "-f", "json", "--output", resolve(cache, "typecheck-probe.json"), "--warnings-as-errors", "--severity", "warn"], { stdout: "pipe", stderr: "pipe" });
  const probeCode = await child.exited;
  const diagnostics = JSON.parse(await readFile(resolve(cache, "typecheck-probe.json"), "utf8"));
  if (!probeCode || !diagnostics.some(file => file.file === probe && file.diagnostics.some(issue => ["param-type-mismatch", "assign-type-mismatch"].includes(issue.code)))) throw new Error("Type checker failed to detect the invalid Factorio API probe");
} finally {
  const { unlink } = await import("node:fs/promises");
  await unlink(probe);
}
console.log(`Factorio API type check passed (${files.length} source files; invalid-call probe rejected).`);
