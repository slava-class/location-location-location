import { expect, test } from "bun:test";
import { Effect } from "effect";
import { BoundaryError } from "./projects.ts";
import { parseDependency, satisfies } from "./dependencies.ts";
import { parseEngineVersion } from "./engine.ts";
import { verifyEngineDiagnostics } from "./engine-diagnostics.ts";
import {
  nativePassRecords,
  selectedCases,
  verifyNativeCases,
  verifyTestResult,
} from "./test-results.ts";
import type { Inventory, TestResult } from "./test-results.ts";

const inventory: Inventory = {
  schema: 1,
  profiles: ["base", "native"],
  cases: [
    { path: "pairing", passedIn: ["base"], skippedIn: ["native"] },
    { path: "repair", passedIn: ["base"], skippedIn: ["native"] },
    { path: "capture", passedIn: ["native"], skippedIn: ["base"] },
  ],
};
const result: typeof TestResult.Type = {
  timestamp: "2026-10-17T18:00:00Z",
  modName: "detector",
  summary: {
    passed: 2,
    ran: 2,
    skipped: 1,
    failed: 0,
    todo: 0,
    cancelled: 0,
    describeBlockErrors: 0,
    status: "passed",
  },
  tests: [
    { path: "repair", result: "passed" },
    { path: "capture", result: "skipped" },
    { path: "pairing", result: "passed" },
  ],
};

test("selected profile coverage distinguishes intentional exclusions from missing cases", async () => {
  const expected = await Effect.runPromise(selectedCases(inventory, "base"));
  expect(expected).toEqual({
    passed: ["pairing", "repair"],
    skipped: ["capture"],
  });
  await Effect.runPromise(verifyTestResult(result, "detector", expected));
  for (const tests of [
    result.tests.slice(1),
    [...result.tests, result.tests[0]!],
    result.tests.map((item) =>
      item.path === "repair" ? { ...item, path: "unreviewed case" } : item,
    ),
    result.tests.map((item) =>
      item.path === "repair" ? { ...item, result: "skipped" as const } : item,
    ),
  ])
    expect(
      Effect.runPromise(
        verifyTestResult({ ...result, tests }, "detector", expected),
      ),
    ).rejects.toBeInstanceOf(BoundaryError);
  expect(
    Effect.runPromise(
      verifyTestResult(
        { ...result, modName: "another-mod" },
        "detector",
        expected,
      ),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(
    Effect.runPromise(
      verifyTestResult(
        { ...result, summary: { ...result.summary, describeBlockErrors: 1 } },
        "detector",
        expected,
      ),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
});
test("ambiguous and undeclared inventory profiles cannot bless a run", async () => {
  for (const document of [
    { ...inventory, cases: [...inventory.cases, inventory.cases[0]!] },
    {
      ...inventory,
      cases: [
        {
          path: "pairing",
          passedIn: ["base"] as const,
          skippedIn: ["base"] as const,
        },
      ],
    },
    { ...inventory, profiles: ["native"] as const },
  ])
    expect(
      Effect.runPromise(selectedCases(document, "base")),
    ).rejects.toBeInstanceOf(BoundaryError);
});
test("native evidence requires each selected case exactly once and retains failures", async () => {
  const log =
    " 1.100 Script @__factorio-test__/_factorio-test.lua:835: PASS capture (<Profiler>)\n";
  const records = nativePassRecords(log);
  expect(records).toEqual([{ path: "capture", result: "passed" }]);
  await Effect.runPromise(verifyNativeCases(records, ["capture"], "native"));
  for (const evidence of [
    [],
    [...records, ...records],
    nativePassRecords(log.replace("PASS", "FAIL")),
    nativePassRecords(log.replace("capture", "unreviewed")),
  ])
    expect(
      Effect.runPromise(verifyNativeCases(evidence, ["capture"], "native")),
    ).rejects.toBeInstanceOf(BoundaryError);
});
const mod = { name: "detector", title: "Detector", version: "1.0.0" };
const intentional =
  " 5.569 Error Util.cpp:81: The mod Detector (1.0.0) caused a non-recoverable error.\nPlease report this error to the mod author.\n\nError while running event detector::on_tick (ID 0)\n__factorio-test__/_factorio-test.lua:1054: FACTORIO-TEST-EXIT\nstack traceback:\n\t[C]: in function 'error'\n\t__factorio-test__/_factorio-test.lua:1054: in function 'emitResult'\n 5.610 Goodbye\n";
test("only the framework-owned termination is accepted headlessly, never unrelated errors", async () => {
  await Effect.runPromise(
    verifyEngineDiagnostics(intentional, "factorio-test-exit", mod),
  );
  for (const log of [
    intentional.replace("in function 'emitResult'", "in function 'crash'"),
    intentional.replace(
      "__factorio-test__/_factorio-test.lua:1054: FACTORIO-TEST-EXIT",
      "__detector__/control.lua:9: FACTORIO-TEST-EXIT",
    ),
    intentional + " 5.700 Error Util.cpp:81: another failure\n",
    " 1.000 Goodbye\n",
  ])
    expect(
      Effect.runPromise(
        verifyEngineDiagnostics(log, "factorio-test-exit", mod),
      ),
    ).rejects.toBeInstanceOf(BoundaryError);
  await Effect.runPromise(
    verifyEngineDiagnostics(" 1.000 Goodbye\n", "clean", mod),
  );
  for (const log of [
    intentional,
    " 1.000 Info GlobalContext.cpp:1: stopping\n",
  ])
    expect(
      Effect.runPromise(verifyEngineDiagnostics(log, "clean", mod)),
    ).rejects.toBeInstanceOf(BoundaryError);
});
test("native recommended dependencies and version-independent incompatibilities retain engine semantics", async () => {
  const recommended = await Effect.runPromise(
    parseDependency("+ quality >= 2.1.0"),
  );
  expect(recommended.kind).toBe("recommended");
  expect(satisfies("2.1.21", recommended)).toBe(true);
  expect(satisfies("2.0.0", recommended)).toBe(false);
  const incompatible = await Effect.runPromise(
    parseDependency("! old-mod >= 9.0.0"),
  );
  expect(satisfies("1.0.0", incompatible)).toBe(false);
  expect(satisfies("10.0.0", incompatible)).toBe(false);
});
test("two-component native dependency versions mean patch zero, not a wildcard", async () => {
  for (const [operator, expected] of [
    [">=", true],
    [">", true],
    ["=", false],
    ["<=", false],
    ["<", false],
  ] as const) {
    const requirement = await Effect.runPromise(
      parseDependency(`base ${operator} 2.1`),
    );
    expect(requirement.version).toBe("2.1.0");
    expect(satisfies("2.1.21", requirement)).toBe(expected);
  }
  const exact = await Effect.runPromise(parseDependency("base = 2.1"));
  expect(satisfies("2.1.0", exact)).toBe(true);
  expect(satisfies("2.1.1", exact)).toBe(false);
  expect(
    await Effect.runPromise(Effect.flip(parseDependency("base >= 2.65536"))),
  ).toBeInstanceOf(BoundaryError);
});
test("Steam and standalone version probes retain their real distribution identities", async () => {
  const steam = await Effect.runPromise(
    parseEngineVersion(
      "Version: 2.1.21 (build 87673, mac-arm64, steam)\nVersion: 64\n",
    ),
  );
  const full = await Effect.runPromise(
    parseEngineVersion("Version: 2.1.21 (build 87673, mac-arm64, full)\n"),
  );
  expect(steam.distribution).toBe("steam");
  expect(full.distribution).toBe("full");
  expect(
    Effect.runPromise(
      parseEngineVersion("Version: 2.1.21 (build 87673, mac-arm64, unknown)"),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
});
