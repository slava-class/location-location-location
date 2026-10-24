import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { fleetStatus } from "./fleet.ts";
import { inventoryFiles } from "./files.ts";
import { releaseFixture, runFiles } from "./fixtures/release.ts";
import { createLog } from "./logs.ts";
import { withProcess } from "./process.ts";
import { BoundaryError } from "./projects.ts";
import { listRuns } from "./run-status.ts";
import { announceRun, newRun } from "./runs.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
let sequence = 0;
async function register(
  fixture: Awaited<ReturnType<typeof releaseFixture>>,
  status: "passed" | "failed" = "passed",
  sealed = true,
) {
  const run = await runFiles(newRun(fixture.project, "verify"));
  const startedAt = new Date(Date.UTC(2026, 0, 1) + sequence++).toISOString();
  const template = fixture.manifest.evidence.verification;
  const identity = {
    schema: 2,
    runId: run.runId,
    mod: template.mod,
    directory: run.directory,
    ownerPid: process.pid,
    source: template.source,
    capabilities: template.capabilities,
    startedAt,
    elapsedMs: 1,
  };
  const receipt =
    status === "passed"
      ? { ...template, ...identity }
      : {
          ...identity,
          status,
          phase: "audit",
          completed: template.completed.slice(0, 2),
          timings: template.timings.slice(0, 2),
          error: "Required locale is missing",
        };
  const path = join(run.directory, "verify.json");
  await writeFile(path, JSON.stringify(receipt));
  const log = await runFiles(createLog(join(run.directory, "logs"), run.runId));
  await runFiles(
    announceRun({ ...run, kind: "verification", backend: "native", startedAt }),
  );
  if (sealed) await runFiles(log.seal);
  return { run, path, receipt, log };
}

// Synthetic qualified receipts test readback semantics, not Factorio behavior.
test("fleet observation is read-only and distinguishes missing verification from a qualified prepared bundle", async () => {
  const fixture = await releaseFixture(roots);
  const before = await runFiles(inventoryFiles(fixture.root));
  const report = await runFiles(fleetStatus([fixture.project]));
  const row = report.projects[0]!;
  expect(row.verification.freshness).toBe("missing");
  expect(row.verification.latestReadable).toBeNull();
  expect(row.prepared.state).toBe("ready");
  expect(row.portal).toEqual({
    state: "unknown",
    refresh: ["mise", "run", "release-status", "--", "primary"],
  });
  expect(await runFiles(inventoryFiles(fixture.root))).toEqual(before);
  await writeFile(
    join(fixture.directory, fixture.manifest.archive.file),
    "damaged package",
  );
  expect(
    (await runFiles(fleetStatus([fixture.project]))).projects[0]!.prepared
      .state,
  ).toBe("unusable");
});

test("fleet freshness follows selected source while unrelated mod edits preserve current proof", async () => {
  const fixture = await releaseFixture(roots, true);
  const evidence = await register(fixture);
  const current = (await runFiles(fleetStatus([fixture.project]))).projects[0]!;
  expect(current.verification.freshness).toBe("current");
  expect(current.verification.latestReadable?.status).toBe("passed");
  expect(
    current.verification.latestReadable?.profiles?.map(
      (entry) => entry.profile,
    ),
  ).toEqual(["base"]);
  await writeFile(
    join(fixture.root, "mods/unrelated/change.lua"),
    "return 1\n",
  );
  expect(
    (await runFiles(fleetStatus([fixture.project]))).projects[0]!.verification
      .freshness,
  ).toBe("current");
  await writeFile(
    join(fixture.project.modRoot, "selected-change.lua"),
    "return 2\n",
  );
  const stale = (await runFiles(fleetStatus([fixture.project]))).projects[0]!;
  expect(stale.verification.freshness).toBe("stale");
  expect(stale.verification.latestReadable?.runId).toBe(evidence.run.runId);
  expect(stale.prepared.state).toBe("unusable");
  expect(stale.commands).toContainEqual([
    "mise",
    "run",
    "verify",
    "--",
    "primary",
  ]);
});

test("newer failed verification is not hidden by older success or newer helper commands", async () => {
  const fixture = await releaseFixture(roots);
  const passed = await register(fixture);
  const failed = await register(fixture, "failed");
  const command = {
    ...(await runFiles(newRun(fixture.project, "helper"))),
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  await runFiles(withProcess(command, (owned) => owned.waitForExit));
  const row = (await runFiles(fleetStatus([fixture.project]))).projects[0]!;
  expect(row.verification.freshness).toBe("current");
  expect(row.verification.latestReadable?.runId).toBe(failed.run.runId);
  expect(row.verification.latestReadable?.status).toBe("failed");
  expect(row.verification.latestReadable?.error).toBe(
    "Required locale is missing",
  );
  expect(row.verification.latestReadable?.profiles).toBeNull();
  const first = await runFiles(
    listRuns([fixture.project], {
      active: false,
      kind: "verification",
      limit: 1,
    }),
  );
  const next = await runFiles(
    listRuns([fixture.project], {
      active: false,
      kind: "verification",
      limit: 1,
      after: first.next,
    }),
  );
  expect(first.runs.map((run) => run.record.run)).toEqual([failed.run.runId]);
  expect(next.runs.map((run) => run.record.run)).toEqual([passed.run.runId]);
  expect(
    await runFiles(
      Effect.flip(
        listRuns([fixture.project], {
          active: false,
          kind: "verification",
          limit: 1,
          after: command.runId,
        }),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});

test("unsealed success and damaged newer history cannot produce a green current result", async () => {
  const fixture = await releaseFixture(roots);
  const older = await register(fixture);
  const newer = await register(fixture, "passed", false);
  const pending = (await runFiles(fleetStatus([fixture.project]))).projects[0]!;
  expect(pending.verification.latestReadable?.status).toBe("finalizing");
  expect(pending.commands).toContainEqual([
    "mise",
    "run",
    "verify",
    "--",
    "primary",
  ]);
  await runFiles(newer.log.seal);
  await writeFile(newer.path, '{"partial":');
  const damaged = (await runFiles(fleetStatus([fixture.project]))).projects[0]!;
  expect(damaged.verification.freshness).toBe("unknown");
  expect(damaged.verification.latestReadable?.runId).toBe(older.run.runId);
  expect(damaged.verification.history.issueCount).toBe(1);
  expect(damaged.verification.history.issues[0]?.run).toBe(newer.run.runId);
});

test("a passed receipt with missing declared engine coverage is rejected", async () => {
  const fixture = await releaseFixture(roots, true);
  const evidence = await register(fixture);
  await writeFile(
    evidence.path,
    JSON.stringify({ ...evidence.receipt, engine: [] }),
  );
  const failure = await runFiles(Effect.flip(fleetStatus([fixture.project])));
  expect(failure).toBeInstanceOf(BoundaryError);
  expect(String(failure)).toContain("declared engine profiles");
});
