import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { releaseFixture, runFiles } from "./fixtures/release.ts";
import { createLog } from "./logs.ts";
import { readLogView } from "./log-view.ts";
import { withProcess } from "./process.ts";
import { BoundaryError, readJSON, resolveWorkspace } from "./projects.ts";
import { listRuns, readRun } from "./run-status.ts";
import { announceRun, newRun } from "./runs.ts";
import { selectedCases, TestInventory } from "./test-results.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function workspace() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-run-state-")),
  );
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  return runFiles(resolveWorkspace(root));
}
const serve =
  "console.log('ready');process.stdin.once('data',()=>process.exit(0));";
test("discovery observes a quiet live command, then its sealed terminal state", async () => {
  const context = await workspace();
  const input = {
    ...(await runFiles(newRun(context, "quiet"))),
    command: [process.execPath, "-e", serve],
  };
  await runFiles(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready/, "ready", 2000);
        const live = yield* readRun(context, input.runId);
        expect(live.status).toBe("running");
        expect(live.owner).toBe("pid-present-unverified");
        expect(live.log.closed).toBe(false);
        const active = yield* listRuns([context], { active: true, limit: 5 });
        expect(active.runs.map((run) => run.record.run)).toEqual([input.runId]);
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ),
  );
  const complete = await runFiles(readRun(context, input.runId));
  expect(complete.status).toBe("passed");
  expect(complete.proof).toBe("not-applicable");
  expect(complete.log.closed).toBe(true);
  expect(
    (await runFiles(listRuns([context], { active: true, limit: 5 }))).runs,
  ).toEqual([]);
});
test("live studio logs and terminal status do not require or claim package-smoke proof", async () => {
  const context = await workspace();
  const input = {
    ...(await runFiles(newRun(context, "studio-live"))),
    command: [process.execPath, "-e", serve],
    evidence: "studio",
  };
  await runFiles(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready/, "ready", 2000);
        const live = yield* readLogView(
          context,
          { runId: input.runId, sequence: 0 },
          {},
        );
        expect(live.run.status).toBe("running");
        expect(live.run.proof).toBe("not-applicable");
        expect(live.complete).toBe(false);
        const active = yield* listRuns([context], { active: true, limit: 5 });
        expect(active.runs.map((run) => run.record.run)).toEqual([input.runId]);
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ),
  );
  const completed = await runFiles(
    readLogView(context, { runId: input.runId, sequence: 0 }, {}),
  );
  expect(completed.run.status).toBe("passed");
  expect(completed.run.proof).toBe("not-applicable");
  expect(completed.complete).toBe(true);
});
test("exit zero stays finalizing until matching complete engine proof arrives", async () => {
  const fixture = await releaseFixture(roots, true);
  const template = fixture.manifest.evidence.verification.engine[0]!;
  const input = {
    ...(await runFiles(newRun(fixture.project, "test-base-en"))),
    command: [process.execPath, "-e", "process.exit(0)"],
    evidence: "engine-suite",
  };
  const request = { ...template.request, runId: input.runId };
  const result = {
    ...template,
    directory: input.directory,
    request,
    observed: { ...template.observed, ...request },
  };
  const inventory = await runFiles(
    readJSON(
      TestInventory,
      join(fixture.project.modRoot, "dev/engine-inventory.json"),
    ),
  );
  const expected = await runFiles(selectedCases(inventory, "base"));
  await writeFile(
    join(input.directory, "verification-request.json"),
    JSON.stringify({
      request,
      engine: result.engine,
      graphics: result.graphics,
      source: result.source,
      directory: result.directory,
      inventorySha256: result.inventorySha256,
      seedSha256: result.seedSha256,
      fixtureSha256: result.fixtureSha256,
      startedAt: result.startedAt,
      elapsedMs: 0,
      timings: [],
      expectedMods: result.observed.activeMods,
      expected,
    }),
  );
  await runFiles(withProcess(input, (owned) => owned.waitForExit));
  const pending = await runFiles(readRun(fixture.project, input.runId));
  expect(pending.process?.status).toBe("passed");
  expect(pending.log.closed).toBe(true);
  expect(pending.status).toBe("finalizing");
  expect(pending.proof).toBe("pending");
  const pendingLog = await runFiles(
    readLogView(fixture.project, { runId: input.runId, sequence: 0 }, {}),
  );
  expect(pendingLog.page.complete).toBe(true);
  expect(pendingLog.complete).toBe(false);
  const path = join(input.directory, "verification.json");
  await writeFile(path, JSON.stringify(result));
  expect((await runFiles(readRun(fixture.project, input.runId))).status).toBe(
    "passed",
  );
  const qualifiedLog = await runFiles(
    readLogView(fixture.project, pendingLog.page.cursor, {}),
  );
  expect(qualifiedLog.complete).toBe(true);
  expect(qualifiedLog.run.proof).toBe("passed");
  await writeFile(path, JSON.stringify({ ...result, graphics: "low" }));
  expect(
    await runFiles(Effect.flip(readRun(fixture.project, input.runId))),
  ).toBeInstanceOf(BoundaryError);
  await writeFile(
    path,
    JSON.stringify({
      ...result,
      request: { ...request, artifactSha256: "0".repeat(64) },
    }),
  );
  expect(
    await runFiles(Effect.flip(readRun(fixture.project, input.runId))),
  ).toBeInstanceOf(BoundaryError);
  await writeFile(path, JSON.stringify({ ...result, passed: [] }));
  expect(
    await runFiles(Effect.flip(readRun(fixture.project, input.runId))),
  ).toBeInstanceOf(BoundaryError);
  await writeFile(
    path,
    JSON.stringify({
      request,
      engine: result.engine,
      graphics: result.graphics,
      source: result.source,
      directory: result.directory,
      inventorySha256: result.inventorySha256,
      seedSha256: result.seedSha256,
      fixtureSha256: result.fixtureSha256,
      startedAt: result.startedAt,
      elapsedMs: 1,
      timings: [{ phase: "process", elapsedMs: 1 }],
      status: "failed",
      error: "Fixture assertion failure after exit zero",
    }),
  );
  const failed = await runFiles(readRun(fixture.project, input.runId));
  expect(failed.status).toBe("failed");
  expect(failed.process?.status).toBe("passed");
  expect(failed.proof).toBe("failed");
  const reported = {
    timestamp: result.startedAt,
    modName: fixture.project.info.name,
    summary: { ...template.summary, passed: 0, failed: 1, status: "failed" },
    tests: [{ path: expected.passed[0], result: "failed" }],
  };
  const results = join(input.directory, "results.json");
  await writeFile(results, JSON.stringify(reported));
  const assertion = await runFiles(readRun(fixture.project, input.runId));
  expect(assertion.diagnostics.kinds).toEqual(["assertion"]);
  expect(assertion.diagnostics.reportedCases).toEqual(expected.passed);
  for (const invalid of [
    { ...reported, modName: "foreign-mod" },
    { ...reported, tests: [...reported.tests, ...reported.tests] },
    {
      ...reported,
      tests: [
        { path: "foreign-module > " + expected.passed[0], result: "failed" },
      ],
    },
  ]) {
    await writeFile(results, JSON.stringify(invalid));
    const rejected = await runFiles(readRun(fixture.project, input.runId));
    expect(rejected.status).toBe("failed");
    expect(rejected.diagnostics.kinds).toEqual(["invalid-evidence"]);
    expect(rejected.diagnostics.reportedCases).toEqual([]);
  }
});
test("an aggregate success is finalizing until its diagnostic stream seals", async () => {
  const fixture = await releaseFixture(roots);
  const input = await runFiles(newRun(fixture.project, "verify"));
  const log = await runFiles(
    createLog(join(input.directory, "logs"), input.runId),
  );
  const startedAt = new Date().toISOString();
  await writeFile(
    join(input.directory, "verify.json"),
    JSON.stringify({
      ...fixture.manifest.evidence.verification,
      runId: input.runId,
      directory: input.directory,
      ownerPid: process.pid,
      startedAt,
    }),
  );
  await runFiles(
    announceRun({
      ...input,
      kind: "verification",
      backend: "native",
      startedAt,
    }),
  );
  expect((await runFiles(readRun(fixture.project, input.runId))).status).toBe(
    "finalizing",
  );
  await runFiles(log.seal);
  expect((await runFiles(readRun(fixture.project, input.runId))).status).toBe(
    "passed",
  );
});
test("lost owners are interrupted, never inferred successful from sealed logs", async () => {
  const context = await workspace();
  const input = {
    ...(await runFiles(newRun(context, "lost-owner"))),
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  await runFiles(withProcess(input, (owned) => owned.waitForExit));
  const processPath = join(input.directory, "process.json"),
    recordPath = join(input.directory, "run.json");
  const receipt = JSON.parse(await readFile(processPath, "utf8"));
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  await writeFile(
    processPath,
    JSON.stringify({
      ...receipt,
      status: "running",
      ownerPid: receipt.childPid,
    }),
  );
  await writeFile(
    recordPath,
    JSON.stringify({ ...record, ownerPid: receipt.childPid }),
  );
  const view = await runFiles(readRun(context, input.runId));
  expect(view.status).toBe("interrupted");
  expect(view.owner).toBe("not-present");
  expect(view.log.closed).toBe(true);
  const sealed = await runFiles(
    readLogView(context, { runId: input.runId, sequence: 0 }, {}),
  );
  expect(sealed.complete).toBe(true);
  expect(sealed.run.status).toBe("interrupted");
  await rm(join(input.directory, "logs", "log-final.json"));
  await writeFile(
    join(input.directory, "logs", "events-00000000.jsonl"),
    '{"schema":2',
    { flag: "a" },
  );
  const partial = await runFiles(
    readLogView(context, { runId: input.runId, sequence: 0 }, {}),
  );
  expect(partial.complete).toBe(true);
  expect(partial.run.status).toBe("interrupted");
  expect(partial.run.logsClosed).toBe(false);
  expect(partial.page.complete).toBe(false);
  expect(partial.page.partialRecord).toBe(true);
});
test("bounded listings paginate without duplicates and report unregistered evidence", async () => {
  const context = await workspace();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const input = {
      ...(await runFiles(newRun(context, "history"))),
      command: [process.execPath, "-e", "process.exit(0)"],
    };
    await runFiles(withProcess(input, (owned) => owned.waitForExit));
    ids.push(input.runId);
  }
  await mkdir(join(context.outputRoot, "runs", randomUUID()));
  const first = await runFiles(
    listRuns([context], { active: false, limit: 1 }),
  );
  expect(first.status).toBe("partial");
  expect(first.unregisteredDirectories).toBe(1);
  expect(first.runs.map((run) => run.record.run)).toEqual([ids[2]!]);
  const rest = await runFiles(
    listRuns([context], { active: false, limit: 5, after: first.next }),
  );
  expect(rest.runs.map((run) => run.record.run)).toEqual([ids[1]!, ids[0]!]);
  expect(rest.next).toBeNull();
  expect(
    await runFiles(
      Effect.flip(
        listRuns([context], { active: false, limit: 1, after: randomUUID() }),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});
test("foreign and aliased registered records are rejected instead of inspected", async () => {
  const context = await workspace();
  const foreign = await workspace();
  const input = {
    ...(await runFiles(newRun(context, "identity"))),
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  await runFiles(withProcess(input, (owned) => owned.waitForExit));
  const otherDirectory = join(foreign.outputRoot, "runs", input.runId);
  await mkdir(otherDirectory, { recursive: true });
  const metadata = await readFile(join(input.directory, "run.json"), "utf8");
  await writeFile(join(otherDirectory, "run.json"), metadata);
  expect(
    await runFiles(Effect.flip(readRun(foreign, input.runId))),
  ).toBeInstanceOf(BoundaryError);
  await rm(join(otherDirectory, "run.json"));
  await symlink(
    join(input.directory, "run.json"),
    join(otherDirectory, "run.json"),
  );
  expect(
    await runFiles(Effect.flip(readRun(foreign, input.runId))),
  ).toBeInstanceOf(BoundaryError);
  const listing = await runFiles(
    listRuns([foreign], { active: false, limit: 5 }),
  );
  expect(listing.status).toBe("partial");
  expect(listing.issues.map((issue) => issue.run)).toEqual([input.runId]);
  expect(listing.runs).toEqual([]);
  const secondForeign = join(foreign.outputRoot, "runs", randomUUID());
  await mkdir(secondForeign);
  await writeFile(join(secondForeign, "run.json"), metadata);
  const bounded = await runFiles(
    listRuns([foreign], { active: false, limit: 1 }),
  );
  expect(bounded.issueCount).toBe(2);
  expect(bounded.issues).toHaveLength(1);
  expect(bounded.status).toBe("partial");
});
