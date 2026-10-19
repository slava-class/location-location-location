import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Fiber } from "effect";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoundaryError, resolveProject } from "./projects.ts";
import {
  defineProjectTooling,
  invokeProjectTool,
  projectTooling,
} from "./project-tooling.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(module?: string) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-extension-")),
  );
  roots.push(root);
  const mod = join(root, "mods", "fixture");
  await mkdir(join(mod, "dev"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await writeFile(
    join(mod, "info.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      title: "Fixture",
      author: "test",
      factorio_version: "2.1",
      description: "Extension boundary fixture",
      dependencies: ["base >= 2.1.20"],
    }),
  );
  if (module !== undefined)
    await writeFile(join(mod, "dev", "tooling.ts"), module);
  return Effect.runPromise(
    resolveProject(root, "fixture", root).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
}

test("malformed extension hooks cannot turn a skipped or invalid audit into success", async () => {
  for (const module of [
    "export default {audit: 42};",
    "export default {audit() { return undefined; }};",
    "export default {async audit() { return 1; }};",
  ]) {
    const project = await fixture(module);
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          const tooling = yield* projectTooling(project);
          if (!tooling.audit) throw new Error("Fixture audit disappeared");
          yield* invokeProjectTool(
            tooling.audit,
            { project, members: [], english: new Map() },
            "fixture audit",
          );
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
    expect(failure).toBeInstanceOf(BoundaryError);
  }
});

test("interrupting an extension crosses the Promise bridge and finalizes its owned Effect scope exactly once", async () => {
  const project = await fixture();
  let releases = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const tooling = defineProjectTooling({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                releases++;
              }).pipe(Effect.andThen(Deferred.succeed(released, undefined))),
            );
            yield* Deferred.succeed(entered, undefined);
            return yield* Effect.never;
          }).pipe(Effect.scoped),
      });
      const worker = yield* Effect.forkChild(
        invokeProjectTool(tooling.setup!, project, "fixture setup"),
      );
      yield* Deferred.await(entered);
      expect(releases).toBe(0);
      yield* Fiber.interrupt(worker);
      yield* Deferred.await(released);
    }),
  );
  expect(releases).toBe(1);
});
