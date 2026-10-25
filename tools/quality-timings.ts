import { Cause, Effect, Exit, FileSystem, Schema } from "effect";
import { basename, join } from "node:path";
import { AbsolutePath, ElapsedMs } from "./contracts.ts";
import { RunId } from "./logs.ts";
import { ProcessReceipt } from "./process.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  contains,
  decode,
  readJSON,
  RelativePath,
} from "./projects.ts";

const NativeInteger = Schema.String.check(
  Schema.isPattern(/^(0|[1-9][0-9]*)$/),
  Schema.makeFilter((value) => Number.isSafeInteger(Number(value))),
);
const NativeReport = Schema.Struct({
  lintActions: Schema.NonEmptyArray(
    Schema.Struct({
      paths: Schema.NonEmptyArray(RelativePath),
      linter: Schema.NonEmptyString,
      command: Schema.NonEmptyString,
      report: AbsolutePath,
      verb: Schema.Literals(["TRUNK_VERB_CHECK", "TRUNK_VERB_FMT"]),
      actionDurationMs: NativeInteger,
      cacheHit: Schema.Literal("CACHE_HIT_NONE"),
    }),
  ),
});
const Batch = Schema.Struct({
  id: Schema.NonEmptyString,
  files: Schema.NonEmptyArray(RelativePath),
  elapsedMs: ElapsedMs,
});
const Checker = Schema.Struct({
  checker: Schema.NonEmptyString,
  command: Schema.NonEmptyString,
  batches: Schema.NonEmptyArray(Batch),
  totalBatchMs: ElapsedMs,
  longestBatchMs: ElapsedMs,
});
const Identity = Schema.Struct({
  schema: Schema.Literal(1),
  runId: RunId,
  processElapsedMs: ElapsedMs,
});
export const QualityTimings = Schema.Struct({
  ...Identity.fields,
  status: Schema.Literal("complete"),
  coverage: Schema.Literals(["invocation", "final-pass"]),
  checkers: Schema.Array(Checker),
});
const Unavailable = Schema.Struct({
  ...Identity.fields,
  status: Schema.Literal("unavailable"),
  reason: Schema.NonEmptyString,
});

/** Native per-file actions share a report ID when they came from one batch. */
export function summarizeTrunkTimings(
  input: unknown,
  repository: string,
  selectedFiles: readonly string[],
  verb: "TRUNK_VERB_CHECK" | "TRUNK_VERB_FMT",
) {
  return Effect.gen(function* () {
    const report = yield* decode(
      NativeReport,
      input,
      "Trunk timing report",
      true,
    );
    const invalid = () =>
      Effect.fail(
        new BoundaryError({
          boundary: "Trunk timing report",
          message:
            "Inconsistent source selection, batch identity, or invocation verb",
        }),
      );
    const selection = new Set(selectedFiles);
    const batches = new Map<
      string,
      {
        checker: string;
        command: string;
        verb: "TRUNK_VERB_CHECK" | "TRUNK_VERB_FMT";
        elapsedMs: number;
        files: Set<string>;
      }
    >();
    for (const action of report.lintActions) {
      if (
        (verb === "TRUNK_VERB_FMT" && action.verb !== verb) ||
        action.paths.some((path) => !selection.has(path)) ||
        !contains(join(repository, ".trunk", "out"), action.report)
      )
        return yield* invalid();
      const elapsedMs = Number(action.actionDurationMs);
      const existing = batches.get(action.report);
      if (existing !== undefined) {
        if (
          existing.checker !== action.linter ||
          existing.command !== action.command ||
          existing.verb !== action.verb ||
          existing.elapsedMs !== elapsedMs
        )
          return yield* invalid();
        for (const path of action.paths) existing.files.add(path);
      } else {
        batches.set(action.report, {
          checker: action.linter,
          command: action.command,
          verb: action.verb,
          elapsedMs,
          files: new Set(action.paths),
        });
      }
    }
    const grouped = new Map<
      string,
      { checker: string; command: string; batches: (typeof Batch.Type)[] }
    >();
    for (const [path, batch] of batches) {
      const key = JSON.stringify([batch.checker, batch.command]);
      let group = grouped.get(key);
      if (group === undefined) {
        group = { checker: batch.checker, command: batch.command, batches: [] };
        grouped.set(key, group);
      }
      group.batches.push(
        yield* decode(
          Batch,
          {
            id: basename(path),
            files: [...batch.files].sort(),
            elapsedMs: batch.elapsedMs,
          },
          "Trunk checker batch",
        ),
      );
    }
    return yield* decode(
      Schema.Array(Checker),
      [...grouped.values()]
        .sort(
          (a, b) =>
            a.checker.localeCompare(b.checker) ||
            a.command.localeCompare(b.command),
        )
        .map((group) => ({
          ...group,
          totalBatchMs: group.batches.reduce(
            (total, batch) => total + batch.elapsedMs,
            0,
          ),
          longestBatchMs: Math.max(
            ...group.batches.map((batch) => batch.elapsedMs),
          ),
        })),
      "Trunk checker timings",
    );
  });
}

/** Retain diagnostic failure explicitly; never turn missing evidence into zero work. */
export function retainQualityTimings(
  run: { runId: string; directory: string; repository: string },
  selectedFiles: readonly string[],
  verb: "TRUNK_VERB_CHECK" | "TRUNK_VERB_FMT",
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const processPath = join(run.directory, "process.json");
    yield* assertCanonicalPath(processPath);
    const process = yield* readJSON(ProcessReceipt, processPath);
    if (process.runId !== run.runId || process.status === "running")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: processPath,
          message:
            "Timing capture requires this invocation's final process receipt",
        }),
      );
    const identity = {
      schema: 1 as const,
      runId: run.runId,
      processElapsedMs: process.elapsedMs,
    };
    const captured = yield* Effect.exit(
      Effect.gen(function* () {
        const path = join(run.directory, "trunk.json");
        yield* assertCanonicalPath(path);
        const report = yield* readJSON(Schema.Unknown, path);
        const checkers = yield* summarizeTrunkTimings(
          report,
          run.repository,
          selectedFiles,
          verb,
        );
        return yield* decode(
          QualityTimings,
          {
            ...identity,
            status: "complete",
            // Native fmt replaces its action list when rechecking applied fixes.
            coverage: verb === "TRUNK_VERB_FMT" ? "final-pass" : "invocation",
            checkers,
          },
          "quality timings",
        );
      }),
    );
    const receipt = Exit.isSuccess(captured)
      ? captured.value
      : yield* decode(
          Unavailable,
          {
            ...identity,
            status: "unavailable",
            reason: Cause.pretty(captured.cause),
          },
          "unavailable quality timings",
        );
    const path = join(run.directory, "quality-timings.json");
    yield* assertCanonicalPath(path);
    yield* assertCanonicalPath(`${path}.part`);
    yield* fs.writeFileString(
      `${path}.part`,
      JSON.stringify(receipt, null, 2) + "\n",
    );
    yield* fs.rename(`${path}.part`, path);
    return receipt;
  });
}
