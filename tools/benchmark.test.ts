import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseBenchmark } from "./benchmark.ts";

const summary =
  "  Performed 2 updates in 4.000 ms\n  avg: 2.000 ms, min: 1.000 ms, max: 3.000 ms\n  checksum: 123\n";
const trace =
  "run 1:\ntick,scriptUpdate,wholeUpdate,luaGarbageIncremental,\nt0,250000,1000000,0,\nt1,500000,3000000,100000,\n";
const window = { ticks: 2, reloads: 1, detail: "ticks" };

test("native tick columns normalize nanoseconds without treating wall time as update time", async () => {
  const result = await Effect.runPromise(
    parseBenchmark(summary + trace, window),
  );
  expect(result.unit).toBe("ms/update");
  expect(result.samples[0]!.timings).toEqual([
    { wholeUpdate: 1, scriptUpdate: 0.25, luaGarbageIncremental: 0 },
    { wholeUpdate: 3, scriptUpdate: 0.5, luaGarbageIncremental: 0.1 },
  ]);
  expect(result.samples[0]!.totalMs).toBe(4);
  const plain = await Effect.runPromise(
    parseBenchmark(summary, { ...window, detail: "none" }),
  );
  expect(plain.samples[0]!.meanMs).toBe(2);
  expect(plain.samples[0]!.timings).toEqual([]);
});

test("missing, duplicated, malformed and reordered evidence cannot become a speed result", async () => {
  for (const text of [
    summary,
    summary + trace.replace("t1,", "t0,"),
    summary + trace.replace("t1,500000,3000000,100000,\n", ""),
    summary + trace + "t2,0,0,0,\n",
    summary + trace.replace("250000", "NaN"),
    summary + trace.replace("250000", "-1"),
    summary + trace.replace("wholeUpdate", "scriptUpdate"),
    summary.replace("4.000", "40.000") + trace,
    summary.replace("Performed 2", "Performed 3") + trace,
    summary + summary + trace,
    summary + trace.replace("run 1:", "run 2:"),
  ])
    expect(
      (await Effect.runPromise(Effect.flip(parseBenchmark(text, window))))
        .boundary,
    ).toBe("native benchmark output");
  expect(
    (
      await Effect.runPromise(
        Effect.flip(
          parseBenchmark(summary + trace, { ...window, detail: "none" }),
        ),
      )
    ).boundary,
  ).toBe("native benchmark output");
});

test("map reloads remain separately counted and must agree on simulation state", async () => {
  const result = await Effect.runPromise(
    parseBenchmark(summary + summary, { ticks: 2, reloads: 2, detail: "none" }),
  );
  expect(result.samples.map((sample) => sample.checksum)).toEqual([123, 123]);
  expect(
    (
      await Effect.runPromise(
        Effect.flip(
          parseBenchmark(summary + summary.replace("123", "124"), {
            ticks: 2,
            reloads: 2,
            detail: "none",
          }),
        ),
      )
    ).message,
  ).toContain("simulation checksums");
  expect(
    (
      await Effect.runPromise(
        Effect.flip(
          parseBenchmark(summary, {
            ticks: 100000,
            reloads: 20,
            detail: "none",
          }),
        ),
      )
    ).boundary,
  ).toBe("benchmark window");
  expect(
    (
      await Effect.runPromise(
        Effect.flip(
          parseBenchmark("", {
            ticks: 5001,
            reloads: 1,
            detail: "ticks",
          }),
        ),
      )
    ).boundary,
  ).toBe("benchmark window");
});
