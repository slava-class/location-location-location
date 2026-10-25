import { Schema } from "effect";
import {
  AbsolutePath,
  ElapsedMs,
  ModIdentity,
  PackageResult,
  Sha256,
} from "./contracts.ts";
import { BenchmarkResult, BenchmarkWindow } from "./benchmark.ts";
import { Engine } from "./engine.ts";
import { RunId } from "./logs.ts";
import {
  Locale,
  ModId,
  RelativePath,
  TestProfile,
  Version,
} from "./projects.ts";
import { SourceSeal } from "./source.ts";

const Workload = Schema.Record(
  ModId,
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000000000 })),
);
const Checkpoint = Schema.Struct({
  update: BenchmarkWindow.fields.ticks,
  workload: Workload,
});
export const PerformanceBudget = Schema.Struct({
  baseline: RunId,
  maximumMeanMs: ElapsedMs,
  maximumUpdateMs: ElapsedMs,
  rationale: Schema.NonEmptyString,
});
const PerformanceScenario = Schema.Struct({
  name: ModId,
  description: Schema.NonEmptyString,
  profile: TestProfile,
  language: Locale,
  dependencies: Schema.optionalKey(Schema.Array(ModId)),
  productEnabled: Schema.optionalKey(Schema.Boolean),
  fixture: Schema.Struct({ file: RelativePath, sha256: Sha256 }),
  correctness: RelativePath,
  activity: Schema.NullOr(
    Schema.Struct({
      file: RelativePath,
      sha256: Sha256,
      checkpoints: Schema.Array(Checkpoint),
    }),
  ),
  expected: Workload,
  preparedWarmupTicks: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 1000000 }),
  ),
  ticks: BenchmarkWindow.fields.ticks,
  processes: Schema.Int.check(Schema.isBetween({ minimum: 3, maximum: 20 })),
  budget: Schema.NullOr(PerformanceBudget),
}).check(
  Schema.makeFilter(
    (scenario) =>
      scenario.activity === null ||
      (scenario.activity.checkpoints.length > 0 &&
        scenario.activity.checkpoints.every(
          (checkpoint, index, checkpoints) =>
            checkpoint.update <= scenario.ticks &&
            (index === 0 || checkpoint.update > checkpoints[index - 1]!.update),
        )),
  ),
);
export const PerformanceConfiguration = Schema.Struct({
  schema: Schema.Literal(2),
  scenarios: Schema.Array(PerformanceScenario).check(
    Schema.makeFilter(
      (values) =>
        values.length > 0 &&
        new Set(values.map((value) => value.name)).size === values.length,
    ),
  ),
});
export const PerformanceEnvironment = Schema.Struct({
  platform: Schema.NonEmptyString,
  architecture: Schema.NonEmptyString,
  osRelease: Schema.NonEmptyString,
  cpu: Schema.NonEmptyString,
  logicalCpus: Schema.Int,
  memoryBytes: Schema.Int,
  bun: Schema.NonEmptyString,
  cache: Schema.Literal("fresh-process; host caches not flushed"),
  powerAndThermal: Schema.Literal("unmeasured"),
  loadBefore: Schema.Array(ElapsedMs),
  loadAfter: Schema.Array(ElapsedMs),
});
export const BenchmarkObservation = Schema.Struct({
  schema: Schema.Literal(2),
  runId: RunId,
  activeMods: Schema.Record(ModId, Version),
  before: Workload,
  after: Workload,
  updates: Schema.Int,
  checkpoints: Schema.optionalKey(Schema.Array(Checkpoint)),
});
const ArchiveClosure = Schema.Record(
  ModId,
  Schema.Struct({ version: Version, sha256: Sha256 }),
);
const BenchmarkIdentity = Schema.Struct({
  schema: Schema.Literal(3),
  runId: RunId,
  mod: ModIdentity,
  directory: AbsolutePath,
  source: SourceSeal,
  scenario: PerformanceScenario,
  engine: Engine,
  artifact: PackageResult,
  companions: Schema.Array(PackageResult),
  expectedMods: Schema.Record(ModId, Version),
  archives: ArchiveClosure,
  mode: Schema.Literals(["primary", "correctness"]),
  window: BenchmarkWindow,
  fixtureSha256: Sha256,
  correctnessSha256: Sha256,
  harness: Schema.NullOr(
    Schema.Struct({
      directory: RelativePath,
      files: Schema.Record(RelativePath, Sha256),
    }),
  ),
  startedAt: Schema.NonEmptyString,
  elapsedMs: ElapsedMs,
});
export const BenchmarkRequest = BenchmarkIdentity;
export const BenchmarkProof = Schema.Struct({
  ...BenchmarkIdentity.fields,
  status: Schema.Literal("passed"),
  result: BenchmarkResult,
  observation: Schema.NullOr(BenchmarkObservation),
  processWallMs: ElapsedMs,
});
export const BenchmarkState = Schema.Union([
  BenchmarkProof,
  Schema.Struct({
    ...BenchmarkIdentity.fields,
    status: Schema.Literals(["failed", "cancelled"]),
    error: Schema.String,
  }),
]);
export const Distribution = Schema.Struct({
  samples: Schema.Int,
  median: ElapsedMs,
  minimum: ElapsedMs,
  maximum: ElapsedMs,
});
export const PerformanceSummary = Schema.Struct({
  meanUpdateMs: Distribution,
  maximumUpdateMs: Distribution,
  processWallMs: Distribution,
  correctnessProcessWallMs: Distribution,
});
const PerformanceIdentity = Schema.Struct({
  schema: Schema.Literal(3),
  runId: RunId,
  mod: ModIdentity,
  directory: AbsolutePath,
  source: SourceSeal,
  scenario: PerformanceScenario,
  correctnessSha256: Sha256,
  engine: Engine,
  environment: PerformanceEnvironment,
  detail: BenchmarkWindow.fields.detail,
  ownerPid: Schema.Int,
  startedAt: Schema.NonEmptyString,
  elapsedMs: ElapsedMs,
  phase: Schema.NonEmptyString,
  children: Schema.Array(RunId),
});
export const PerformanceResult = Schema.Struct({
  ...PerformanceIdentity.fields,
  status: Schema.Literals(["passed", "regressed", "inconclusive"]),
  summary: PerformanceSummary,
  dependencies: ArchiveClosure,
  assessment: Schema.NonEmptyString,
  primary: Schema.Array(RunId),
  correctness: Schema.Array(RunId),
});
export const PerformanceState = Schema.Union([
  PerformanceResult,
  Schema.Struct({
    ...PerformanceIdentity.fields,
    status: Schema.Literal("running"),
  }),
  Schema.Struct({
    ...PerformanceIdentity.fields,
    status: Schema.Literals(["failed", "cancelled"]),
    error: Schema.String,
  }),
]);
export const PerformanceComparison = Schema.Struct({
  schema: Schema.Literal(1),
  baseline: RunId,
  candidate: RunId,
  status: Schema.Literals(["passed", "regressed", "inconclusive", "blocked"]),
  reasons: Schema.Array(Schema.NonEmptyString),
  metrics: Schema.Array(
    Schema.Struct({
      metric: Schema.Literals(
        Object.keys(
          PerformanceSummary.fields,
        ) as (keyof typeof PerformanceSummary.Type)[],
      ),
      unit: Schema.Literals(["ms/update", "ms/process"]),
      baseline: Distribution,
      candidate: Distribution,
      delta: Schema.Number,
      relativePercent: Schema.NullOr(Schema.Number),
    }),
  ),
});
