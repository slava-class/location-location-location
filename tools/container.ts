import { Effect, FileSystem, Schema } from "effect";
import type { PlatformError } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { join } from "node:path";
import { AbsolutePath, Sha256 } from "./contracts.ts";
import { DockerRuntime, dockerCacheSuffix } from "./backend.ts";
import type { ResolvedDockerRuntime } from "./backend.ts";
import { ContainerState, dockerControl, inspectContainer } from "./docker.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  contains,
  decode,
  ModId,
} from "./projects.ts";
import { RunId } from "./logs.ts";
import type { ProcessReceipt, Request } from "./process.ts";

export const ContainerReceipt = Schema.Struct({
  schema: Schema.Literal(1),
  runId: RunId,
  modId: Schema.NullOr(ModId),
  repository: AbsolutePath,
  directory: AbsolutePath,
  name: Schema.NonEmptyString,
  runtime: DockerRuntime,
  id: Schema.NullOr(Sha256),
  state: Schema.NullOr(ContainerState),
  cleanup: Schema.Literals(["pending", "removed", "failed"]),
  error: Schema.optionalKey(Schema.String),
});

export function verifyContainerExit(
  process: typeof ProcessReceipt.Type,
  container: typeof ContainerReceipt.Type | undefined,
) {
  const state = container?.state;
  if (
    container === undefined ||
    container.cleanup !== "removed" ||
    container.id === null ||
    state === undefined ||
    state === null ||
    state.Status !== "exited" ||
    state.Running ||
    state.OOMKilled ||
    state.Error !== "" ||
    process.exit?.code !== state.ExitCode ||
    (!process.allowedExitCodes.includes(state.ExitCode) &&
      !(process.termination === "requested-stop" && state.ExitCode === 143))
  )
    return Effect.fail(
      new BoundaryError({
        boundary: process.runId,
        message:
          "Docker process success lacks matching clean container exit and removal evidence",
      }),
    );
  return Effect.void;
}
const ContainerEvent = Schema.Struct({
  event: Schema.Literal("container-state"),
  action: Schema.Literals([
    "created",
    "observed",
    "stopped",
    "removed",
    "cleanup-failed",
  ]),
  id: Schema.NullOr(Sha256),
  state: Schema.NullOr(ContainerState),
});
type Input = Pick<
  Request,
  | "runId"
  | "modId"
  | "repository"
  | "directory"
  | "cwd"
  | "command"
  | "env"
  | "shutdownMs"
  | "allowedExitCodes"
> & { docker: ResolvedDockerRuntime };
type Diagnostic = (
  event: typeof ContainerEvent.Type,
) => Effect.Effect<void, BoundaryError | PlatformError.PlatformError>;
export function makeContainer(
  request: Input,
  diagnostic: Diagnostic,
  redact: (text: string) => string,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const services = yield* Effect.context<
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >();
    const runtime = request.docker,
      name = "modkit-" + request.runId;
    const modules = join(request.repository, "node_modules");
    const installation = join(request.repository, dockerCacheSuffix);
    if (
      runtime.engineRoot !== join(installation, "factorio") ||
      runtime.bun !== join(installation, "bun-linux-aarch64/bun")
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.runId,
          message:
            "Container runtime paths do not match the provisioned input boundary",
        }),
      );
    if (request.shutdownMs > 120000)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.runId,
          message: "Docker shutdown deadline exceeds 120 seconds",
        }),
      );
    for (const path of [
      runtime.engineRoot,
      runtime.bun,
      modules,
      request.directory,
    ]) {
      yield* assertCanonicalPath(path);
      if (!contains(request.repository, path))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message:
              "Container inputs and writable state must belong to this checkout",
          }),
        );
    }
    if (request.cwd !== request.repository && request.cwd !== request.directory)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.runId,
          message: "Container cwd must be the selected checkout or owned run",
        }),
      );
    let id: string | null = null;
    let state: typeof ContainerState.Type | null = null;
    let attempted = false,
      removed = false,
      stopAttempted = false,
      removeAttempted = false;
    let cleanup: typeof ContainerReceipt.Type.cleanup = "pending";
    const save = (error?: string) =>
      Effect.gen(function* () {
        const value = yield* decode(
          ContainerReceipt,
          {
            schema: 1,
            runId: request.runId,
            modId: request.modId,
            repository: request.repository,
            directory: request.directory,
            name,
            runtime,
            id,
            state,
            cleanup,
            ...(error === undefined ? {} : { error: redact(error) }),
          },
          "container receipt",
        );
        const path = join(request.directory, "container.json");
        yield* assertCanonicalPath(path);
        yield* assertCanonicalPath(path + ".part");
        yield* fs.writeFileString(
          path + ".part",
          JSON.stringify(value, null, 2) + "\n",
        );
        yield* fs.rename(path + ".part", path);
      });
    const event = (action: typeof ContainerEvent.Type.action) =>
      Effect.gen(function* () {
        const value = yield* decode(
          ContainerEvent,
          { event: "container-state", action, id, state },
          "container event",
        );
        yield* diagnostic(value);
      });
    const control = (args: readonly string[], timeoutMs = 30000) =>
      dockerControl({
        client: runtime.client,
        socket: runtime.socket,
        args,
        env: request.env,
        timeoutMs,
      });
    const observe = Effect.gen(function* () {
      const item = yield* inspectContainer(
        runtime,
        id ?? name,
        request.runId,
        request.env,
      );
      if (id !== null && item.Id !== id)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Container identity changed",
          }),
        );
      id = item.Id;
      state = { ...item.State, Error: redact(item.State.Error) };
      yield* save();
      return state;
    });
    const mount = (source: string, target: string, readOnly: boolean) =>
      [
        "type=bind",
        "source=" + source,
        "target=" + target,
        ...(readOnly ? ["readonly"] : []),
      ]
        .map((field) =>
          field.includes(",") ||
          field.includes('"') ||
          field.includes("\r") ||
          field.includes("\n")
            ? '"' + field.replaceAll('"', '""') + '"'
            : field,
        )
        .join(",");
    const create = Effect.gen(function* () {
      if (attempted)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Container creation was already attempted; not retried",
          }),
        );
      const uid = process.getuid?.(),
        gid = process.getgid?.();
      if (uid === undefined || gid === undefined || uid === 0)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Container execution requires a non-root POSIX caller",
          }),
        );
      const command = request.command[0];
      if (command === undefined)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Missing container executable",
          }),
        );
      yield* save();
      attempted = true;
      const result = yield* control([
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        "dev.modkit.run=" + request.runId,
        "--platform",
        runtime.platform,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        `${uid}:${gid}`,
        "--memory",
        String(runtime.limits.memoryBytes),
        "--cpus",
        String(runtime.limits.cpus),
        "--pids-limit",
        String(runtime.limits.pids),
        "--init",
        "--interactive",
        "--stop-timeout",
        String(Math.ceil(request.shutdownMs / 1000)),
        "--tmpfs",
        `/tmp:rw,nosuid,nodev,size=${runtime.limits.temporaryBytes}`,
        "--mount",
        mount(runtime.bun, "/opt/bun", true),
        "--mount",
        mount(runtime.engineRoot, runtime.engineRoot, true),
        "--mount",
        mount(modules, modules, true),
        "--mount",
        mount(request.directory, request.directory, false),
        "--workdir",
        request.cwd,
        "--entrypoint",
        command,
        runtime.image,
        ...request.command.slice(1),
      ]);
      if (Number(result.code) !== 0) {
        yield* save(
          `Docker create failed: exit=${result.code}; ${result.stderr}`,
        );
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Container creation failed; inspect its durable receipt",
          }),
        );
      }
      const announced = yield* decode(
        Sha256,
        result.stdout.trim(),
        "created container ID",
      );
      yield* observe;
      if (id !== announced)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Created container ID and owned-name readback disagree",
          }),
        );
      yield* event("created");
      return [
        runtime.client,
        "--host",
        "unix://" + runtime.socket,
        "start",
        "--attach",
        "--interactive",
        id!,
      ] as const;
    });
    const stop = Effect.gen(function* () {
      if (!attempted || removed) return { wasRunning: false, state };
      const before = yield* observe;
      const wasRunning =
        before.Running ||
        !["created", "exited", "dead"].includes(before.Status);
      if (wasRunning) {
        if (stopAttempted)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: request.runId,
              message:
                "Container stop outcome remains unresolved; mutation was not retried",
            }),
          );
        stopAttempted = true;
        const result = yield* control(
          ["stop", "--time", String(Math.ceil(request.shutdownMs / 1000)), id!],
          request.shutdownMs + 15000,
        );
        if (Number(result.code) !== 0)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: request.runId,
              message:
                "Owned container stop failed; no other container was targeted",
            }),
          );
        yield* observe;
      }
      if (
        state === null ||
        state.Running ||
        !["created", "exited", "dead"].includes(state.Status)
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Owned container did not reach a stopped state",
          }),
        );
      yield* event(wasRunning ? "stopped" : "observed");
      return { wasRunning, state };
    });
    const verifyExit = (requestedStop: boolean) =>
      Effect.gen(function* () {
        if (
          state === null ||
          state.Running ||
          state.Status !== "exited" ||
          state.OOMKilled ||
          state.Error !== "" ||
          (!requestedStop &&
            !(request.allowedExitCodes ?? [0]).includes(state.ExitCode))
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: request.runId,
              message:
                "Container exit/state does not qualify as successful; inspect exit and OOM facts",
            }),
          );
      });
    const remove = Effect.gen(function* () {
      if (!attempted || removed) return;
      if (removeAttempted)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Container removal was already attempted; not retried",
          }),
        );
      yield* observe;
      if (
        state === null ||
        state.Running ||
        !["created", "exited", "dead"].includes(state.Status)
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Refusing to remove a running container",
          }),
        );
      // State and drained host-mounted artifacts remain durable before removal.
      removeAttempted = true;
      const result = yield* control(["rm", id!]);
      if (Number(result.code) !== 0)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message:
              "Owned container removal failed or has an unknown outcome; not retried",
          }),
        );
      removed = true;
      cleanup = "removed";
      yield* save();
      yield* event("removed");
    });
    const failed = (message: string) =>
      Effect.gen(function* () {
        cleanup = "failed";
        yield* save(message);
        yield* event("cleanup-failed");
      });
    const emergencyCleanup = Effect.gen(function* () {
      if (!attempted || removed || removeAttempted) return;
      yield* stop;
      yield* remove;
    });
    return {
      create: create.pipe(Effect.provide(services)),
      stop: stop.pipe(Effect.provide(services)),
      verifyExit,
      remove: remove.pipe(Effect.provide(services)),
      failed: (message: string) =>
        failed(message).pipe(Effect.provide(services)),
      emergencyCleanup: emergencyCleanup.pipe(Effect.provide(services)),
    };
  });
}
