import { Cause, Effect, Exit, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ContainerReceipt, verifyContainerExit } from "./container.ts";
import { AbsolutePath, Sha256 } from "./contracts.ts";
import { readLogState, RunId } from "./logs.ts";
import { ProcessReceipt } from "./process.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  ModId,
  readJSON,
} from "./projects.ts";
import { resolveProject } from "./projects.ts";
import {
  BenchmarkRequest,
  BenchmarkState,
  PerformanceState,
} from "./performance-contracts.ts";
import { qualifyBenchmark, readPerformance } from "./performance.ts";
import type { ExecutionContext } from "./projects.ts";
import { RunRecord } from "./runs.ts";
import { SmokeRequest, SmokeState } from "./smoke.ts";
import { VerificationRequest, VerificationState } from "./testing.ts";
import { ProjectVerificationState } from "./verification.ts";
import { verifyObservation } from "./profiles.ts";
import {
  TestResult,
  verifyNativeCases,
  verifySummary,
} from "./test-results.ts";

const Status = Schema.Literals([
  "running",
  "finalizing",
  "passed",
  "failed",
  "cancelled",
  "interrupted",
  "unknown",
  "inconclusive",
  "regressed",
]);
const Owner = Schema.Literals([
  "not-checked",
  "pid-present-unverified",
  "not-present",
  "unavailable",
]);
const FailureKind = Schema.Literals([
  "prerequisite",
  "check-failed",
  "launch",
  "timeout",
  "cancelled",
  "out-of-memory",
  "abnormal-signal",
  "mod-load",
  "runtime-lua",
  "suspected-native-crash",
  "engine-error",
  "assertion",
  "test-error",
  "invalid-evidence",
  "finalization",
  "interrupted",
  "unclassified",
  "performance-regression",
]);
const FailureDetails = Schema.Struct({
  kinds: Schema.Array(FailureKind),
  error: Schema.NullOr(Schema.String),
  reportedCases: Schema.Array(Schema.NonEmptyString),
  omittedCases: Schema.Int,
  issues: Schema.Array(Schema.String),
});
const RunView = Schema.Struct({
  schema: Schema.Literal(1),
  record: RunRecord,
  status: Status,
  owner: Owner,
  phase: Schema.NonEmptyString,
  source: Schema.NullOr(Sha256),
  proof: Schema.Literals([
    "not-applicable",
    "pending",
    "passed",
    "failed",
    "cancelled",
  ]),
  receipt: Schema.NullOr(AbsolutePath),
  process: Schema.NullOr(ProcessReceipt),
  container: Schema.NullOr(ContainerReceipt),
  diagnostics: FailureDetails,
  log: Schema.Struct({
    directory: AbsolutePath,
    closed: Schema.Boolean,
    lastSequence: Schema.Int,
  }),
});
export const RunProgress = Schema.Struct({
  runId: RunId,
  status: RunView.fields.status,
  owner: RunView.fields.owner,
  phase: RunView.fields.phase,
  proof: RunView.fields.proof,
  logsClosed: RunView.fields.log.fields.closed,
});
const Issue = Schema.Struct({
  mod: Schema.NullOr(ModId),
  run: RunId,
  directory: AbsolutePath,
  error: Schema.String,
});
export const RunList = Schema.Struct({
  schema: Schema.Literal(1),
  status: Schema.Literals(["complete", "partial"]),
  runs: Schema.Array(RunView),
  issues: Schema.Array(Issue),
  issueCount: Schema.Int,
  unregisteredDirectories: Schema.Int,
  remainingCandidates: Schema.Int,
  next: Schema.NullOr(RunId),
});
const ListOptions = Schema.Struct({
  active: Schema.Boolean,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  after: Schema.optionalKey(RunId),
  kind: Schema.optionalKey(RunRecord.fields.kind),
});
const target = (context: ExecutionContext) =>
  "info" in context ? context.info.name : null;
const error = (boundary: string, message: string) =>
  new BoundaryError({ boundary, message });
function ownerPresence(pid: number): typeof Owner.Type {
  try {
    process.kill(pid, 0);
    return "pid-present-unverified";
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "ESRCH"
      ? "not-present"
      : "unavailable";
  }
}
function ownedJSON<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
) {
  return Effect.gen(function* () {
    yield* assertCanonicalPath(path);
    return yield* readJSON(schema, path);
  });
}
function optionalJSON<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* assertCanonicalPath(path);
    return (yield* fs.exists(path)) ? yield* readJSON(schema, path) : undefined;
  });
}
function readRecord(context: ExecutionContext, runId: string) {
  return Effect.gen(function* () {
    const directory = join(context.outputRoot, "runs", runId);
    const record = yield* ownedJSON(RunRecord, join(directory, "run.json"));
    if (
      record.run !== runId ||
      record.directory !== directory ||
      record.repository !== context.repoRoot ||
      record.mod !== target(context)
    )
      return yield* Effect.fail(
        error(
          runId,
          "Registered run belongs to another identity, repository or output directory",
        ),
      );
    return record;
  });
}
function inspectRecord(record: typeof RunRecord.Type) {
  return Effect.gen(function* () {
    const directory = record.directory;
    const logDirectory = join(directory, "logs");
    const log = yield* readLogState(logDirectory);
    if (log.manifest.runId !== record.run)
      return yield* Effect.fail(
        error(record.run, "Log belongs to another registered run"),
      );
    let status: typeof Status.Type = "running";
    let proof: typeof RunView.Type.proof = "not-applicable";
    let source: string | null = null;
    let receipt: string | null = null;
    let phase = "starting";
    let processReceipt: typeof ProcessReceipt.Type | null = null;
    let failure: string | null = null;
    const kinds = new Set<typeof FailureKind.Type>();
    const reportedCases: string[] = [];
    let omittedCases = 0;
    const issues: string[] = [];
    const container = yield* optionalJSON(
      ContainerReceipt,
      join(directory, "container.json"),
    );
    if (
      container !== undefined &&
      (record.backend !== "docker" ||
        container.runId !== record.run ||
        container.modId !== record.mod ||
        container.repository !== record.repository ||
        container.directory !== directory ||
        container.name !== "modkit-" + record.run)
    )
      return yield* Effect.fail(
        error(
          record.run,
          "Container receipt disagrees with its registered run",
        ),
      );
    if (
      (record.kind === "verification" || record.kind === "performance") &&
      record.backend !== "native"
    )
      return yield* Effect.fail(
        error(
          record.run,
          "Aggregate supervisor must be native; child backends are registered independently",
        ),
      );
    if (record.kind === "verification") {
      receipt = join(directory, "verify.json");
      const result = yield* ownedJSON(ProjectVerificationState, receipt);
      if (
        result.runId !== record.run ||
        result.directory !== directory ||
        result.mod.name !== record.mod ||
        result.source.mod.name !== record.mod ||
        result.source.mod.version !== result.mod.version ||
        result.ownerPid !== record.ownerPid ||
        Date.parse(result.startedAt) !== record.startedAtUnixMs
      )
        return yield* Effect.fail(
          error(
            record.run,
            "Aggregate receipt disagrees with its registered run",
          ),
        );
      status = result.status;
      proof = result.status === "running" ? "pending" : result.status;
      source = result.source.sha256;
      phase = result.phase;
      if (result.status === "failed") {
        failure = result.error;
        kinds.add(
          result.phase === "toolchain"
            ? "prerequisite"
            : result.phase === "seal"
              ? "invalid-evidence"
              : "check-failed",
        );
      }
    } else if (record.kind === "performance") {
      receipt = join(directory, "performance.json");
      const result = yield* ownedJSON(PerformanceState, receipt);
      if (
        record.mod === null ||
        result.runId !== record.run ||
        result.directory !== directory ||
        result.mod.name !== record.mod ||
        result.source.mod.name !== record.mod ||
        result.source.mod.version !== result.mod.version ||
        result.ownerPid !== record.ownerPid ||
        Date.parse(result.startedAt) !== record.startedAtUnixMs
      )
        return yield* Effect.fail(
          error(
            record.run,
            "Performance receipt disagrees with its registered run",
          ),
        );
      status = result.status;
      source = result.source.sha256;
      phase = result.phase;
      proof =
        result.status === "running"
          ? "pending"
          : result.status === "failed" || result.status === "cancelled"
            ? result.status
            : "passed";
      if ("error" in result) failure = result.error;
      if ("summary" in result) {
        yield* readPerformance(
          yield* resolveProject(
            record.repository,
            record.mod,
            record.repository,
          ),
          record.run,
        );
        if (result.status === "regressed") {
          kinds.add("performance-regression");
          failure = result.assessment;
        }
      }
    } else {
      processReceipt = yield* ownedJSON(
        ProcessReceipt,
        join(directory, "process.json"),
      );
      if (
        processReceipt.runId !== record.run ||
        processReceipt.modId !== record.mod ||
        processReceipt.repository !== record.repository ||
        processReceipt.cwd !== record.cwd ||
        processReceipt.profile !== record.profile ||
        processReceipt.ownerPid !== record.ownerPid ||
        Date.parse(processReceipt.startedAt) !== record.startedAtUnixMs
      )
        return yield* Effect.fail(
          error(
            record.run,
            "Process receipt disagrees with its registered run",
          ),
        );
      status = processReceipt.status;
      phase = processReceipt.phase;
      failure = processReceipt.error ?? null;
      if (record.kind === "benchmark") {
        const request = yield* ownedJSON(
          BenchmarkRequest,
          join(directory, "benchmark-request.json"),
        );
        receipt = join(directory, "benchmark.json");
        const result = yield* optionalJSON(BenchmarkState, receipt);
        if (
          request.runId !== record.run ||
          request.mod.name !== record.mod ||
          request.directory !== directory ||
          request.source.mod.name !== record.mod ||
          request.source.mod.version !== request.mod.version ||
          (request.engine.docker === undefined ? "native" : "docker") !==
            record.backend ||
          (container !== undefined &&
            !isDeepStrictEqual(request.engine.docker, container.runtime))
        )
          return yield* Effect.fail(
            error(
              record.run,
              "Benchmark request is foreign or disagrees with its backend",
            ),
          );
        source = request.source.sha256;
        proof = result?.status ?? "pending";
        if (result?.status === "passed")
          yield* qualifyBenchmark(request, result);
        else if (result !== undefined) {
          if (
            result.runId !== record.run ||
            result.source.sha256 !== request.source.sha256 ||
            result.directory !== directory
          )
            return yield* Effect.fail(
              error(
                record.run,
                "Benchmark failure belongs to a different request",
              ),
            );
          status = result.status;
          failure = result.error;
        } else if (status === "passed") status = "finalizing";
      } else if (
        record.kind === "engine-suite" ||
        record.kind === "package-smoke"
      ) {
        const request =
          record.kind === "engine-suite"
            ? yield* ownedJSON(
                VerificationRequest,
                join(directory, "verification-request.json"),
              )
            : yield* ownedJSON(
                SmokeRequest,
                join(directory, "smoke-request.json"),
              );
        if (
          (request.engine.docker === undefined ? "native" : "docker") !==
            record.backend ||
          (container !== undefined &&
            !isDeepStrictEqual(request.engine.docker, container.runtime))
        )
          return yield* Effect.fail(
            error(
              record.run,
              "Engine request disagrees with its registered execution backend",
            ),
          );
        receipt = join(
          directory,
          record.kind === "engine-suite" ? "verification.json" : "smoke.json",
        );
        const result =
          record.kind === "engine-suite"
            ? yield* optionalJSON(VerificationState, receipt)
            : yield* optionalJSON(SmokeState, receipt);
        for (const value of result === undefined
          ? [request]
          : [request, result]) {
          if (
            value.directory !== directory ||
            value.request.runId !== record.run ||
            value.request.mod.name !== record.mod ||
            value.source.mod.name !== record.mod ||
            value.source.mod.version !== value.request.mod.version ||
            value.request.purpose !==
              (record.kind === "engine-suite" ? "suite" : "package-smoke")
          )
            return yield* Effect.fail(
              error(
                record.run,
                "Engine evidence belongs to another run, product or purpose",
              ),
            );
        }
        source = request.source.sha256;
        proof = result?.status ?? "pending";
        if (result !== undefined) {
          if (
            result.source.sha256 !== request.source.sha256 ||
            result.engine.sha256 !== request.engine.sha256 ||
            result.request.artifactSha256 !== request.request.artifactSha256 ||
            result.request.mod.version !== request.request.mod.version ||
            result.request.profile !== request.request.profile ||
            result.request.language !== request.request.language ||
            result.seedSha256 !== request.seedSha256 ||
            result.fixtureSha256 !== request.fixtureSha256
          )
            return yield* Effect.fail(
              error(
                record.run,
                "Final engine evidence disagrees with its immutable request",
              ),
            );
          if (result.status !== "passed") {
            status = result.status;
            failure = result.error;
          } else if (processReceipt.status !== "passed")
            return yield* Effect.fail(
              error(
                record.run,
                "Passed engine proof has no passed process receipt",
              ),
            );
          else {
            yield* verifyObservation(
              result.observed,
              request.request,
              request.expectedMods,
            );
            if ("expected" in request && "passed" in result) {
              yield* verifySummary(
                result.summary,
                request.expected,
                record.run,
              );
              yield* verifyNativeCases(
                result.passed.map((path) => ({
                  path,
                  result: "passed" as const,
                })),
                request.expected.passed,
                record.run,
              );
            }
          }
        } else if (status === "passed") status = "finalizing";
        if (status === "failed" && "expected" in request) {
          const diagnostic = yield* Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = join(directory, "results.json");
            yield* assertCanonicalPath(path);
            if (!(yield* fs.exists(path))) return;
            const reported = yield* readJSON(TestResult, path, true);
            const expected = new Set([
              ...request.expected.passed,
              ...request.expected.skipped,
            ]);
            const names = reported.tests.map((test) => test.path);
            if (
              reported.modName !== record.mod ||
              new Set(names).size !== names.length ||
              names.some((name) => !expected.has(name))
            )
              return yield* Effect.fail(
                error(
                  record.run,
                  "Failure result has foreign, duplicate or unexpected case identities",
                ),
              );
            return reported.tests.filter(
              (test) => test.result === "failed" || test.result === "error",
            );
          }).pipe(Effect.exit);
          if (Exit.isFailure(diagnostic)) {
            if (Cause.hasInterrupts(diagnostic.cause))
              return yield* Effect.failCause(diagnostic.cause);
            kinds.add("invalid-evidence");
            issues.push(Cause.pretty(diagnostic.cause).slice(0, 8192));
          } else if (diagnostic.value !== undefined) {
            for (const test of diagnostic.value) {
              kinds.add(test.result === "failed" ? "assertion" : "test-error");
              if (reportedCases.length < 8) reportedCases.push(test.path);
              else omittedCases++;
            }
          }
        }
      }
    }
    if (record.backend === "docker" && processReceipt?.status === "passed")
      yield* verifyContainerExit(processReceipt, container);
    if (
      ["passed", "inconclusive", "regressed"].includes(status) &&
      log.final === undefined
    )
      status = "finalizing";
    const owner =
      status === "running" || status === "finalizing"
        ? ownerPresence(record.ownerPid)
        : "not-checked";
    if (owner === "not-present") status = "interrupted";
    else if (owner === "unavailable") status = "unknown";
    if (status === "cancelled" || processReceipt?.interrupted)
      kinds.add("cancelled");
    if (status === "interrupted") kinds.add("interrupted");
    if (processReceipt?.deadline) kinds.add("timeout");
    if (processReceipt?.termination === "spawn-failed") kinds.add("launch");
    if ((processReceipt?.finalizationErrors.length ?? 0) > 0)
      kinds.add("finalization");
    if (container?.state?.OOMKilled) kinds.add("out-of-memory");
    if (
      processReceipt?.exit?.signal &&
      !["SIGTERM", "SIGINT", "SIGKILL"].includes(processReceipt.exit.signal)
    )
      kinds.add("abnormal-signal");
    if (
      status !== "passed" &&
      status !== "running" &&
      status !== "finalizing" &&
      status !== "inconclusive"
    ) {
      for (const file of processReceipt?.engineDiagnostics?.files ?? []) {
        if (file.state !== "read") continue;
        for (const item of file.errors)
          if (item.kind !== "framework-termination") kinds.add(item.kind);
      }
      if (kinds.size === 0)
        kinds.add(proof === "failed" ? "invalid-evidence" : "unclassified");
    }
    return yield* decode(
      RunView,
      {
        schema: 1,
        record,
        status,
        owner,
        phase,
        source,
        proof,
        receipt,
        process: processReceipt,
        container: container ?? null,
        diagnostics: {
          kinds: [...kinds],
          error: failure,
          reportedCases,
          omittedCases,
          issues,
        },
        log: {
          directory: logDirectory,
          closed: log.final !== undefined,
          lastSequence: log.watermark.lastSequence,
        },
      },
      "run observation",
    );
  });
}
export function readRun(context: ExecutionContext, input: unknown) {
  return Effect.gen(function* () {
    const runId = yield* decode(RunId, input, "run ID");
    return yield* inspectRecord(yield* readRecord(context, runId));
  });
}
export function listRuns(
  contexts: readonly ExecutionContext[],
  input: unknown,
) {
  return Effect.gen(function* () {
    const options = yield* decode(ListOptions, input, "run listing options");
    const fs = yield* FileSystem.FileSystem;
    const candidates: (typeof RunRecord.Type)[] = [];
    const issues: (typeof Issue.Type)[] = [];
    let unregisteredDirectories = 0;
    let issueCount = 0;
    const recordIssue = (
      mod: string | null,
      run: string,
      directory: string,
      cause: Cause.Cause<unknown>,
    ) => {
      issueCount++;
      if (issues.length >= options.limit) return;
      const details = Cause.pretty(cause);
      issues.push({
        mod,
        run,
        directory,
        error:
          details.length <= 8192
            ? details
            : details.slice(0, 8192) + "\n[diagnostic excerpt truncated]",
      });
    };
    for (const context of contexts) {
      const root = join(context.outputRoot, "runs");
      yield* assertCanonicalPath(root);
      if (!(yield* fs.exists(root))) continue;
      for (const name of yield* fs.readDirectory(root)) {
        if (!Schema.is(RunId)(name)) continue;
        const directory = join(root, name);
        const metadata = join(directory, "run.json");
        const checked = yield* Effect.gen(function* () {
          yield* assertCanonicalPath(metadata);
          return (yield* fs.exists(metadata))
            ? yield* readRecord(context, name)
            : undefined;
        }).pipe(Effect.exit);
        if (Exit.isFailure(checked))
          recordIssue(target(context), name, directory, checked.cause);
        else if (checked.value === undefined) unregisteredDirectories++;
        else if (
          options.kind === undefined ||
          checked.value.kind === options.kind
        )
          candidates.push(checked.value);
      }
    }
    candidates.sort(
      (a, b) =>
        b.startedAtUnixMs - a.startedAtUnixMs || a.run.localeCompare(b.run),
    );
    let index = 0;
    if (options.after !== undefined) {
      index =
        candidates.findIndex((record) => record.run === options.after) + 1;
      if (index === 0)
        return yield* Effect.fail(
          error(
            options.after,
            "Listing cursor does not belong to the selected registered runs",
          ),
        );
    }
    const runs: (typeof RunView.Type)[] = [];
    while (index < candidates.length && runs.length < options.limit) {
      const record = candidates[index++]!;
      const checked = yield* inspectRecord(record).pipe(Effect.exit);
      if (Exit.isFailure(checked))
        recordIssue(record.mod, record.run, record.directory, checked.cause);
      else if (
        !options.active ||
        ["running", "finalizing", "interrupted", "unknown"].includes(
          checked.value.status,
        )
      )
        runs.push(checked.value);
    }
    return yield* decode(
      RunList,
      {
        schema: 1,
        status: issueCount || unregisteredDirectories ? "partial" : "complete",
        runs,
        issues,
        issueCount,
        unregisteredDirectories,
        remainingCandidates: candidates.length - index,
        next:
          index < candidates.length
            ? (candidates[index - 1]?.run ?? null)
            : null,
      },
      "run listing",
    );
  });
}
