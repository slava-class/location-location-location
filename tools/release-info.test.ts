import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Exit, Fiber, FileSystem, Schema } from "effect";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoundaryError, resolveProject } from "./projects.ts";
import { LockOwner, withOwnedLock, withReleaseLock } from "./locks.ts";
import { readListing, setVersion } from "./release-info.ts";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "modkit-release-info-"),
  );
  directories.push(root);
  for (const id of ["alpha", "beta"]) {
    const directory = join(root, "mods", id);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "info.json"),
      JSON.stringify({
        name: id,
        version: "1.0.0",
        title: id,
        author: "Fixture",
        factorio_version: "2.1",
        dependencies: ["base >= 2.1.20"],
        description: "Fixture summary",
        homepage: "https://example.invalid/" + id,
        quality_required: false,
        custom_future_metadata: { retained: true },
      }),
    );
    await writeFile(
      join(directory, "changelog.txt"),
      "---------------------------------------------------------------------------------------------------\nVersion: 1.0.0\n  Changes:\n    - Original history.\n",
    );
    await writeFile(
      join(directory, "MOD_PORTAL.md"),
      "- **Category:** Utilities\n- **License:** MIT\n- **Source:** [source](https://example.invalid/" +
        id +
        ")\n\n## Description\n\nAuthored description.\n",
    );
  }
  return root;
}
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
test("versioning preserves unknown metadata, authored history and sibling identity", async () => {
  const root = await fixture(),
    project = await run(resolveProject(root, "alpha", root));
  const beta = await readFile(join(root, "mods", "beta", "info.json"));
  const listing = await run(readListing(project));
  expect(listing.source_url).toBe("https://example.invalid/alpha");
  const changed = await run(
    setVersion(project, "1.1.0", "  Improve the detector.  "),
  );
  expect(changed.previous).toBe("1.0.0");
  expect(changed.version).toBe("1.1.0");
  const info = JSON.parse(
    await readFile(join(project.modRoot, "info.json"), "utf8"),
  );
  expect(info.custom_future_metadata).toEqual({ retained: true });
  expect(info.quality_required).toBe(false);
  expect(
    await readFile(join(project.modRoot, "changelog.txt"), "utf8"),
  ).toContain("Version: 1.1.0\n  Changes:\n    - Improve the detector.\n");
  expect(
    await readFile(join(project.modRoot, "changelog.txt"), "utf8"),
  ).toContain("Version: 1.0.0\n");
  expect(await readFile(join(root, "mods", "beta", "info.json"))).toEqual(beta);
  expect(
    access(join(project.outputRoot, "release.lock")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    run(setVersion(project, "1.2.0", "stale caller")),
  ).rejects.toBeInstanceOf(BoundaryError);
});
test("invalid versions and notes do not create state or change either release file", async () => {
  const root = await fixture(),
    project = await run(resolveProject(root, "alpha", root)),
    before = await readFile(join(project.modRoot, "info.json")),
    history = await readFile(join(project.modRoot, "changelog.txt"));
  for (const [version, note] of [
    ["1.0.0", "note"],
    ["01.1.0", "note"],
    ["65536.0.0", "note"],
    ["1.1.0", " "],
    ["1.1.0", "one\ntwo"],
  ])
    expect(run(setVersion(project, version!, note!))).rejects.toBeInstanceOf(
      BoundaryError,
    );
  expect(await readFile(join(project.modRoot, "info.json"))).toEqual(before);
  expect(await readFile(join(project.modRoot, "changelog.txt"))).toEqual(
    history,
  );
  expect(access(project.outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
test("one release lock covers all versions of a mod, not siblings, and cancellation releases ownership", async () => {
  const root = await fixture();
  await run(
    Effect.gen(function* () {
      const alpha = yield* resolveProject(root, "alpha", root),
        beta = yield* resolveProject(root, "beta", root),
        entered = yield* Deferred.make<void>();
      const owner = yield* withReleaseLock(
        alpha,
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          return yield* Effect.never;
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      let mutated = false;
      const blocked = yield* Effect.exit(
        withReleaseLock(
          { ...alpha, info: { ...alpha.info, version: "2.0.0" } },
          Effect.sync(() => {
            mutated = true;
          }),
        ),
      );
      expect(Exit.isFailure(blocked)).toBe(true);
      expect(mutated).toBe(false);
      expect(yield* withReleaseLock(beta, Effect.succeed("independent"))).toBe(
        "independent",
      );
      yield* Fiber.interrupt(owner);
      expect(yield* withReleaseLock(alpha, Effect.succeed("released"))).toBe(
        "released",
      );
    }),
  );
});
test("cleanup refuses a replaced lock and retains the replacement owner record", async () => {
  const root = await fixture(),
    path = join(root, "owned.lock");
  let replacement = "";
  const exit = await run(
    Effect.exit(
      withOwnedLock(
        path,
        "ownership-proof",
        Effect.promise(async () => {
          const owner = Schema.decodeUnknownSync(LockOwner)(
            JSON.parse(await readFile(path, "utf8")),
          );
          replacement = crypto.randomUUID();
          await writeFile(
            path,
            JSON.stringify({ ...owner, token: replacement }),
          );
        }),
      ),
    ),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(JSON.parse(await readFile(path, "utf8")).token).toBe(replacement);
});
