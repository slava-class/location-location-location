import { afterAll, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { rm } from "node:fs/promises";
import { releaseFixture } from "./fixtures/release.ts";
import { comparePerformance, distribution } from "./performance-analysis.ts";
import { PerformanceResult } from "./performance-contracts.ts";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const existing = await releaseFixture(roots, true);
  const sample = existing.manifest.evidence.verification.engine[0]!;
  const runId = crypto.randomUUID();
  const primary = Array.from({ length: 3 }, () => crypto.randomUUID());
  const correctness = Array.from({ length: 3 }, () => crypto.randomUUID());
  const spread = { samples: 3, median: 1, minimum: 0.9, maximum: 1.1 };
  return Schema.decodeUnknownSync(PerformanceResult)({
    schema: 3,
    runId,
    mod: sample.source.mod,
    directory: existing.directory,
    source: sample.source,
    correctnessSha256: "b".repeat(64),
    dependencies: { flib: { version: "1.0.0", sha256: "c".repeat(64) } },
    engine: sample.engine,
    ownerPid: process.pid,
    environment: {
      platform: "test",
      architecture: "test",
      osRelease: "test",
      cpu: "test",
      logicalCpus: 2,
      memoryBytes: 1024,
      bun: "test",
      cache: "fresh-process; host caches not flushed",
      powerAndThermal: "unmeasured",
      loadBefore: [0, 0, 0],
      loadAfter: [0, 0, 0],
    },
    scenario: {
      name: "pressure",
      description: "Synthetic comparison contract, not engine evidence",
      profile: "base",
      language: "en",
      fixture: { file: "dev/input.zip", sha256: "a".repeat(64) },
      correctness: "dev/observe.lua",
      activity: null,
      expected: { entities: 100 },
      preparedWarmupTicks: 120,
      ticks: 1200,
      processes: 3,
      budget: null,
    },
    detail: "none",
    startedAt: "2026-01-01T00:00:00.000Z",
    elapsedMs: 10,
    phase: "seal",
    children: [...primary, ...correctness],
    primary,
    correctness,
    status: "inconclusive",
    assessment: "Synthetic fixture",
    summary: {
      meanUpdateMs: spread,
      maximumUpdateMs: spread,
      processWallMs: spread,
      correctnessProcessWallMs: spread,
    },
  });
}
function candidate(baseline: typeof PerformanceResult.Type) {
  const primary = Array.from({ length: 3 }, () => crypto.randomUUID());
  const correctness = Array.from({ length: 3 }, () => crypto.randomUUID());
  return {
    ...baseline,
    runId: crypto.randomUUID(),
    primary,
    correctness,
    children: [...primary, ...correctness],
  };
}

test("missing budgets and overlapping process ranges are not green speed claims", async () => {
  const baseline = await fixture();
  const result = await Effect.runPromise(
    comparePerformance(baseline, candidate(baseline)),
  );
  expect(result.status).toBe("inconclusive");
  expect(result.reasons).toContain(
    "Mean-update ranges overlap: no demonstrated improvement",
  );
  expect(
    result.metrics.find((metric) => metric.metric === "meanUpdateMs")!.delta,
  ).toBe(0);
  const values = await Effect.runPromise(distribution([4, 1, 3, 2]));
  expect(values).toEqual({ samples: 4, median: 2.5, minimum: 1, maximum: 4 });
  expect(
    (await Effect.runPromise(Effect.flip(distribution([1, 2])))).message,
  ).toContain("three");
});

test("repeatable new cost exceeds a calibrated budget without laundering inherited failures", async () => {
  const baseline = await fixture();
  const next = candidate(baseline);
  const budget = {
    baseline: baseline.runId,
    maximumMeanMs: 1.2,
    maximumUpdateMs: 1.2,
    rationale: "Synthetic calibrated boundary",
  };
  const slower = {
    ...next,
    scenario: { ...next.scenario, budget },
    summary: {
      ...next.summary,
      meanUpdateMs: { samples: 3, minimum: 2, median: 2.1, maximum: 2.2 },
    },
  };
  const regression = await Effect.runPromise(
    comparePerformance(baseline, slower),
  );
  expect(regression.status).toBe("regressed");
  expect(
    regression.metrics.find((metric) => metric.metric === "meanUpdateMs")!
      .relativePercent,
  ).toBeCloseTo(110);
  const inherited = { ...baseline, summary: slower.summary };
  expect(
    (await Effect.runPromise(comparePerformance(inherited, slower))).status,
  ).toBe("inconclusive");
  expect(
    (
      await Effect.runPromise(
        comparePerformance(baseline, {
          ...next,
          scenario: { ...next.scenario, budget },
        }),
      )
    ).status,
  ).toBe("passed");
});

test("changed workloads, hardware, instrumentation and incomplete samples are non-comparable", async () => {
  const baseline = await fixture();
  const next = candidate(baseline);
  for (const changed of [
    { ...next, scenario: { ...next.scenario, expected: { entities: 200 } } },
    { ...next, scenario: { ...next.scenario, ticks: 2400 } },
    { ...next, scenario: { ...next.scenario, productEnabled: false } },
    { ...next, environment: { ...next.environment, cpu: "another CPU" } },
    { ...next, detail: "ticks" },
    { ...next, correctnessSha256: "d".repeat(64) },
    {
      ...next,
      dependencies: { flib: { version: "1.0.0", sha256: "d".repeat(64) } },
    },
    { ...next, primary: next.primary.slice(0, 2) },
    { ...next, primary: [next.primary[0], next.primary[0], next.primary[2]] },
    baseline,
  ])
    expect(
      (await Effect.runPromise(comparePerformance(baseline, changed))).status,
    ).toBe("blocked");
  expect(
    (
      await Effect.runPromise(
        Effect.flip(
          comparePerformance(baseline, {
            ...next,
            summary: { ...next.summary, meanUpdateMs: undefined },
          }),
        ),
      )
    ).boundary,
  ).toBe("candidate performance receipt");
});

test("activity comparisons preserve checkpoint deadlines and reject unreachable or unordered observations", async () => {
  const baseline = await fixture();
  const activity = {
    file: "dev/activity.lua",
    sha256: "e".repeat(64),
    checkpoints: [
      { update: 120, workload: { entities: 200 } },
      { update: 600, workload: { entities: 100 } },
    ],
  };
  const active = { ...baseline, scenario: { ...baseline.scenario, activity } };
  const next = candidate(active);
  expect(
    (await Effect.runPromise(comparePerformance(active, next))).status,
  ).toBe("inconclusive");
  for (const changed of [
    { ...activity, sha256: "f".repeat(64) },
    {
      ...activity,
      checkpoints: [
        { update: 121, workload: { entities: 200 } },
        activity.checkpoints[1]!,
      ],
    },
  ]) {
    expect(
      (
        await Effect.runPromise(
          comparePerformance(active, {
            ...next,
            scenario: { ...next.scenario, activity: changed },
          }),
        )
      ).status,
    ).toBe("blocked");
  }
  for (const updates of [[], [0], [1201], [120, 120], [600, 120]]) {
    const invalid = {
      ...next,
      scenario: {
        ...next.scenario,
        activity: {
          ...activity,
          checkpoints: updates.map((update) => ({
            update,
            workload: { entities: 100 },
          })),
        },
      },
    };
    expect(
      (
        await Effect.runPromise(
          Effect.flip(comparePerformance(active, invalid)),
        )
      ).boundary,
    ).toBe("candidate performance receipt");
  }
});
