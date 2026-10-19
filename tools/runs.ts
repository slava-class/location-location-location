import { Console, Context, Effect, FileSystem, Option, Schema } from "effect";
import type { PlatformError } from "effect";
import { join } from "node:path";
import type { ExecutionContext } from "./projects.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  ModId,
  prepareOutputDirectory,
} from "./projects.ts";
import { AbsolutePath, ElapsedMs } from "./contracts.ts";
import { RunId } from "./logs.ts";
import { Backend } from "./backend.ts";
export function inheritedEnvironment() {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "USER",
    "LOGNAME",
    "SHELL",
    "XDG_CACHE_HOME",
    "UV_CACHE_DIR",
    "UV_PYTHON_CACHE_DIR",
    "UV_PYTHON_INSTALL_DIR",
    "SYSTEMROOT",
    "DISPLAY",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
export function newRun(project: ExecutionContext, profile: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runId = crypto.randomUUID();
    const parent = join(project.outputRoot, "runs");
    yield* prepareOutputDirectory(parent);
    const directory = join(parent, runId);
    yield* fs.makeDirectory(directory);
    yield* assertCanonicalPath(directory);
    return {
      runId,
      modId: "info" in project ? project.info.name : null,
      profile,
      repository: project.repoRoot,
      directory,
      cwd: project.repoRoot,
      env: inheritedEnvironment(),
      redact: [],
      deadlineMs: 300000,
      shutdownMs: 3000,
    };
  });
}
export const EngineRunKind = Schema.Literals([
  "engine-suite",
  "package-smoke",
  "benchmark",
  "studio",
  "session",
]);
const RunKind = Schema.Union([
  Schema.Literals(["command", "verification", "performance"]),
  EngineRunKind,
]);
export const RunRecord = Schema.Struct({
  schema: Schema.Literal(2),
  mod: Schema.NullOr(ModId),
  run: RunId,
  kind: RunKind,
  profile: Schema.NonEmptyString,
  repository: AbsolutePath,
  cwd: AbsolutePath,
  directory: AbsolutePath,
  backend: Backend,
  ownerPid: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 2147483647 }),
  ),
  startedAtUnixMs: ElapsedMs.check(Schema.isInt()),
  parent: Schema.NullOr(
    Schema.Struct({ runId: RunId, phase: Schema.NonEmptyString }),
  ),
  logs: Schema.Array(Schema.NonEmptyString),
});
const ChildRunEvent = Schema.Struct({
  event: Schema.Literal("child-started"),
  child: RunRecord,
});
export const ParentRun = Context.Service<{
  readonly runId: string;
  readonly phase: string;
  readonly onChild: (
    event: typeof ChildRunEvent.Type,
  ) => Effect.Effect<void, BoundaryError | PlatformError.PlatformError>;
}>("modkit/ParentRun");
export function announceRun(run: {
  modId: string | null;
  runId: string;
  kind: typeof RunKind.Type;
  backend: typeof Backend.Type;
  profile: string;
  repository: string;
  cwd: string;
  directory: string;
  startedAt: string;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const parent = yield* Effect.serviceOption(ParentRun);
    const value = yield* decode(
      RunRecord,
      {
        schema: 2,
        mod: run.modId,
        run: run.runId,
        kind: run.kind,
        profile: run.profile,
        repository: run.repository,
        cwd: run.cwd,
        directory: run.directory,
        backend: run.backend,
        ownerPid: process.pid,
        startedAtUnixMs: Date.parse(run.startedAt),
        parent: Option.isSome(parent)
          ? { runId: parent.value.runId, phase: parent.value.phase }
          : null,
        logs: [
          process.execPath,
          join(run.repository, "tools", "cli.ts"),
          "logs",
          ...(run.modId === null ? ["--workspace"] : []),
          "--run",
          run.runId,
          "--follow",
          ...(run.modId === null ? [] : ["--", run.modId]),
        ],
      },
      "run record",
    );
    const path = join(run.directory, "run.json");
    yield* assertCanonicalPath(path);
    if (value.parent?.runId === value.run || (yield* fs.exists(path)))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: value.run,
          message:
            "Run identity is already registered or refers to itself as parent",
        }),
      );
    yield* fs.writeFileString(path + ".part", JSON.stringify(value) + "\n", {
      flag: "wx",
    });
    yield* fs.rename(path + ".part", path);
    if (Option.isSome(parent))
      yield* parent.value.onChild(
        yield* decode(
          ChildRunEvent,
          {
            event: "child-started",
            child: value,
          },
          "child run event",
        ),
      );
    yield* Console.error(JSON.stringify(value));
  });
}
