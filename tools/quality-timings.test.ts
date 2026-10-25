import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./commands.ts";
import { BoundaryError } from "./projects.ts";
import {
  retainQualityTimings,
  summarizeTrunkTimings,
} from "./quality-timings.ts";

const repository = "/workspace/workshop";
const action = (file: string, batch: string, duration = "10") => ({
  paths: [file],
  linter: "checker",
  command: "lint",
  report: `${repository}/.trunk/out/${batch}.yaml`,
  verb: "TRUNK_VERB_CHECK",
  actionDurationMs: duration,
  cacheHit: "CACHE_HIT_NONE",
});
const report = (lintActions: unknown[], fileCount = "3") => ({
  lintActions,
  checkStats: { fileCount },
});

test("shared per-file actions count once per actual batch, not once per file or duration", async () => {
  const timings = await Effect.runPromise(
    summarizeTrunkTimings(
      report([
        action("a.ts", "first"),
        action("b.ts", "first"),
        action("c.ts", "second"),
        {
          ...action("a.ts", "format", "7"),
          command: "format",
          verb: "TRUNK_VERB_FMT",
        },
      ]),
      repository,
      ["a.ts", "b.ts", "c.ts"],
      "TRUNK_VERB_CHECK",
    ),
  );
  expect(timings).toEqual([
    {
      checker: "checker",
      command: "format",
      batches: [{ id: "format.yaml", files: ["a.ts"], elapsedMs: 7 }],
      totalBatchMs: 7,
      longestBatchMs: 7,
    },
    {
      checker: "checker",
      command: "lint",
      batches: [
        { id: "first.yaml", files: ["a.ts", "b.ts"], elapsedMs: 10 },
        { id: "second.yaml", files: ["c.ts"], elapsedMs: 10 },
      ],
      totalBatchMs: 20,
      longestBatchMs: 10,
    },
  ]);
});

test("ambiguous batches, another invocation's scope, cached work and malformed durations cannot become timing evidence", async () => {
  for (const invalid of [
    report([action("a.ts", "first"), action("b.ts", "first", "11")]),
    report([
      action("a.ts", "first"),
      { ...action("b.ts", "first"), linter: "other" },
    ]),
    report([
      action("a.ts", "first"),
      { ...action("b.ts", "first"), command: "format" },
    ]),
    report([
      {
        ...action("a.ts", "first"),
        report: "/elsewhere/.trunk/out/first.yaml",
      },
    ]),
    report([
      action("a.ts", "first"),
      { ...action("b.ts", "first"), verb: "TRUNK_VERB_FMT" },
    ]),
    report([{ ...action("a.ts", "first"), verb: "UNKNOWN" }]),
    report([]),
    report([{ ...action("a.ts", "first"), cacheHit: "CACHE_HIT_LOCAL" }]),
    report([action("a.ts", "first", "-1")]),
    report([action("a.ts", "first", "NaN")]),
    report([action("a.ts", "first", "9007199254740992")]),
    report([{ ...action("a.ts", "first"), actionDurationMs: undefined }]),
    report([{ ...action("a.ts", "first"), paths: ["../outside.ts"] }]),
    report([action("not-selected.ts", "first")]),
    { checkStats: { fileCount: "3" } },
  ]) {
    expect(
      Effect.runPromise(
        summarizeTrunkTimings(
          invalid,
          repository,
          ["a.ts", "b.ts", "c.ts"],
          "TRUNK_VERB_CHECK",
        ),
      ),
    ).rejects.toBeInstanceOf(BoundaryError);
  }
});

test("native format invocations preserve zero durations without inventing a nonzero minimum", async () => {
  const timings = await Effect.runPromise(
    summarizeTrunkTimings(
      report(
        [
          {
            ...action("a.ts", "format", "0"),
            command: "format",
            verb: "TRUNK_VERB_FMT",
          },
        ],
        "1",
      ),
      repository,
      ["a.ts"],
      "TRUNK_VERB_FMT",
    ),
  );
  expect(timings[0]?.batches).toEqual([
    { id: "format.yaml", files: ["a.ts"], elapsedMs: 0 },
  ]);
  expect(timings[0]?.totalBatchMs).toBe(0);
});

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("missing and invalid native output leave explicit unavailable diagnostics, and a mismatched run cannot claim them", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "quality-timings-")),
  );
  directories.push(root);
  const command = await Effect.runPromise(
    runCommand(
      { repoRoot: root, outputRoot: join(root, "output") },
      "timing-boundary",
      [process.execPath, "-e", "process.exit(0)"],
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const capture = () =>
    Effect.runPromise(
      retainQualityTimings(command.run, ["a.ts"], "TRUNK_VERB_CHECK").pipe(
        Effect.provide(BunServices.layer),
      ),
    );
  for (const native of [undefined, "{malformed"]) {
    if (native !== undefined)
      await writeFile(join(command.run.directory, "trunk.json"), native);
    const receipt = await capture();
    expect(receipt.status).toBe("unavailable");
    expect(receipt).not.toHaveProperty("checkers");
    const persisted = JSON.parse(
      await readFile(
        join(command.run.directory, "quality-timings.json"),
        "utf8",
      ),
    );
    expect(persisted.status).toBe("unavailable");
    expect(persisted.runId).toBe(command.run.runId);
  }
  expect(
    Effect.runPromise(
      retainQualityTimings(
        {
          ...command.run,
          runId: crypto.randomUUID(),
        },
        ["a.ts"],
        "TRUNK_VERB_CHECK",
      ).pipe(Effect.provide(BunServices.layer)),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
});
