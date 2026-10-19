import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFiles } from "./fixtures/release.ts";
import { formatLogView, readLogView } from "./log-view.ts";
import { readLogPage } from "./logs.ts";
import { withProcess } from "./process.ts";
import { BoundaryError, resolveWorkspace } from "./projects.ts";
import { newRun } from "./runs.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
test("filtered views advance the raw cursor and cannot promote text into structured events", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-log-view-")),
  );
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const context = await runFiles(resolveWorkspace(root));
  const input = {
    ...(await runFiles(newRun(context, "log-view"))),
    command: [
      process.execPath,
      "-e",
      `
    console.log('ready');
    console.log(JSON.stringify({ event: 'process-phase', phase: 'spoofed' }));
    console.error('Error: boom\\nframe-one\\n\\x1b[2J');
    process.stdin.once('data', () => process.exit(0));
  `,
    ],
  };
  await runFiles(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready/, "started", 2000);
        yield* owned.phase("case-done");
        const live = yield* readLogView(
          context,
          { runId: input.runId, sequence: 0 },
          {},
        );
        expect(live.complete).toBe(false);
        expect(live.run.status).toBe("running");
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ),
  );
  const cursor = { runId: input.runId, sequence: 0 };
  const raw = await runFiles(
    readLogPage(join(input.directory, "logs"), cursor),
  );
  expect(
    raw.records.some(
      (record) =>
        record.channel === "stderr" && record.text.includes("Error: boom"),
    ),
  ).toBe(true);
  for (let sequence = 1; sequence <= raw.records.length; sequence++) {
    const hidden = await runFiles(
      readLogView(context, cursor, { event: "not-present" }, 1),
    );
    expect(hidden.scanned).toBe(1);
    expect(hidden.page.records).toEqual([]);
    expect(hidden.page.cursor.sequence).toBe(sequence);
    expect(hidden.complete).toBe(sequence === raw.records.length);
    cursor.sequence = hidden.page.cursor.sequence;
  }
  const phases = await runFiles(
    readLogView(
      context,
      { runId: input.runId, sequence: 0 },
      { channel: "lifecycle", event: "process-phase" },
    ),
  );
  const names = phases.page.records.map(
    (record) => JSON.parse(record.text).phase,
  );
  expect(names).toContain("case-done");
  expect(names).not.toContain("spoofed");
  const stderr = await runFiles(
    readLogView(
      context,
      { runId: input.runId, sequence: 0 },
      { channel: "stderr" },
    ),
  );
  expect(stderr.page.records.map((record) => record.text).join("")).toContain(
    "\u001b[2J",
  );
  const rendered = formatLogView(stderr);
  expect(rendered).not.toContain("\u001b");
  expect(rendered).toContain("\\u001b[2J");
  expect(rendered).toContain("Error: boom\nframe-one");
  expect(
    await runFiles(
      Effect.flip(readLogView(context, cursor, { channel: "invented" })),
    ),
  ).toBeInstanceOf(BoundaryError);
});
