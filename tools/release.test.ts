import { afterEach, expect, test } from "bun:test";
import { BunHttpClient, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { access, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareVersions } from "./dependencies.ts";
import { releaseFixture, runFiles } from "./fixtures/release.ts";
import { BoundaryError, decode, Version } from "./projects.ts";
import { loadPrepared, prepareRelease } from "./release.ts";
import { withReleaseLock } from "./locks.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("versions compare numerically and reject aliases and unsupported components", () => {
  expect(compareVersions("1.10.0", "1.9.65535")).toBe(1);
  expect(compareVersions("2.0.0", "1.65535.65535")).toBe(1);
  for (const value of [
    "01.0.0",
    "1.0",
    "1.0.65536",
    "../1.0.1",
    "1.0.1-beta",
    "1.0.1\n",
  ])
    expect(
      Effect.runPromise(decode(Version, value, "version")),
    ).rejects.toBeInstanceOf(BoundaryError);
});

test("prepared products reject explicit version and selected-source drift, not unrelated edits", async () => {
  const f = await releaseFixture(roots);
  expect(runFiles(loadPrepared(f.project, "1.0.0"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  await writeFile(join(f.root, "mods/unrelated/notes.txt"), "unrelated change");
  expect(
    (await runFiles(loadPrepared(f.project, "1.0.1"))).archive.bytes,
  ).toEqual(f.archiveBytes);
  await writeFile(join(f.project.modRoot, "new.lua"), "return true\n");
  expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});

test("low-quality native or gallery evidence cannot become publishable captures", async () => {
  const f = await releaseFixture(roots, true);
  for (const profile of ["native", "gallery"] as const) {
    const entry = f.manifest.evidence[profile];
    if (!entry)
      throw new Error(
        "The release fixture requires native and gallery evidence",
      );
    await f.save({
      ...f.manifest,
      evidence: {
        ...f.manifest.evidence,
        [profile]: { ...entry, graphics: "low" },
      },
    });
    const error = await runFiles(Effect.flip(loadPrepared(f.project, "1.0.1")));
    expect(error).toBeInstanceOf(BoundaryError);
  }
  await f.save();
  expect(
    (await runFiles(loadPrepared(f.project, "1.0.1"))).archive.bytes,
  ).toEqual(f.archiveBytes);
});

test("same-version products reject exchanged bundles and bytes without blocking each other's release", async () => {
  const primary = await releaseFixture(roots, true);
  const secondary = await releaseFixture(roots, true, {
    root: primary.root,
    name: "secondary",
  });
  const version = "1.0.1";
  await primary.save(secondary.manifest);
  await secondary.save(primary.manifest);
  expect(
    await runFiles(Effect.flip(loadPrepared(primary.project, version))),
  ).toBeInstanceOf(BoundaryError);
  expect(
    await runFiles(Effect.flip(loadPrepared(secondary.project, version))),
  ).toBeInstanceOf(BoundaryError);
  await primary.save();
  await secondary.save();
  const archive = join(primary.directory, primary.manifest.archive.file);
  await writeFile(archive, secondary.archiveBytes);
  expect(
    await runFiles(Effect.flip(loadPrepared(primary.project, version))),
  ).toBeInstanceOf(BoundaryError);
  await rm(archive);
  expect(
    await runFiles(Effect.flip(loadPrepared(primary.project, version))),
  ).toBeInstanceOf(Error);
  await writeFile(archive, primary.archiveBytes);
  await runFiles(
    withReleaseLock(
      primary.project,
      Effect.gen(function* () {
        const conflict = yield* Effect.flip(
          withReleaseLock(primary.project, Effect.void),
        );
        expect(conflict).toBeInstanceOf(BoundaryError);
        const other = yield* withReleaseLock(
          secondary.project,
          loadPrepared(secondary.project, version),
        );
        expect(other.archive.bytes).toEqual(secondary.archiveBytes);
        expect(
          (yield* loadPrepared(primary.project, version)).archive.bytes,
        ).toEqual(primary.archiveBytes);
      }),
    ),
  );
  expect(
    (
      await runFiles(
        withReleaseLock(
          primary.project,
          loadPrepared(primary.project, version),
        ),
      )
    ).archive.bytes,
  ).toEqual(primary.archiveBytes);
});

test("a same-source Git commit preserves release eligibility and existing staging", async () => {
  const f = await releaseFixture(roots);
  async function git(...args: string[]) {
    const child = Bun.spawn(
      [
        "git",
        "-c",
        "user.name=Release Fixture",
        "-c",
        "user.email=release@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        `core.hooksPath=${f.root}/no-hooks`,
        ...args,
      ],
      {
        cwd: f.root,
        env: {
          PATH: process.env.PATH!,
          HOME: f.root,
          GIT_CONFIG_NOSYSTEM: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(stderr);
    return stdout.trim();
  }
  await git("init", "-q", "--initial-branch=main");
  await git("add", "-A");
  const before = await git("write-tree");
  await runFiles(loadPrepared(f.project, "1.0.1"));
  expect(await git("write-tree")).toBe(before);
  await git("commit", "-qm", "same prepared source");
  expect(
    (await runFiles(loadPrepared(f.project, "1.0.1"))).manifest.source.sha256,
  ).toBe(f.manifest.source.sha256);
  expect(await git("rev-parse", "HEAD^{tree}")).toBe(before);
});

test("changed frozen ZIPs and captures cannot reuse passing evidence", async () => {
  const f = await releaseFixture(roots, true);
  await writeFile(join(f.directory, f.manifest.archive.file), "tampered");
  expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  await writeFile(join(f.directory, f.manifest.archive.file), f.archiveBytes);
  await writeFile(
    join(f.directory, f.manifest.captures[0]!.file),
    "tampered native capture",
  );
  expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});

test("gallery order, missing scenes, extra scenes and cross-profile proofs are rejected", async () => {
  const f = await releaseFixture(roots, true);
  const m = f.manifest;
  for (const changed of [
    { ...m, images: [...m.images].reverse() },
    { ...m, captures: m.captures.slice(1) },
    {
      ...m,
      captures: [
        ...m.captures,
        { ...m.captures[0]!, file: "captures/extra.png" },
      ],
    },
    { ...m, evidence: { ...m.evidence, native: m.evidence.gallery } },
    { ...m, evidence: { ...m.evidence, smoke: [] } },
  ]) {
    await f.save(changed);
    expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
      BoundaryError,
    );
  }
});

test("incomplete aggregate phases, failed cases and foreign artifacts never certify a release", async () => {
  const f = await releaseFixture(roots, true);
  const m = f.manifest;
  const proof = m.evidence.verification;
  for (const verification of [
    { ...proof, completed: proof.completed.slice(1) },
    { ...proof, artifact: { ...proof.artifact, sha1: "0".repeat(40) } },
    {
      ...proof,
      engine: proof.engine.map((entry) => ({
        ...entry,
        summary: { ...entry.summary, failed: 1 },
      })),
    },
    {
      ...proof,
      engine: proof.engine.map((entry) => ({
        ...entry,
        observed: {
          ...entry.observed,
          mod: { name: "foreign", version: "1.0.1" },
        },
      })),
    },
  ]) {
    await f.save({ ...m, evidence: { ...m.evidence, verification } });
    expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
      BoundaryError,
    );
  }
});

test("a package smoke with the test framework loaded is not independent product proof", async () => {
  const f = await releaseFixture(roots, true);
  await f.save({
    ...f.manifest,
    evidence: {
      ...f.manifest.evidence,
      smoke: f.manifest.evidence.smoke.map((entry) => ({
        ...entry,
        observed: {
          ...entry.observed,
          activeMods: {
            ...entry.observed.activeMods,
            "factorio-test": "3.6.0",
          },
        },
      })),
    },
  });
  expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});

test("frozen-file aliases cannot escape the prepared bundle", async () => {
  const f = await releaseFixture(roots);
  const outside = join(f.root, "outside.zip");
  await writeFile(outside, f.archiveBytes);
  const archive = join(f.directory, f.manifest.archive.file);
  await rm(archive);
  await symlink(outside, archive);
  expect(runFiles(loadPrepared(f.project, "1.0.1"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  expect(await readFile(outside)).toEqual(Buffer.from(f.archiveBytes));
});

test("a failed re-preparation invalidates the previous candidate before prerequisite checks", async () => {
  const f = await releaseFixture(roots);
  expect(
    Effect.runPromise(
      prepareRelease(f.project).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(BunHttpClient.layer),
      ),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(access(join(f.directory, "manifest.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(join(f.directory, f.manifest.archive.file))).toEqual(
    Buffer.from(f.archiveBytes),
  );
});
