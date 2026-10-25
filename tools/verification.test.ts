import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { releaseFixture, runFiles } from "./fixtures/release.ts";
import { RunAnnouncements } from "./runs.ts";
import { Phase, verifyProjects } from "./verification.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const first = await releaseFixture(roots, false, { name: "first" });
  const second = await releaseFixture(roots, false, {
    root: first.root,
    name: "second",
  });
  const third = await releaseFixture(roots, false, {
    root: first.root,
    name: "third",
  });
  await writeFile(
    join(first.root, "package.json"),
    JSON.stringify({ private: true, type: "module", devDependencies: {} }),
  );
  // Fail before invoking an external tool, without relying on ambient installed versions.
  await writeFile(
    join(first.root, ".config/mise.toml"),
    '[tools]\nbun = "0.0.0"\n',
  );
  return [first.project, second.project, third.project];
}

test("a shared prerequisite failure blocks dependents without allocating their runs or inventing phase results", async () => {
  const projects = await fixture();
  const report = await runFiles(
    verifyProjects(projects, "native", true).pipe(
      Effect.provideService(RunAnnouncements, { write: () => Effect.void }),
    ),
  );
  expect(report.status).toBe("failed");
  expect(report.projects.map((project) => project.status)).toEqual([
    "failed",
    "blocked",
    "blocked",
  ]);
  const first = report.projects[0]!;
  if (first.status !== "failed") throw new Error("Expected executed failure");
  expect(
    first.timings.map((timing) => [
      timing.phase,
      timing.status,
      timing.execution,
    ]),
  ).toEqual([["toolchain", "failed", "workspace"]]);
  expect(first.notRun).toEqual(
    Phase.literals.filter((phase) => phase !== "toolchain"),
  );
  for (let index = 1; index < projects.length; index++) {
    const blocked = report.projects[index]!;
    if (blocked.status !== "blocked")
      throw new Error("Expected dependency blocker");
    expect(blocked.blockedBy).toEqual({
      mod: first.mod,
      phase: "toolchain",
      runId: first.runId,
    });
    expect(blocked.timings).toEqual([]);
    expect(blocked.notRun).toEqual(Phase.literals);
    expect(blocked.elapsedMs).toBeNull();
    expect(
      readdir(join(projects[index]!.outputRoot, "runs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
});

test("a product source failure does not prevent another product from checking shared prerequisites", async () => {
  const projects = await fixture();
  await rm(projects[0]!.modRoot, { recursive: true });
  const report = await runFiles(
    verifyProjects(projects, "native", true).pipe(
      Effect.provideService(RunAnnouncements, { write: () => Effect.void }),
    ),
  );
  expect(report.projects.map((project) => project.status)).toEqual([
    "prerequisite-failed",
    "failed",
    "blocked",
  ]);
  expect(report.projects[0]!.notRun).toEqual(Phase.literals);
  expect(report.projects[1]!.timings.map((timing) => timing.phase)).toEqual([
    "toolchain",
  ]);
  const blocked = report.projects[2]!;
  if (blocked.status !== "blocked")
    throw new Error("Expected shared failure blocker");
  expect(blocked.blockedBy.mod).toEqual({ name: "second", version: "1.0.1" });
});

test("an affected scope cannot certify a narrower execution selection", async () => {
  const projects = await fixture();
  expect(
    runFiles(
      verifyProjects([projects[0]!], "native", false, {
        schema: 1,
        base: "a".repeat(40),
        changed: ["tools/shared.ts"],
        workspaceChanges: ["tools/shared.ts"],
        projects: projects.map((project) => ({
          name: project.info.name,
          version: project.info.version,
        })),
      }),
    ),
  ).rejects.toThrow("Execution projects do not match");
});
