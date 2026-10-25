import { Effect } from "effect";
import { isDeepStrictEqual } from "node:util";
import { BoundaryError, decode } from "./projects.ts";
import {
  Distribution,
  PerformanceComparison,
  PerformanceResult,
  PerformanceSummary,
} from "./performance-contracts.ts";

export function distribution(values: readonly number[]) {
  return Effect.gen(function* () {
    if (
      values.length < 3 ||
      values.some((value) => !Number.isFinite(value) || value < 0)
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "performance samples",
          message:
            "At least three finite, nonnegative independent process samples are required",
        }),
      );
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return yield* decode(
      Distribution,
      {
        samples: values.length,
        median:
          ordered.length % 2 === 0
            ? (ordered[middle - 1]! + ordered[middle]!) / 2
            : ordered[middle]!,
        minimum: ordered[0],
        maximum: ordered.at(-1),
      },
      "performance distribution",
    );
  });
}
function comparableInputs(value: typeof PerformanceResult.Type) {
  const {
    platform,
    architecture,
    osRelease,
    cpu,
    logicalCpus,
    memoryBytes,
    bun,
    cache,
  } = value.environment;
  const engine = value.engine;
  return {
    mod: value.mod.name,
    scenario: value.scenario.name,
    fixture: value.scenario.fixture.sha256,
    correctness: value.correctnessSha256,
    dependencies: value.dependencies,
    expected: value.scenario.expected,
    activity: value.scenario.activity,
    profile: value.scenario.profile,
    productEnabled: value.scenario.productEnabled !== false,
    language: value.scenario.language,
    warmup: value.scenario.preparedWarmupTicks,
    ticks: value.scenario.ticks,
    detail: value.detail,
    environment: {
      platform,
      architecture,
      osRelease,
      cpu,
      logicalCpus,
      memoryBytes,
      bun,
      cache,
    },
    engine: {
      sha256: engine.sha256,
      version: engine.version,
      build: engine.build,
      platform: engine.platform,
      distribution: engine.distribution,
      docker:
        engine.docker === undefined
          ? null
          : {
              image: engine.docker.image,
              platform: engine.docker.platform,
              limits: engine.docker.limits,
              bunSha256: engine.docker.bunSha256,
            },
    },
  };
}
/** Range separation is descriptive evidence, not a significance test or a noise-free speed claim. */
export function comparePerformance(
  baselineInput: unknown,
  candidateInput: unknown,
) {
  return Effect.gen(function* () {
    const baseline = yield* decode(
      PerformanceResult,
      baselineInput,
      "baseline performance receipt",
    );
    const candidate = yield* decode(
      PerformanceResult,
      candidateInput,
      "candidate performance receipt",
    );
    const reasons: string[] = [];
    if (baseline.runId === candidate.runId)
      reasons.push("A run cannot be its own independent comparison");
    if (
      !isDeepStrictEqual(
        comparableInputs(baseline),
        comparableInputs(candidate),
      )
    )
      reasons.push(
        "Workload, fixture, measured window, instrumentation, engine/backend or hardware class differs",
      );
    for (const receipt of [baseline, candidate]) {
      if (
        receipt.primary.length !== receipt.scenario.processes ||
        receipt.correctness.length !== receipt.scenario.processes ||
        new Set([...receipt.primary, ...receipt.correctness]).size !==
          receipt.primary.length + receipt.correctness.length
      )
        reasons.push(
          `Incomplete or duplicate independent process identities in ${receipt.runId}`,
        );
      for (const metric of Object.values(receipt.summary)) {
        if (
          metric.samples !== receipt.primary.length ||
          metric.minimum > metric.median ||
          metric.median > metric.maximum
        )
          reasons.push(`Inconsistent sample summary in ${receipt.runId}`);
      }
    }
    if (reasons.length > 0)
      return yield* decode(
        PerformanceComparison,
        {
          schema: 1,
          baseline: baseline.runId,
          candidate: candidate.runId,
          status: "blocked",
          reasons,
          metrics: [],
        },
        "blocked performance comparison",
      );
    const metrics = (
      Object.keys(
        PerformanceSummary.fields,
      ) as (keyof typeof PerformanceSummary.Type)[]
    ).map((metric) => {
      const before = baseline.summary[metric],
        after = candidate.summary[metric];
      const delta = after.median - before.median;
      return {
        metric,
        unit: metric.endsWith("UpdateMs") ? "ms/update" : "ms/process",
        baseline: before,
        candidate: after,
        delta,
        relativePercent:
          before.median === 0 ? null : (delta / before.median) * 100,
      };
    });
    let status: typeof PerformanceComparison.Type.status = "inconclusive";
    const budget = candidate.scenario.budget;
    if (budget !== null) {
      if (budget.baseline !== baseline.runId) {
        status = "blocked";
        reasons.push(
          "Declared calibrated budget belongs to a different baseline run",
        );
      } else {
        const before = baseline.summary,
          after = candidate.summary;
        const meanRegression =
          after.meanUpdateMs.minimum > budget.maximumMeanMs &&
          before.meanUpdateMs.maximum <= budget.maximumMeanMs;
        const peakRegression =
          after.maximumUpdateMs.minimum > budget.maximumUpdateMs &&
          before.maximumUpdateMs.maximum <= budget.maximumUpdateMs;
        if (meanRegression || peakRegression) {
          status = "regressed";
          reasons.push(
            "Every candidate process exceeds a declared cost budget met by every baseline process",
          );
        } else if (
          after.meanUpdateMs.maximum <= budget.maximumMeanMs &&
          after.maximumUpdateMs.maximum <= budget.maximumUpdateMs
        ) {
          status = "passed";
          reasons.push(
            "All candidate samples meet the declared baseline-relative cost budgets",
          );
        } else
          reasons.push(
            "Budget exceedance is noisy or inherited; no repeatable new regression is established",
          );
      }
    } else
      reasons.push(
        "No calibrated numerical budget is declared; measurements are not a performance pass",
      );
    const update = metrics.find((metric) => metric.metric === "meanUpdateMs")!;
    if (update.candidate.maximum < update.baseline.minimum)
      reasons.push(
        "Candidate mean-update ranges are lower in these independent processes; order, contention and unmeasured thermal state still constrain attribution",
      );
    else if (update.candidate.minimum > update.baseline.maximum)
      reasons.push(
        "Candidate mean-update ranges are higher in these independent processes; investigate the observed cost increase",
      );
    else
      reasons.push("Mean-update ranges overlap: no demonstrated improvement");
    return yield* decode(
      PerformanceComparison,
      {
        schema: 1,
        baseline: baseline.runId,
        candidate: candidate.runId,
        status,
        reasons,
        metrics,
      },
      "performance comparison",
    );
  });
}
