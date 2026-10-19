import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { lstat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DockerRuntime } from "./backend.ts";
import type { ResolvedDockerRuntime } from "./backend.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  decodeJSON,
} from "./projects.ts";
import { Sha256 } from "./contracts.ts";

function canonicalSocket(input: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // Bun 1.4.2 realpath rejects Darwin sockets; resolve the directory and
    // validate the leaf's actual kind instead of treating it as a regular file.
    const socket = join(yield* fs.realPath(dirname(input)), basename(input));
    const info = yield* Effect.tryPromise({
      try: () => lstat(socket),
      catch: () =>
        new BoundaryError({
          boundary: "Docker endpoint",
          message: "Local Unix socket is missing or unreadable",
        }),
    });
    if (!info.isSocket())
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Docker endpoint",
          message:
            "Select an actual local Unix socket, not a file or leaf symlink",
        }),
      );
    return socket;
  });
}
export const ContainerState = Schema.Struct({
  Status: Schema.Literals([
    "created",
    "running",
    "paused",
    "restarting",
    "removing",
    "exited",
    "dead",
  ]),
  Running: Schema.Boolean,
  OOMKilled: Schema.Boolean,
  ExitCode: Schema.Int,
  Error: Schema.String,
  StartedAt: Schema.String,
  FinishedAt: Schema.String,
});
const Inspection = Schema.Array(
  Schema.Struct({
    Id: Sha256,
    Name: Schema.String,
    State: ContainerState,
    Config: Schema.Struct({
      Labels: Schema.Record(Schema.String, Schema.String),
    }),
  }),
).check(Schema.makeFilter((values) => values.length === 1));
const ControlRequest = Schema.Struct({
  client: DockerRuntime.fields.client,
  socket: DockerRuntime.fields.socket,
  args: Schema.Array(Schema.NonEmptyString).check(
    Schema.makeFilter((values) => values.length > 0),
  ),
  env: Schema.Record(Schema.String, Schema.String),
  timeoutMs: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 180000 }),
  ),
});

// Control calls are short, scoped protocol exchanges. The engine itself stays under withProcess.
export function dockerControl(input: typeof ControlRequest.Type) {
  return Effect.scoped(
    Effect.gen(function* () {
      const request = yield* decode(
        ControlRequest,
        input,
        "Docker control request",
      );
      yield* assertCanonicalPath(request.client);
      if ((yield* canonicalSocket(request.socket)) !== request.socket)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "Docker endpoint",
            message: "Daemon socket path is no longer canonical",
          }),
        );
      const child = yield* ChildProcess.make(
        request.client,
        ["--host", "unix://" + request.socket, ...request.args],
        {
          env: { ...request.env },
          extendEnv: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: 1000,
        },
      );
      const collect = (stream: typeof child.stdout) =>
        Effect.gen(function* () {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          const parts: string[] = [];
          let bytes = 0;
          yield* Stream.runForEach(stream, (chunk) =>
            Effect.gen(function* () {
              bytes += chunk.byteLength;
              if (bytes > 1024 * 1024)
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: "Docker control",
                    message: "Control output exceeds one MiB",
                  }),
                );
              parts.push(
                yield* Effect.try({
                  try: () => decoder.decode(chunk, { stream: true }),
                  catch: () =>
                    new BoundaryError({
                      boundary: "Docker control",
                      message: "Control output is not valid UTF-8",
                    }),
                }),
              );
            }),
          );
          parts.push(
            yield* Effect.try({
              try: () => decoder.decode(),
              catch: () =>
                new BoundaryError({
                  boundary: "Docker control",
                  message: "Control output ended in partial UTF-8",
                }),
            }),
          );
          return parts.join("");
        });
      return yield* Effect.all(
        {
          stdout: collect(child.stdout),
          stderr: collect(child.stderr),
          code: child.exitCode,
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.timeout(request.timeoutMs));
    }),
  ).pipe(
    Effect.mapError((error) =>
      error instanceof BoundaryError
        ? error
        : new BoundaryError({
            boundary: "Docker control",
            message:
              "Docker control failed or timed out; operation outcome may be unknown and was not retried",
          }),
    ),
  );
}
export function inspectContainer(
  runtime: ResolvedDockerRuntime,
  name: string,
  runId: string,
  env: Readonly<Record<string, string>>,
) {
  return Effect.gen(function* () {
    const result = yield* dockerControl({
      client: runtime.client,
      socket: runtime.socket,
      args: ["container", "inspect", name],
      env,
      timeoutMs: 30000,
    });
    if (Number(result.code) !== 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: runId,
          message:
            "Container identity/state is unavailable; no destructive action is authorized by this response",
        }),
      );
    const rows = yield* decodeJSON(
      Inspection,
      new TextEncoder().encode(result.stdout),
      "Docker inspection",
      true,
    );
    const item = rows[0]!;
    if (
      item.Config.Labels["dev.modkit.run"] !== runId ||
      item.Name !== "/modkit-" + runId
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: runId,
          message:
            "Container ownership does not match; refusing to stop or remove it",
        }),
      );
    return item;
  });
}
export function dockerConnection(clientInput: string, endpoint: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!endpoint.startsWith("unix:///"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Docker endpoint",
          message:
            "Only a local Unix-socket daemon is supported; remote Docker is not authorized",
        }),
      );
    const client = yield* fs.realPath(clientInput);
    const socket = yield* canonicalSocket(endpoint.slice("unix://".length));
    yield* assertCanonicalPath(client);
    return { client, socket };
  });
}
