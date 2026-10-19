import { Effect, Schema } from "effect";
import { ElapsedMs } from "./contracts.ts";
import { BoundaryError, ModId, Profile } from "./projects.ts";
import type { ProfileName } from "./projects.ts";

const Count = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
export const TestSummary = Schema.Struct({
  failed: Count,
  passed: Count,
  ran: Count,
  skipped: Count,
  todo: Count,
  cancelled: Count,
  describeBlockErrors: Count,
  status: Schema.Literals(["passed", "failed", "todo", "cancelled", "bailed"]),
});
export const TestResult = Schema.Struct({
  timestamp: Schema.NonEmptyString,
  modName: ModId,
  summary: TestSummary,
  tests: Schema.Array(
    Schema.Struct({
      path: Schema.NonEmptyString,
      result: Schema.Literals([
        "passed",
        "failed",
        "skipped",
        "todo",
        "error",
        "cancelled",
      ]),
      durationMs: Schema.optionalKey(ElapsedMs),
      errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
});
export const TestInventory = Schema.Struct({
  schema: Schema.Literal(1),
  profiles: Schema.Array(Profile),
  cases: Schema.Array(
    Schema.Struct({
      path: Schema.NonEmptyString,
      passedIn: Schema.Array(Profile),
      skippedIn: Schema.Array(Profile),
    }),
  ),
});
export const TestSelection = Schema.Struct({
  passed: Schema.Array(Schema.NonEmptyString),
  skipped: Schema.Array(Schema.NonEmptyString),
});
export type Inventory = typeof TestInventory.Type;
export function selectedCases(inventory: Inventory, profile: ProfileName) {
  return Effect.gen(function* () {
    if (
      !inventory.profiles.includes(profile) ||
      new Set(inventory.profiles).size !== inventory.profiles.length
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Missing or duplicate inventory profile",
        }),
      );
    const paths = new Set<string>();
    for (const item of inventory.cases) {
      const declared = [...item.passedIn, ...item.skippedIn];
      if (
        paths.has(item.path) ||
        declared.length === 0 ||
        new Set(declared).size !== declared.length ||
        declared.some((value) => !inventory.profiles.includes(value))
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: item.path,
            message:
              "Duplicate, overlapping or unknown expected test identity/profile",
          }),
        );
      paths.add(item.path);
    }
    const passed = inventory.cases
      .filter((item) => item.passedIn.includes(profile))
      .map((item) => item.path)
      .sort();
    const skipped = inventory.cases
      .filter((item) => item.skippedIn.includes(profile))
      .map((item) => item.path)
      .sort();
    if (passed.length === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "No independently declared passing cases for this profile",
        }),
      );
    return { passed, skipped };
  });
}
export function verifySummary(
  summary: typeof TestSummary.Type,
  expected: { passed: readonly string[]; skipped: readonly string[] },
  boundary: string,
) {
  if (
    summary.status !== "passed" ||
    summary.failed !== 0 ||
    summary.todo !== 0 ||
    summary.cancelled !== 0 ||
    summary.describeBlockErrors !== 0 ||
    summary.passed !== expected.passed.length ||
    summary.ran !== expected.passed.length ||
    summary.skipped !== expected.skipped.length
  )
    return Effect.fail(
      new BoundaryError({
        boundary,
        message:
          "Framework summary differs from the independently declared passing/skipped inventory",
      }),
    );
  return Effect.void;
}
export function verifyTestResult(
  result: typeof TestResult.Type,
  modId: string,
  expected: { passed: readonly string[]; skipped: readonly string[] },
) {
  return Effect.gen(function* () {
    if (result.modName !== modId)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modId,
          message: "Framework result belongs to another primary mod",
        }),
      );
    yield* verifySummary(result.summary, expected, modId);
    const actual = result.tests.map((test) => test.path);
    if (new Set(actual).size !== actual.length)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modId,
          message: "Duplicate framework case identity",
        }),
      );
    if (
      result.tests.some(
        (test) =>
          (test.result !== "passed" && test.result !== "skipped") ||
          (test.errors?.length ?? 0) > 0,
      )
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modId,
          message: "Framework recorded a failed, incomplete or erroneous case",
        }),
      );
    for (const status of ["passed", "skipped"] as const) {
      const observed = result.tests
        .filter((test) => test.result === status)
        .map((test) => test.path)
        .sort();
      if (JSON.stringify(observed) !== JSON.stringify(expected[status]))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: modId,
            message: `Missing, unexpected or incorrectly ${status} framework cases`,
          }),
        );
    }
  });
}
export function nativePassRecords(log: string) {
  const records: { path: string; result: "passed" | "failed" }[] = [];
  for (const line of log.split("\n")) {
    const match =
      / Script @__factorio-test__\/_factorio-test\.lua:\d+: (PASS|FAIL) (.+) \(<Profiler>\)$/.exec(
        line,
      );
    if (match)
      records.push({
        path: match[2]!,
        result: match[1] === "PASS" ? "passed" : "failed",
      });
  }
  return records;
}
export function verifyNativeCases(
  records: ReturnType<typeof nativePassRecords>,
  expected: readonly string[],
  boundary: string,
) {
  const actual = records.map((record) => record.path).sort();
  if (
    records.some((record) => record.result !== "passed") ||
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify([...expected].sort())
  )
    return Effect.fail(
      new BoundaryError({
        boundary,
        message:
          "Native framework records do not match the exact declared selected cases",
      }),
    );
  return Effect.void;
}
