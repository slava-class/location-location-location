import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Exit, Fiber } from "effect";
import {
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
import { invokeProjectTool, projectTooling } from "./project-tooling.ts";
import type { ProjectTooling } from "./project-tooling.ts";
import { readCommandOutput, runCommand } from "./commands.ts";
import { createLog, readLogPage } from "./logs.ts";
import { newRun, ParentRun } from "./runs.ts";

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
    `import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))}; export default {audit: () => Effect.succeed(1)};`,
    "export default {audit() { throw new Error('broken hook'); }};",
    `import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))}; export default {audit: () => Effect.die(new Error('broken hook'))};`,
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

test("interrupting an extension finalizes its owned Effect scope exactly once", async () => {
  const project = await fixture();
  let releases = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const tooling = {
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
      } satisfies ProjectTooling;
      const worker = yield* Effect.forkChild(
        invokeProjectTool(tooling.setup, project, "fixture setup"),
      );
      yield* Deferred.await(entered);
      expect(releases).toBe(0);
      yield* Fiber.interrupt(worker);
      yield* Deferred.await(released);
    }),
  );
  expect(releases).toBe(1);
});

test("a failing product audit retains parent-linked child diagnostics", async () => {
  const project = await fixture();
  const parent = await Effect.runPromise(
    newRun(project, "verify").pipe(Effect.provide(BunServices.layer)),
  );
  const logDirectory = join(parent.directory, "logs");
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* createLog(logDirectory, parent.runId);
      const tooling = {
        audit: ({ project: selected }) =>
          runCommand(selected, "audit-child", [
            process.execPath,
            "-e",
            'console.error("diagnostic from product audit"); process.exit(9);',
          ]).pipe(Effect.asVoid),
      } satisfies ProjectTooling;
      const outcome = yield* invokeProjectTool(
        tooling.audit,
        { project, members: [], english: new Map() },
        "fixture audit",
      ).pipe(
        Effect.provideService(ParentRun, {
          runId: parent.runId,
          phase: "audit",
          onChild: (event) =>
            log
              .append("lifecycle", JSON.stringify(event), {
                event: event.event,
              })
              .pipe(Effect.asVoid),
        }),
        Effect.exit,
      );
      yield* log.seal;
      return outcome;
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(Exit.isFailure(outcome)).toBe(true);
  const page = await Effect.runPromise(
    readLogPage(logDirectory, { runId: parent.runId, sequence: 0 }).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
  expect(page.complete).toBe(true);
  const event = page.records
    .map((record) => JSON.parse(record.text))
    .find((record) => record.event === "child-started");
  expect(event?.child.parent).toEqual({ runId: parent.runId, phase: "audit" });
  const child = event.child;
  const saved = JSON.parse(
    await readFile(join(child.directory, "run.json"), "utf8"),
  );
  expect(saved.parent).toEqual({ runId: parent.runId, phase: "audit" });
  const processReceipt = JSON.parse(
    await readFile(join(child.directory, "process.json"), "utf8"),
  );
  expect(processReceipt).toMatchObject({ status: "failed", exit: { code: 9 } });
  const output = await Effect.runPromise(
    readCommandOutput(child.directory, child.run).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
  expect(output.stderr).toBe("diagnostic from product audit\n");
});
