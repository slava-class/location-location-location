import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem } from "effect";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertCanonicalPath,
  BoundaryError,
  discoverProjects,
  prepareOutputDirectory,
  resolveProject,
  resolveWorkspace,
} from "./projects.ts";
import { createLog, readLogCursor, readLogPage, readLogState } from "./logs.ts";
import { withOwnedLock } from "./locks.ts";
import { newRun } from "./runs.ts";
const directories: string[] = [];
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "factorio-boundaries-")),
  );
  directories.push(directory);
  return directory;
}
async function project(root: string, directory: string, name = directory) {
  const path = join(root, "mods", directory);
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "info.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      title: name,
      author: "test",
      factorio_version: "2.1",
      dependencies: ["base >= 2.1.20"],
      description: "Boundary fixture",
    }),
  );
  await writeFile(join(path, "control.lua"), "");
  return path;
}
test("exact ID and nested-cwd path resolve the same selected mod, never the sibling", async () => {
  const root = await temporary();
  const alpha = await project(root, "alpha");
  await project(root, "beta");
  const first = await run(
    resolveProject(root, "alpha", join(root, "mods", "beta")),
  );
  const second = await run(
    resolveProject(root, "../alpha", join(root, "mods", "beta")),
  );
  expect(first.modRoot).toBe(await realpath(alpha));
  expect(second.info.name).toBe("alpha");
  expect(run(resolveProject(root, "", root))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  expect(run(resolveProject(root, "missing", root))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  expect(run(resolveProject(root, root, root))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});
test("explicit companions extend only this selection and reject invalid combinations before output", async () => {
  const root = await temporary();
  const alpha = await project(root, "alpha");
  await project(root, "beta");
  await project(root, "gamma");
  await writeFile(
    join(alpha, "dev.config.ts"),
    'export default {companions:["gamma"]};',
  );
  const selected = await run(
    resolveProject(root, "alpha", root, { companions: ["beta"] }),
  );
  expect(selected.info.name).toBe("alpha");
  expect(selected.development.companions).toEqual(["gamma", "beta"]);
  expect(
    (await run(resolveProject(root, "alpha", root))).development.companions,
  ).toEqual(["gamma"]);
  for (const companions of [
    ["alpha"],
    ["beta", "beta"],
    ["gamma"],
    ["missing"],
    ["../beta"],
  ])
    expect(
      await run(
        Effect.flip(resolveProject(root, "alpha", root, { companions })),
      ),
    ).toBeInstanceOf(BoundaryError);
  expect(await readdir(root)).not.toContain(".factorio-test");
});
test("present malformed exception configuration and duplicate IDs fail discovery", async () => {
  const root = await temporary();
  const alpha = await project(root, "alpha");
  await writeFile(
    join(alpha, "dev.config.ts"),
    "export default {visaul:true};",
  );
  expect(run(discoverProjects(root))).rejects.toBeInstanceOf(BoundaryError);
  await rm(join(alpha, "dev.config.ts"));
  await project(root, "beta", "alpha");
  expect(run(discoverProjects(root))).rejects.toBeInstanceOf(BoundaryError);
});
test("a selected product does not import an unrelated broken development configuration", async () => {
  const root = await temporary();
  await project(root, "alpha");
  const beta = await project(root, "beta");
  await writeFile(
    join(beta, "dev.config.ts"),
    'throw new Error("Unrelated project is incomplete");',
  );
  expect((await run(resolveProject(root, "alpha", root))).info.name).toBe(
    "alpha",
  );
  expect(run(discoverProjects(root))).rejects.toBeInstanceOf(BoundaryError);
  expect(
    await run(
      Effect.flip(
        resolveProject(root, "alpha", root, { companions: ["beta"] }),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});
test("contradictory verification and companion declarations fail at project resolution", async () => {
  for (const config of [
    { verification: "offline", profiles: ["base"] },
    { companions: ["beta", "beta"] },
    { companions: ["alpha"] },
  ]) {
    const root = await temporary(),
      alpha = await project(root, "alpha");
    await writeFile(
      join(alpha, "dev.config.ts"),
      "export default " + JSON.stringify(config) + ";",
    );
    expect(run(resolveProject(root, "alpha", root))).rejects.toBeInstanceOf(
      BoundaryError,
    );
  }
});
test("a symlink cannot import a mod outside the selected workspace", async () => {
  const root = await temporary(),
    outside = await temporary();
  await mkdir(join(root, "mods"));
  const path = await project(outside, "external");
  await symlink(path, join(root, "mods", "external"));
  expect(run(discoverProjects(root))).rejects.toBeInstanceOf(BoundaryError);
});
test("project and workspace output roots reject aliases before allocating generated state", async () => {
  for (const output of [
    ".factorio-test",
    ".factorio-test/projects",
    ".factorio-test/projects/alpha",
    ".factorio-test/workspace",
  ]) {
    const root = await realpath(await temporary());
    const outside = await realpath(await temporary());
    await project(root, "alpha");
    await writeFile(
      join(root, "package.json"),
      '{"private":true,"type":"module"}',
    );
    const alias = join(root, output);
    await mkdir(dirname(alias), { recursive: true });
    await symlink(outside, alias);
    const operation = output.endsWith("/workspace")
      ? resolveWorkspace(root)
      : resolveProject(root, "alpha", root);
    expect(await run(Effect.flip(operation))).toBeInstanceOf(BoundaryError);
    expect(await readdir(outside)).toEqual([]);
  }
});
test("owned locks reject a redirected parent without touching or removing its contents", async () => {
  const root = await realpath(await temporary());
  const outside = await realpath(await temporary());
  await writeFile(join(outside, "keep.txt"), "unrelated");
  await symlink(outside, join(root, "redirect"));
  let entered = false;
  expect(
    await run(
      Effect.flip(
        withOwnedLock(
          join(root, "redirect", "nested", "release.lock"),
          "test",
          Effect.sync(() => {
            entered = true;
          }),
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(entered).toBe(false);
  expect(await readdir(outside)).toEqual(["keep.txt"]);
});
test("run allocation and log writers reject aliases introduced after project resolution", async () => {
  const root = await temporary();
  const outside = await temporary();
  await project(root, "alpha");
  const selected = await run(resolveProject(root, "alpha", root));
  await mkdir(selected.outputRoot, { recursive: true });
  const alias = join(selected.outputRoot, "runs");
  await symlink(outside, alias);
  expect(await run(Effect.flip(newRun(selected, "probe")))).toBeInstanceOf(
    BoundaryError,
  );
  expect(
    await run(Effect.flip(createLog(join(alias, "logs"), randomUUID()))),
  ).toBeInstanceOf(BoundaryError);
  expect(await readdir(outside)).toEqual([]);
});
test("missing output directories can be prepared, but dangling aliases cannot", async () => {
  const root = await temporary();
  const missing = join(root, "ordinary", "nested");
  await run(prepareOutputDirectory(missing));
  expect(await realpath(missing)).toBe(missing);
  const outside = await temporary();
  const alias = join(root, "dangling");
  await symlink(join(outside, "missing"), alias);
  expect(
    await run(Effect.flip(prepareOutputDirectory(join(alias, "nested")))),
  ).toBeInstanceOf(BoundaryError);
  expect(await readdir(outside)).toEqual([]);
});
test("a file created between path probes stays usable without accepting a new alias", async () => {
  for (const kind of ["file", "dangling-link", "parent-link"] as const) {
    const root = await temporary();
    const outside = await temporary();
    const parent = join(root, "appearing");
    const path = join(parent, "factorio-current.log");
    const operation = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let created = false;
      const racing = {
        ...fs,
        realPath: (candidate: string) =>
          fs.realPath(candidate).pipe(
            Effect.tapError((error) =>
              Effect.gen(function* () {
                if (
                  created ||
                  candidate !== path ||
                  error.reason._tag !== "NotFound"
                )
                  return;
                created = true;
                if (kind === "parent-link") yield* fs.symlink(outside, parent);
                else yield* fs.makeDirectory(parent);
                if (kind === "dangling-link")
                  yield* fs.symlink(join(outside, "missing"), path);
                else yield* fs.writeFileString(path, "created during probe\n");
              }),
            ),
          ),
      };
      yield* assertCanonicalPath(path).pipe(
        Effect.provideService(FileSystem.FileSystem, racing),
      );
      yield* fs.writeFileString(path, "qualified producer write\n", {
        flag: "a",
      });
      return yield* fs.readFileString(path);
    });
    if (kind === "file")
      expect(await run(operation)).toBe(
        "created during probe\nqualified producer write\n",
      );
    else {
      expect(await run(Effect.flip(operation))).toBeInstanceOf(BoundaryError);
      expect(await readdir(outside)).toEqual(
        kind === "parent-link" ? ["factorio-current.log"] : [],
      );
      if (kind === "parent-link")
        expect(
          await readFile(join(outside, "factorio-current.log"), "utf8"),
        ).toBe("created during probe\n");
    }
  }
});
test("two readers independently resume live logs across rotation and final drain", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(
    createLog(directory, runId, {
      recordsPerSegment: 2,
      maxTextBytes: 1024,
      maxBytes: 65536,
    }),
  );
  for (let i = 1; i <= 3; i++) await run(writer.append("stdout", String(i)));
  const a = await run(readLogPage(directory, { runId, sequence: 0 }, 2));
  expect(a.records.map((r) => r.text)).toEqual(["1", "2"]);
  expect(a.complete).toBe(false);
  const b = await run(readLogPage(directory, { runId, sequence: 0 }, 3));
  expect(b.records.map((r) => r.text)).toEqual(["1", "2", "3"]);
  await run(writer.append("stderr", "4"));
  await run(writer.append("stdout", "5"));
  await run(writer.seal);
  const continued = await run(readLogPage(directory, a.cursor, 3));
  expect(continued.records.map((r) => r.text)).toEqual(["3", "4", "5"]);
  expect(continued.complete).toBe(true);
  const independent = await run(readLogPage(directory, b.cursor));
  expect(independent.records.map((r) => r.text)).toEqual(["4", "5"]);
  expect(
    run(readLogPage(directory, { runId: randomUUID(), sequence: 0 })),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(run(writer.append("stdout", "late"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});
test("a reader never decodes a partially appended record", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(createLog(directory, runId));
  await run(writer.append("stdout", "one"));
  const record = JSON.stringify({
    schema: 2,
    runId,
    sequence: 2,
    elapsedMs: 1,
    capturedAtUnixMs: Date.now(),
    metadata: {},
    channel: "stderr",
    text: "two",
  });
  await appendFile(
    join(directory, "events-00000000.jsonl"),
    record.slice(0, -3),
  );
  const partial = await run(readLogPage(directory, { runId, sequence: 1 }));
  expect(partial.records).toEqual([]);
  expect(partial.cursor.sequence).toBe(1);
  expect(partial.partialRecord).toBe(true);
  await appendFile(
    join(directory, "events-00000000.jsonl"),
    record.slice(-3) + "\n",
  );
  const complete = await run(readLogPage(directory, partial.cursor));
  expect(complete.records.map((r) => r.text)).toEqual(["two"]);
  expect(complete.partialRecord).toBe(false);
});
test("a deleted segment is an explicit evidence gap, not successful EOF", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(
    createLog(directory, runId, {
      recordsPerSegment: 1,
      maxTextBytes: 1024,
      maxBytes: 65536,
    }),
  );
  await run(writer.append("stdout", "one"));
  await run(writer.append("stdout", "two"));
  await run(writer.seal);
  await rm(join(directory, "events-00000000.jsonl"));
  expect(
    run(readLogPage(directory, { runId, sequence: 0 })),
  ).rejects.toBeInstanceOf(BoundaryError);
});
test("recording failures and capacity exhaustion are visible to the producer", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(
    createLog(directory, runId, {
      recordsPerSegment: 1,
      maxTextBytes: 1024,
      maxBytes: 65536,
    }),
  );
  await mkdir(join(directory, "events-00000000.jsonl"));
  expect(run(writer.append("stdout", "cannot write"))).rejects.toThrow();
  const small = await run(
    createLog(join(directory, "small"), randomUUID(), {
      recordsPerSegment: 1,
      maxTextBytes: 1024,
      maxBytes: 1,
    }),
  );
  expect(run(small.append("stdout", "capacity"))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});
test("a live watermark exposes deletion of consecutive segments, including the current segment", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(
    createLog(directory, runId, {
      recordsPerSegment: 1,
      maxTextBytes: 1024,
      maxBytes: 65536,
    }),
  );
  for (const text of ["one", "two", "three"])
    await run(writer.append("stdout", text));
  await rm(join(directory, "events-00000000.jsonl"));
  await rm(join(directory, "events-00000001.jsonl"));
  await rm(join(directory, "events-00000002.jsonl"));
  expect(
    run(readLogPage(directory, { runId, sequence: 0 })),
  ).rejects.toBeInstanceOf(BoundaryError);
});
test("a short final segment can be paged without confusing unread rows with a gap", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(createLog(directory, runId));
  for (const text of ["one", "two", "three"])
    await run(writer.append("stdout", text));
  await run(writer.seal);
  const first = await run(readLogPage(directory, { runId, sequence: 0 }, 1));
  expect(first.records.map((record) => record.text)).toEqual(["one"]);
  expect(first.complete).toBe(false);
  const rest = await run(readLogPage(directory, first.cursor));
  expect(rest.records.map((record) => record.text)).toEqual(["two", "three"]);
  expect(rest.complete).toBe(true);
});

test("live cursors exclude already-published records beyond the coarse progress watermark", async () => {
  const directory = await temporary(),
    runId = randomUUID();
  const writer = await run(
    createLog(directory, runId, {
      recordsPerSegment: 512,
      maxTextBytes: 1024,
      maxBytes: 1048576,
    }),
  );
  for (let index = 0; index < 301; index++)
    await run(writer.append("stdout", `old-${index}`));
  expect((await run(readLogState(directory))).watermark.lastSequence).toBe(1);
  const cursor = await run(readLogCursor(directory, runId));
  expect(cursor).toEqual({ runId, sequence: 301 });
  await run(writer.append("stdout", "new-command-result"));
  expect(
    (await run(readLogPage(directory, cursor))).records.map(
      (event) => event.text,
    ),
  ).toEqual(["new-command-result"]);
  expect(run(readLogCursor(directory, randomUUID()))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  await run(writer.seal);
  expect((await run(readLogCursor(directory, runId))).sequence).toBe(302);
});
