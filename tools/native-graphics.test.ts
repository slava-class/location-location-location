import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyNativeGraphics,
  waitForNativeGraphics,
} from "./native-graphics.ts";
import { BoundaryError, resolveWorkspace } from "./projects.ts";
import { newRun } from "./runs.ts";
import { withProcess } from "./process.ts";
import { runFiles } from "./fixtures/release.ts";

const expected = { width: 1600, height: 1000, graphics: "low" as const };
const geometry = (window = "1600x1000", drawable = window) =>
  ` 0.594 [Size] Window: ${window}, Drawable: ${drawable}\n`;
const preset = " 0.594 Forced graphics settings preset: low\n";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("native graphics evidence qualifies window, drawable and explicit preset", async () => {
  expect(
    await Effect.runPromise(
      verifyNativeGraphics(geometry() + preset, expected, "probe"),
    ),
  ).toEqual({
    window: { width: 1600, height: 1000 },
    drawable: { width: 1600, height: 1000 },
    graphics: "low",
  });
});

test.each([
  ["clamped window", geometry("1600x939") + preset],
  ["scaled drawable", geometry("1600x1000", "3200x2000") + preset],
  ["wrong preset", geometry() + preset.replace("low", "extreme")],
  ["missing geometry", preset],
  ["missing preset", geometry()],
  ["invalid dimension", geometry("1600x0") + preset],
  ["later resize", geometry() + preset + geometry("1600x939")],
])("native graphics rejects %s", async (_name, log) => {
  expect(
    await Effect.runPromise(
      Effect.flip(verifyNativeGraphics(log, expected, "probe")),
    ),
  ).toBeInstanceOf(BoundaryError);
});

test("native graphics readback uses the latest complete dimensions", async () => {
  const observed = await Effect.runPromise(
    verifyNativeGraphics(
      geometry("800x600") + preset + geometry(),
      expected,
      "probe",
    ),
  );
  expect(observed.window).toEqual({ width: 1600, height: 1000 });
});

test.each([true, false])(
  "native preflight gates expensive startup when geometry matches=%s",
  async (matches) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "modkit-native-graphics-")),
    );
    roots.push(root);
    await writeFile(
      join(root, "package.json"),
      '{"private":true,"type":"module"}',
    );
    const workspace = await runFiles(resolveWorkspace(root));
    const run = await runFiles(newRun(workspace, "graphics-preflight"));
    const marker = join(run.directory, "asset-load-started");
    const text = geometry(matches ? "1600x1000" : "1600x939") + preset;
    const operation = withProcess(
      {
        ...run,
        command: [
          process.execPath,
          "-e",
          `process.stdout.write(${JSON.stringify(text)});for await(const chunk of Bun.stdin.stream()){await Bun.write(${JSON.stringify(marker)}, "loaded");console.log("assets-loaded");}`,
        ],
        deadlineMs: 5000,
        shutdownMs: 500,
      },
      (child) =>
        Effect.gen(function* () {
          yield* waitForNativeGraphics(child, expected, 2000);
          yield* child.send("load\n");
          yield* child.waitForText(/assets-loaded/, "assets", 2000);
          yield* child.stop;
        }),
    );
    if (matches) {
      await runFiles(operation);
      expect(await readFile(marker, "utf8")).toBe("loaded");
    } else {
      const error = await runFiles(Effect.flip(operation));
      expect(String(error)).toContain(
        "observed window=1600x939, drawable=1600x939",
      );
      expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const receipt = JSON.parse(
      await readFile(join(run.directory, "process.json"), "utf8"),
    );
    expect(receipt.status).toBe(matches ? "passed" : "failed");
    expect(receipt.finalizationErrors).toEqual([]);
  },
);
