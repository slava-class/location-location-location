import { $ } from "bun";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { homedir } from "node:os";
import { readdir, stat, mkdir, realpath } from "node:fs/promises";
import { parseArgs } from "node:util";
import { root, sha256 } from "./lib.mjs";
import { loadContent } from "./content.mjs";
import { readFlags, corpusInventory, auditScope, requireValue } from "./audit-model.mjs";

const modes = new Set(["corpus", "flags", "progress", "scope"]);
const mode = process.argv[2];
const { values } = parseArgs({ args: process.argv.slice(3), options: {
  profile: { type: "string", default: resolve(homedir(), "Library/Application Support/factorio") },
  log: { type: "string" }, reference: { type: "string", default: "content/reference-context.json" },
  families: { type: "string", default: "content/audit-families.json" },
  save: { type: "string", default: "latest" },
  "since-report": { type: "string" },
  out: { type: "string", default: ".factorio-test/audits" },
} });
requireValue(modes.has(mode), "Usage: mise run corpus:check | flags:read | audit:progress | audit:scope -- [--profile PATH] [--log PATH] [--save latest|PATH] [--since-report REPORT.json] [--reference PATH] [--families PATH] [--out REPO_DIRECTORY]");
const profile = resolve(values.profile);
const output = resolve(root, values.out);
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith("../") && !isAbsolute(path);
};
requireValue((inside(resolve(root, "audits"), output) || output === resolve(root, "audits") || inside(resolve(root, ".factorio-test"), output)) &&
  !inside(profile, output), "Audit output must be under this repository's audits/ or .factorio-test/, outside the Factorio profile");
// Resolve the nearest existing ancestor before mkdir, not after a symlink escape.
const realRoot = await realpath(root);
let ancestor = output;
while (true) {
  try {
    const actual = await realpath(ancestor);
    requireValue(actual === realRoot || inside(realRoot, actual), "Audit output escapes the repository through a symlink");
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    ancestor = dirname(ancestor);
  }
}
await mkdir(output, { recursive: true });

async function stableBytes(path) {
  const before = await stat(path, { bigint: true });
  const bytes = await Bun.file(path).bytes();
  const after = await stat(path, { bigint: true });
  requireValue(before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs, `Input changed while reading: ${path}`);
  return { path, bytes, sha256: sha256(bytes), mtimeUtc: new Date(Number(after.mtimeMs)).toISOString() };
}
const identity = ({ path, bytes, sha256: digest, mtimeUtc }) => ({ path, bytes: bytes.length, sha256: digest, mtimeUtc });
async function writeReport(name, report) {
  const path = resolve(output, `${name}.json`);
  // An existing report symlink must not redirect a write into the profile.
  try { requireValue((await realpath(path)) === path, `Refusing symlinked report: ${path}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await Bun.write(path, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report: ${path}`);
}
async function latestSave() {
  const directory = resolve(profile, "saves");
  const candidates = await Promise.all((await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith(".zip"))
    .map(async entry => { const path = resolve(directory, entry.name); return { path, mtime: (await stat(path, { bigint: true })).mtimeNs }; }));
  candidates.sort((a, b) => a.mtime === b.mtime ? a.path.localeCompare(b.path) : a.mtime > b.mtime ? -1 : 1);
  requireValue(candidates.length, `No saves found in ${directory}`);
  return candidates[0].path;
}
function markdown(report) {
  const cell = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("|", "\\|").replaceAll("`", "\\`").replaceAll("\n", "<br>");
  const rows = report.seeds.map(seed => `| ${seed.line} | ${cell(seed.record.target.id)} | ${seed.record.reason} | ${cell(seed.families.join(", ") || "UNRESOLVED")} | ${cell(seed.record.note)} |`);
  return ["# Flag scope readback", "", `Status: **${report.status}**. This is a mechanical inventory, not a completed quality review.`, "",
    `Flags: ${report.inputs.flags.path}; ${report.flags.records} total records, ${report.summary.flags} selected; SHA256 ${report.flags.sha256}.`,
    `Progression: ${report.progress.save}; SHA256 ${report.progress.saveSha256}; ${report.progress.saveMtimeUtc}.`, "",
    "| Log line | Qualified target | Reason | Reviewed family | Player note |", "| --- | --- | --- | --- | --- |", ...rows, "",
    "## Scope", "", ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value ?? "unknown"}`), "",
    "## Evidence issues", "", ...(report.issues.length ? report.issues.map(issue => `- ${cell(JSON.stringify(issue))}`) : ["No unresolved scope identities or version mismatches were found in this run."]), "",
    "## Limits", "", ...report.limits.map(limit => `- ${limit}`), "",
    "Exact recipes, ingredients/products, all technology prerequisites, upgrade-choice packages, conditional-note eligibility and existing paragraphs to review are in scope.json. The player's original log is not modified or acknowledged by this command.", "",
  ].join("\n");
}

const inputs = {};
let content, corpus, progress;
if (mode === "corpus" || mode === "scope") {
  for (const name of ["catalog", "sources", "game-sources"]) inputs[name] = identity(await stableBytes(resolve(root, `content/${name}.json`)));
  // The existing validator remains the sole budget/citation/generated-file boundary.
  await $`bun ${resolve(root, "mise-tasks/content.mjs")} check`.cwd(root);
  content = await loadContent();
  corpus = corpusInventory(content);
  await writeReport("corpus", { schemaVersion: 1, inputs, ...corpus });
  console.log(`Corpus: ${corpus.notes} notes / ${corpus.targets} targets; ${corpus.editorialSignals.length} editorial review signals.`);
}
if (mode === "progress" || mode === "scope") {
  const save = values.save === "latest" ? await latestSave() : resolve(values.save);
  progress = await $`uv run --no-project python -B ${resolve(root, "mise-tasks/read-save.py")} ${save}`.cwd(root).quiet().json();
  await writeReport("progress", { schemaVersion: 1, ...progress });
  console.log(`Save: ${progress.save}; ${progress.saveSha256}; ${progress.saveMtimeUtc}`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(progress.forces).map(([force, state]) =>
    [force, { researched: state.researchedTechnologies.length, enabledRecipes: state.enabledRecipes.length }]))));
}
if (mode === "flags" || mode === "scope") {
  const log = await stableBytes(values.log ? resolve(values.log) : resolve(profile, "script-output/py-research-dossier/flags.jsonl"));
  inputs.flags = identity(log);
  let previous = null;
  if (values["since-report"]) {
    const receipt = await stableBytes(resolve(values["since-report"]));
    const report = JSON.parse(new TextDecoder().decode(receipt.bytes));
    requireValue(report.schemaVersion === 1 && report.flags, "--since-report must name a prior flags.json or scope.json receipt");
    previous = report.flags;
    inputs.previousReport = identity(receipt);
  }
  const flags = readFlags(log.bytes, previous);
  await writeReport("flags", { schemaVersion: 1, inputs, flags: flags.receipt, since: flags.since, records: flags.records });
  for (const { line, record } of flags.records) console.log(`${line}: ${record.reason} ${record.target.id}${record.note ? ` — ${JSON.stringify(record.note)}` : ""}`);
  if (mode === "scope") {
    const reference = await stableBytes(resolve(root, values.reference));
    const familyFile = await stableBytes(resolve(root, values.families));
    inputs.reference = identity(reference);
    inputs.families = identity(familyFile);
    const context = JSON.parse(new TextDecoder().decode(reference.bytes));
    const families = JSON.parse(new TextDecoder().decode(familyFile.bytes));
    const report = auditScope({ flags, content, context, families, progress });
    report.inputs = inputs;
    report.referenceEvidence = { sourceSave: context.sourceSave, provenance: context.provenance };
    report.progress = progress;
    report.corpus = corpus;
    await writeReport("scope", report);
    const markdownPath = resolve(output, "scope.md");
    try { requireValue((await realpath(markdownPath)) === markdownPath, "Refusing symlinked Markdown output"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await Bun.write(markdownPath, markdown(report));
    console.log(`${report.status}: ${JSON.stringify(report.summary)}`);
    if (report.issues.length) process.exitCode = 2;
  }
}
// A writer can append after our snapshot. Preserve its work; report the bounded read,
// never truncate or mark the source log as consumed.
for (const name of ["catalog", "sources", "game-sources"].filter(name => inputs[name])) {
  requireValue(sha256(await Bun.file(inputs[name].path).bytes()) === inputs[name].sha256, `Corpus changed during audit: ${name}; rerun against a coherent revision`);
}
