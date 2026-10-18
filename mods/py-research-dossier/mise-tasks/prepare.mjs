import { resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import luaparse from "luaparse";
import { root, sha256 } from "./lib.mjs";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  mods: { type: "string", default: resolve(homedir(), "Library/Application Support/factorio/mods") },
  base: { type: "string", default: resolve(homedir(), "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data/base") },
} });
const game = await Bun.file(resolve(root, "content/game-sources.json")).json();
const manifest = { mods: {}, files: {} };
const baseInfo = await Bun.file(resolve(values.base, "info.json")).json();
if (baseInfo.name !== "base" || baseInfo.version !== game.reviewedBase.version) throw new Error("Unreviewed base source version; review content/game-sources.json explicitly");
manifest.mods.base = { version: baseInfo.version };
async function member(mod, path) {
  if (mod === "base") return Bun.file(resolve(values.base, path)).text();
  const reviewed = game.reviewedMods[mod];
  const process = Bun.spawn(["unzip", "-p", resolve(values.mods, reviewed.archive), `${reviewed.root}/${path}`], { stdout: "pipe", stderr: "pipe" });
  const [text, error, status] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (status !== 0) throw new Error(`Cannot read ${mod}/${path}: ${error}`);
  return text;
}
for (const [name, reviewed] of Object.entries(game.reviewedMods)) {
  const bytes = await Bun.file(resolve(values.mods, reviewed.archive)).bytes();
  if (sha256(bytes) !== reviewed.sha256) throw new Error(`${reviewed.archive}: unreviewed source checksum; review and update content/game-sources.json explicitly`);
  const info = JSON.parse(await member(name, "info.json"));
  if (info.name !== name || info.version !== reviewed.version) throw new Error(`Unexpected identity: ${reviewed.archive}`);
  manifest.mods[name] = { version: info.version, sha256: reviewed.sha256 };
}
for (const [id, file] of Object.entries(game.files)) {
  const source = await member(file.mod, file.path);
  if (file.mod === "base" && sha256(source) !== file.sha256) throw new Error(`${file.path}: unreviewed base source checksum`);
  manifest.files[id] = { ...file, sha256: sha256(source) };
  if (id !== "py-description-helper") continue;
  const ast = luaparse.parse(source, { luaVersion: "5.2", ranges: true });
  const assignments = ast.body.filter(node => node.type === "AssignmentStatement" && node.variables.length === 1 && node.variables[0].type === "MemberExpression" && node.variables[0].base.name === "py" && node.variables[0].identifier.name === "add_to_description");
  if (assignments.length !== 1 || assignments[0].init[0].type !== "FunctionDeclaration") throw new Error("Py text helper changed shape; review it before updating the harness");
  const [start, end] = assignments[0].range;
  const helper = source.slice(start, end) + "\n";
  manifest.helperSha256 = sha256(helper);
  await Bun.write(resolve(root, ".factorio-test/py-add-to-description.lua"), helper);
}
await Bun.write(resolve(root, ".factorio-test/source-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Prepared actual Py helper from ${game.reviewedMods.pypostprocessing.archive}; fingerprinted ${Object.keys(manifest.files).length} reviewed source files. No game launched.`);
