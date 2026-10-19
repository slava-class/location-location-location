import { Effect, Schema } from "effect";
import { ElapsedMs } from "./contracts.ts";
import { BoundaryError, decode } from "./projects.ts";

const Count = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 100000 }),
);
export const BenchmarkWindow = Schema.Struct({
  ticks: Count,
  reloads: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  detail: Schema.Literals(["none", "ticks"]),
}).check(
  Schema.makeFilter(
    (value) =>
      value.ticks * value.reloads <= (value.detail === "ticks" ? 5000 : 100000),
  ),
);
const TickTiming = Schema.Struct({
  wholeUpdate: ElapsedMs,
  scriptUpdate: ElapsedMs,
  luaGarbageIncremental: ElapsedMs,
});
export const BenchmarkResult = Schema.Struct({
  unit: Schema.Literal("ms/update"),
  window: BenchmarkWindow,
  samples: Schema.Array(
    Schema.Struct({
      ticks: Count,
      totalMs: ElapsedMs,
      meanMs: ElapsedMs,
      minimumMs: ElapsedMs,
      maximumMs: ElapsedMs,
      checksum: Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: 4294967295 }),
      ),
      timings: Schema.Array(TickTiming),
    }),
  ),
});
const decimal = "([0-9]+(?:\\.[0-9]+)?)";
const summary = new RegExp(
  `^  Performed ([0-9]+) updates in ${decimal} ms\\r?\\n  avg: ${decimal} ms, min: ${decimal} ms, max: ${decimal} ms\\r?\\n  checksum: ([0-9]+)\\r?$`,
  "gm",
);
const columns = Object.keys(TickTiming.fields);

/** Decode the selected engine's millisecond summaries and nanosecond tick rows. */
export function parseBenchmark(text: string, input: unknown) {
  return Effect.gen(function* () {
    const window = yield* decode(BenchmarkWindow, input, "benchmark window");
    const fail = (message: string) =>
      Effect.fail(
        new BoundaryError({ boundary: "native benchmark output", message }),
      );
    const matches = [...text.matchAll(summary)];
    if (
      matches.length !== window.reloads ||
      (text.match(/^  Performed /gm) ?? []).length !== window.reloads
    )
      return yield* fail(
        "Missing, duplicate or incomplete benchmark summaries",
      );
    const samples = matches.map((match) => ({
      ticks: Number(match[1]),
      totalMs: Number(match[2]),
      meanMs: Number(match[3]),
      minimumMs: Number(match[4]),
      maximumMs: Number(match[5]),
      checksum: Number(match[6]),
      timings: [] as (typeof TickTiming.Type)[],
    }));
    for (const sample of samples) {
      // Native decimal output is rounded to three places, independently per field.
      if (
        sample.ticks !== window.ticks ||
        sample.minimumMs > sample.meanMs ||
        sample.meanMs > sample.maximumMs ||
        Math.abs(sample.totalMs / sample.ticks - sample.meanMs) > 0.000501
      )
        return yield* fail("Benchmark window or summary arithmetic disagrees");
    }
    if (new Set(samples.map((sample) => sample.checksum)).size !== 1)
      return yield* fail(
        "Identical map reloads produced different simulation checksums",
      );
    let run = -1;
    let header: string[] | undefined;
    let indices: number[] = [];
    for (const line of text.split(/\r?\n/u)) {
      const start = /^run ([0-9]+):$/u.exec(line);
      if (start) {
        if (
          window.detail === "none" ||
          Number(start[1]) !== run + 2 ||
          (run >= 0 && samples[run]!.timings.length !== window.ticks)
        )
          return yield* fail("Unexpected, reordered or incomplete verbose run");
        run++;
        if (run >= samples.length) return yield* fail("Extra verbose run");
        header = undefined;
        continue;
      }
      if (line.startsWith("tick,")) {
        if (run < 0 || header !== undefined)
          return yield* fail("Unexpected or duplicate timing header");
        const cells = line.split(",");
        if (cells.at(-1) === "") cells.pop();
        header = cells;
        indices = columns.map((column) => cells.indexOf(column));
        if (
          new Set(cells).size !== cells.length ||
          indices.some((index) => index < 1)
        )
          return yield* fail("Missing or duplicate required timing columns");
        continue;
      }
      if (line.startsWith("t")) {
        if (header === undefined || run < 0)
          return yield* fail("Tick row has no run header");
        const cells = line.split(",");
        if (cells.at(-1) === "") cells.pop();
        const target = samples[run]!;
        if (
          cells.length !== header.length ||
          cells[0] !== `t${target.timings.length}` ||
          target.timings.length >= window.ticks ||
          cells.slice(1).some((cell) => !/^[0-9]+$/u.test(cell))
        )
          return yield* fail(
            "Malformed, missing, duplicate or out-of-order tick row",
          );
        const timing = Object.fromEntries(
          columns.map((column, index) => [
            column,
            Number(cells[indices[index]!]!) / 1000000,
          ]),
        );
        target.timings.push(
          yield* decode(TickTiming, timing, "native tick timing"),
        );
      }
    }
    if (
      window.detail === "ticks" &&
      (run + 1 !== window.reloads ||
        samples.some((sample) => sample.timings.length !== window.ticks))
    )
      return yield* fail("Incomplete verbose timing evidence");
    return yield* decode(
      BenchmarkResult,
      { unit: "ms/update", window, samples },
      "native benchmark result",
    );
  });
}
