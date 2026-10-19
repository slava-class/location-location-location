import { Console, Effect, FileSystem, Schema } from "effect";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AbsolutePath } from "../../../tools/contracts.ts";
import { hashFile } from "../../../tools/files.ts";
import { readSavedProgress } from "./read-save.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  contains,
  decode,
  decodeJSON,
  prepareOutputDirectory,
} from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import { compileContent } from "./content.ts";
import type { loadContent } from "./content.ts";
import {
  Families,
  FlagReadback,
  ReferenceContext,
  SaveReadback,
} from "./contracts.ts";
import {
  CorpusInventory,
  CorpusReport,
  FlagsReport,
  InputIdentity,
  PreviousReport,
  ProgressReport,
  ScopeReport,
} from "./reports.ts";
import { auditScope, corpusInventory, readFlags } from "./audit-model.mjs";
import { sha256 } from "./lib.mjs";

export const AuditMode = Schema.Literals([
  "corpus",
  "flags",
  "progress",
  "scope",
]);
const AuditOptions = Schema.Struct({
  mode: AuditMode,
  profile: AbsolutePath,
  out: AbsolutePath,
  save: Schema.Union([Schema.Literal("latest"), AbsolutePath]),
  reference: AbsolutePath,
  families: AbsolutePath,
  log: Schema.optionalKey(AbsolutePath),
  sinceReport: Schema.optionalKey(AbsolutePath),
});
function model<A>(boundary: string, work: () => A) {
  return Effect.try({
    try: work,
    catch: (error) => new BoundaryError({ boundary, message: String(error) }),
  });
}
function stableBytes(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const inspect = () =>
      Effect.tryPromise({
        try: () => stat(path, { bigint: true }),
        catch: (error) =>
          new BoundaryError({ boundary: path, message: String(error) }),
      });
    const before = yield* inspect();
    const bytes = yield* fs.readFile(path);
    const after = yield* inspect();
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message: "Input changed while reading",
        }),
      );
    const identity = yield* decode(
      InputIdentity,
      {
        path,
        bytes: bytes.length,
        sha256: sha256(bytes),
        mtimeUtc: new Date(Number(after.mtimeMs)).toISOString(),
      },
      path,
    );
    return { bytes, identity };
  });
}
function latestSave(profile: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = join(profile, "saves");
    const candidates = [];
    for (const name of yield* fs.readDirectory(directory)) {
      if (!name.endsWith(".zip")) continue;
      const path = join(directory, name);
      const info = yield* Effect.tryPromise({
        try: () => stat(path, { bigint: true }),
        catch: (error) =>
          new BoundaryError({ boundary: path, message: String(error) }),
      });
      if (info.isFile()) candidates.push({ path, mtime: info.mtimeNs });
    }
    candidates.sort((a, b) =>
      a.mtime === b.mtime
        ? a.path.localeCompare(b.path)
        : a.mtime > b.mtime
          ? -1
          : 1,
    );
    if (!candidates[0])
      return yield* Effect.fail(
        new BoundaryError({ boundary: directory, message: "No saves found" }),
      );
    return candidates[0].path;
  });
}
export function auditCorpus(project: ResolvedProject) {
  return Effect.gen(function* () {
    const { content } = yield* compileContent(project, "check");
    const corpus = yield* decode(
      CorpusInventory,
      corpusInventory(content),
      "corpus inventory",
    );
    return { content, corpus };
  });
}
function markdown(report: typeof ScopeReport.Type) {
  const cell = (value: unknown) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll("|", "\\|")
      .replaceAll("`", "\\`")
      .replaceAll("\n", "<br>");
  const rows = report.seeds.map(
    (seed) =>
      `| ${seed.line} | ${cell(seed.record.target.id)} | ${seed.record.reason} | ${cell(seed.families.join(", ") || "UNRESOLVED")} | ${cell(seed.record.note)} |`,
  );
  return [
    "# Flag scope readback",
    "",
    `Status: **${report.status}**. This is a mechanical inventory, not a completed quality review.`,
    "",
    `Flags: ${report.inputs.flags!.path}; ${report.flags.records} total records, ${report.summary.flags} selected; SHA256 ${report.flags.sha256}.`,
    `Progression: ${report.progress.save}; SHA256 ${report.progress.saveSha256}; ${report.progress.saveMtimeUtc}.`,
    "",
    "| Log line | Qualified target | Reason | Reviewed family | Player note |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Scope",
    "",
    ...Object.entries(report.summary).map(
      ([key, value]) => `- ${key}: ${value ?? "unknown"}`,
    ),
    "",
    "## Evidence issues",
    "",
    ...(report.issues.length
      ? report.issues.map((issue) => `- ${cell(JSON.stringify(issue))}`)
      : [
          "No unresolved scope identities or version mismatches were found in this run.",
        ]),
    "",
    "## Limits",
    "",
    ...report.limits.map((limit) => `- ${limit}`),
    "",
    "Exact recipes, ingredients/products, all technology prerequisites, upgrade-choice packages, conditional-note eligibility and existing paragraphs to review are in scope.json. The player's original log is not modified or acknowledged by this command.",
    "",
  ].join("\n");
}
export function runAudit(project: ResolvedProject, input: unknown) {
  return Effect.gen(function* () {
    const options = yield* decode(AuditOptions, input, "offline audit options");
    const { mode, profile, out } = options;
    yield* assertCanonicalPath(profile);
    if (!contains(project.outputRoot, out) || contains(profile, out))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: out,
          message:
            "Audit output must stay inside this product's ignored output directory and outside the Factorio profile",
        }),
      );
    yield* prepareOutputDirectory(out);
    const fs = yield* FileSystem.FileSystem;
    const reports: string[] = [];
    const inputs: Record<string, typeof InputIdentity.Type> = {};
    function writeReport<S extends Schema.ConstraintDecoder<unknown>>(
      name: string,
      schema: S,
      value: unknown,
    ) {
      return Effect.gen(function* () {
        const report = yield* decode(schema, value, name + " report");
        const path = join(out, name + ".json");
        yield* assertCanonicalPath(path);
        yield* fs.writeFileString(path, JSON.stringify(report, null, 2) + "\n");
        reports.push(path);
        return report;
      });
    }
    let content: Effect.Success<ReturnType<typeof loadContent>> | undefined;
    let corpus: typeof CorpusInventory.Type | undefined;
    let progress: typeof SaveReadback.Type | undefined;
    let evidenceIssues = 0;
    if (mode === "corpus" || mode === "scope") {
      for (const name of ["catalog", "sources", "game-sources"])
        inputs[name] = (yield* stableBytes(
          join(project.modRoot, `content/${name}.json`),
        )).identity;
      ({ content, corpus } = yield* auditCorpus(project));
      yield* writeReport("corpus", CorpusReport, {
        schemaVersion: 1,
        inputs,
        ...corpus,
      });
    }
    if (mode === "progress" || mode === "scope") {
      const save =
        options.save === "latest" ? yield* latestSave(profile) : options.save;
      progress = yield* readSavedProgress(save);
      yield* writeReport("progress", ProgressReport, {
        schemaVersion: 1,
        ...progress,
      });
    }
    if (mode === "flags" || mode === "scope") {
      const log = yield* stableBytes(
        options.log ??
          join(profile, "script-output/py-research-dossier/flags.jsonl"),
      );
      inputs.flags = log.identity;
      let previous = null;
      if (options.sinceReport !== undefined) {
        const receipt = yield* stableBytes(options.sinceReport);
        previous = (yield* decodeJSON(
          PreviousReport,
          receipt.bytes,
          "previous flag receipt",
          true,
        )).flags;
        inputs.previousReport = receipt.identity;
      }
      const flags = yield* decode(
        FlagReadback,
        yield* model("flag log", () => readFlags(log.bytes, previous)),
        "flag readback",
      );
      yield* writeReport("flags", FlagsReport, {
        schemaVersion: 1,
        inputs,
        flags: flags.receipt,
        since: flags.since,
        records: flags.records,
      });
      if (mode === "scope") {
        const reference = yield* stableBytes(options.reference),
          familyFile = yield* stableBytes(options.families);
        inputs.reference = reference.identity;
        inputs.families = familyFile.identity;
        const context = yield* decodeJSON(
          ReferenceContext,
          reference.bytes,
          "relationship reference",
        );
        const families = yield* decodeJSON(
          Families,
          familyFile.bytes,
          "reviewed families",
        );
        const result = yield* model("scope inventory", () =>
          auditScope({ flags, content, context, families, progress }),
        );
        const report = yield* writeReport("scope", ScopeReport, {
          ...result,
          inputs,
          referenceEvidence: {
            sourceSave: context.sourceSave,
            provenance: context.provenance,
          },
          progress,
          corpus,
        });
        const path = join(out, "scope.md");
        yield* assertCanonicalPath(path);
        yield* fs.writeFileString(path, markdown(report));
        reports.push(path);
        evidenceIssues = report.issues.length;
      }
    }
    for (const name of ["catalog", "sources", "game-sources"]) {
      const identity = inputs[name];
      if (
        identity !== undefined &&
        (yield* hashFile(identity.path)) !== identity.sha256
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: name,
            message: "Corpus changed during audit; use a coherent revision",
          }),
        );
    }
    yield* Console.log(
      JSON.stringify(
        { mode, directory: resolve(out), reports, evidenceIssues },
        null,
        2,
      ),
    );
    return { evidenceIssues };
  });
}
