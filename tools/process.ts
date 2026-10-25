import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Option,
  Schema,
  Scope,
  Stream,
} from "effect";
import type { PlatformError } from "effect";
import { ChildProcess } from "effect/process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assertCanonicalPath,
  BoundaryError,
  contains,
  decode,
  ModId,
} from "./projects.ts";
import { createLog, readLogPage, RunId } from "./logs.ts";
import type { LogEvent } from "./logs.ts";
import { announceRun, EngineRunKind } from "./runs.ts";
import { DockerRuntime } from "./backend.ts";
import { makeContainer } from "./container.ts";
import {
  collectEngineDiagnostics,
  EngineDiagnostics,
} from "./engine-diagnostics.ts";

import { AbsolutePath, ElapsedMs } from "./contracts.ts";
function failureText<A, E>(result: Exit.Exit<A, E>) {
  return Exit.isFailure(result) ? Cause.pretty(result.cause) : undefined;
}
const Milliseconds = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 3600000 }),
);
const Secret = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value.length > 0 && value.length <= 1024 && !/[\r\n]/.test(value),
  ),
);
const ExitCodes = Schema.Array(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
).check(
  Schema.makeFilter(
    (values) => values.length > 0 && new Set(values).size === values.length,
  ),
);
const ProcessRequest = Schema.Struct({
  runId: RunId,
  modId: Schema.NullOr(ModId),
  profile: Schema.NonEmptyString,
  repository: AbsolutePath,
  directory: AbsolutePath,
  cwd: AbsolutePath,
  command: Schema.Array(Schema.NonEmptyString).check(
    Schema.makeFilter((value) => value.length > 0),
  ),
  env: Schema.Record(Schema.String, Schema.String),
  redact: Schema.Array(Secret).check(
    Schema.makeFilter((value) => value.length <= 32),
  ),
  deadlineMs: Milliseconds,
  shutdownMs: Milliseconds,
  evidence: Schema.optionalKey(EngineRunKind),
  docker: Schema.optionalKey(DockerRuntime),
  gameLog: Schema.optionalKey(
    Schema.Struct({
      current: AbsolutePath,
      previous: AbsolutePath,
    }),
  ),
  allowedExitCodes: Schema.optionalKey(ExitCodes),
});
export type Request = typeof ProcessRequest.Type;
const ExitObservation = Schema.Struct({
  code: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(Schema.String),
});
type ObservedExit = typeof ExitObservation.Type;
export const ProcessReceipt = Schema.Struct({
  schema: Schema.Literal(2),
  runId: RunId,
  modId: Schema.NullOr(ModId),
  profile: Schema.NonEmptyString,
  command: Schema.Array(Schema.String),
  repository: AbsolutePath,
  cwd: AbsolutePath,
  startedAt: Schema.String,
  ownerPid: Schema.Int,
  childPid: Schema.optionalKey(Schema.Int),
  status: Schema.Literals(["running", "passed", "failed", "cancelled"]),
  phase: Schema.String,
  elapsedMs: ElapsedMs,
  exit: Schema.optionalKey(ExitObservation),
  allowedExitCodes: ExitCodes,
  termination: Schema.Literals([
    "natural",
    "requested-stop",
    "scope-cleanup",
    "spawn-failed",
  ]),
  error: Schema.optionalKey(Schema.String),
  deadline: Schema.NullOr(
    Schema.Struct({ phase: Schema.String, limitMs: Milliseconds }),
  ),
  interrupted: Schema.Boolean,
  finalizationErrors: Schema.Array(Schema.String),
  engineDiagnostics: Schema.NullOr(EngineDiagnostics),
});
const GameLogFileEvent = Schema.Struct({
  event: Schema.Literal("game-log-file"),
  path: AbsolutePath,
  identity: Schema.NonEmptyString,
  previousIdentity: Schema.NullOr(Schema.NonEmptyString),
  replaces: Schema.NullOr(Schema.NonEmptyString),
});
const ProcessPhaseEvent = Schema.Struct({
  event: Schema.Literal("process-phase"),
  phase: Schema.NonEmptyString,
});

export class TextRedactor {
  private pending = "";
  private readonly longest: number;
  constructor(private readonly secrets: readonly string[]) {
    this.secrets = [...new Set(secrets)].sort((a, b) => b.length - a.length);
    this.longest = Math.max(1, ...this.secrets.map((value) => value.length));
  }
  push(text: string, final = false) {
    this.pending += text;
    let cut = final
      ? this.pending.length
      : Math.max(
          0,
          this.pending.length - this.longest + 1,
          this.pending.lastIndexOf("\n") + 1,
        );
    for (const secret of this.secrets) {
      let position = this.pending.indexOf(secret);
      while (position >= 0 && position < cut) {
        if (position + secret.length > cut) cut = position;
        position = this.pending.indexOf(secret, position + 1);
      }
    }
    let output = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    for (const secret of this.secrets)
      output = output.replaceAll(secret, "[REDACTED]");
    return output;
  }
}
const redact = (text: string, secrets: readonly string[]) =>
  new TextRedactor(secrets).push(text, true);
const errorText = (error: unknown, secrets: readonly string[]) =>
  redact(String(error), secrets).slice(0, 4000);

export interface OwnedProcess {
  readonly pid: number;
  readonly directory: string;
  readonly logs: string;
  readonly phase: (
    name: string,
  ) => Effect.Effect<void, BoundaryError | PlatformError.PlatformError>;
  readonly waitForText: (
    pattern: RegExp,
    phase: string,
    timeoutMs: number,
  ) => Effect.Effect<string, BoundaryError | PlatformError.PlatformError>;
  readonly waitForExit: Effect.Effect<
    ObservedExit,
    BoundaryError | PlatformError.PlatformError
  >;
  readonly send: (
    text: string,
  ) => Effect.Effect<void, BoundaryError | PlatformError.PlatformError>;
  readonly stop: Effect.Effect<
    ObservedExit,
    BoundaryError | PlatformError.PlatformError
  >;
}

export function withProcess<A, E, R>(
  input: unknown,
  use: (process: OwnedProcess) => Effect.Effect<A, E, R>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const request = yield* decode(ProcessRequest, input, "process request");
      const allowedExitCodes = request.allowedExitCodes ?? [0];
      if (
        request.gameLog !== undefined &&
        (!contains(request.directory, request.gameLog.current) ||
          !contains(request.directory, request.gameLog.previous) ||
          request.gameLog.current === request.gameLog.previous)
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message:
              "Current and previous game logs must be distinct paths in the owned run",
          }),
        );
      const fs = yield* FileSystem.FileSystem;
      if (request.gameLog !== undefined) {
        yield* assertCanonicalPath(request.gameLog.current);
        yield* assertCanonicalPath(request.gameLog.previous);
      }
      // The deferred diagnostic callback is only used after log creation.
      const container =
        request.docker === undefined
          ? undefined
          : yield* makeContainer(
              { ...request, docker: request.docker },
              (event) =>
                record("lifecycle", JSON.stringify(event) + "\n", {
                  event: event.event,
                }),
              (text) => errorText(text, request.redact),
            );
      const startedAt = new Date().toISOString(),
        start = performance.now();
      const logDirectory = join(request.directory, "logs");
      const log = yield* createLog(logDirectory, request.runId);
      const record = (
        channel: LogEvent["channel"],
        text: string,
        metadata: LogEvent["metadata"] = {},
      ) =>
        Effect.gen(function* () {
          for (let offset = 0; offset < text.length; offset += 2048)
            yield* log.append(
              channel,
              text.slice(offset, offset + 2048),
              metadata,
            );
        });
      let containerHandled = false;
      if (container !== undefined)
        yield* Effect.addFinalizer(() =>
          containerHandled
            ? Effect.void
            : container.emergencyCleanup.pipe(
                Effect.catch((error) =>
                  container.failed(errorText(error, request.redact)),
                ),
                Effect.orDie,
              ),
        );
      let phase = "starting",
        requestedStop = false,
        childPid: number | undefined,
        observedExit: ObservedExit | undefined;
      let deadline: typeof ProcessReceipt.Type.deadline = null;
      let interrupted = false;
      let finalizationIssues: string[] = [];
      let engineDiagnostics: typeof EngineDiagnostics.Type | null = null;
      const save = (
        status: "running" | "passed" | "failed" | "cancelled",
        termination:
          | "natural"
          | "requested-stop"
          | "scope-cleanup"
          | "spawn-failed",
        error?: string,
      ) =>
        Effect.gen(function* () {
          const value = yield* decode(
            ProcessReceipt,
            {
              schema: 2,
              runId: request.runId,
              modId: request.modId,
              profile: request.profile,
              command: request.command.map((part) =>
                redact(part, request.redact),
              ),
              repository: request.repository,
              cwd: request.cwd,
              startedAt,
              ownerPid: process.pid,
              allowedExitCodes,
              ...(childPid === undefined ? {} : { childPid }),
              status,
              phase,
              elapsedMs: performance.now() - start,
              ...(observedExit ? { exit: observedExit } : {}),
              termination,
              ...(error ? { error } : {}),
              deadline,
              interrupted,
              finalizationErrors: finalizationIssues,
              engineDiagnostics,
            },
            "process receipt",
          );
          yield* fs.writeFileString(
            join(request.directory, "process.json.part"),
            JSON.stringify(Schema.encodeSync(ProcessReceipt)(value), null, 2) +
              "\n",
          );
          yield* fs.rename(
            join(request.directory, "process.json.part"),
            join(request.directory, "process.json"),
          );
        });
      yield* save("running", "natural");
      yield* announceRun({
        ...request,
        kind: request.evidence ?? "command",
        backend: container === undefined ? "native" : "docker",
        startedAt,
      });
      const childScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const logScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const launched = yield* Effect.gen(function* () {
        const command =
          container === undefined ? request.command : yield* container.create;
        const [executable, ...args] = command;
        if (executable === undefined)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: request.runId,
              message: "Missing executable",
            }),
          );
        return yield* ChildProcess.make(executable, args, {
          cwd: request.cwd,
          env: { ...request.env },
          extendEnv: false,
          detached: true,
          stdin: { stream: "pipe", endOnDone: false },
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: request.shutdownMs,
        }).pipe(Effect.provideService(Scope.Scope, childScope));
      }).pipe(Effect.exit);
      if (Exit.isFailure(launched)) {
        if (container !== undefined) {
          const cleanup = yield* container.emergencyCleanup.pipe(Effect.exit);
          containerHandled = true;
          if (Exit.isFailure(cleanup)) {
            const details = errorText(
              Cause.pretty(cleanup.cause),
              request.redact,
            );
            finalizationIssues.push(details);
            yield* container.failed(details);
          }
        }
        yield* save(
          "failed",
          "spawn-failed",
          errorText(Cause.pretty(launched.cause), request.redact),
        );
        yield* log.seal;
        return yield* Effect.fail(
          new BoundaryError({
            boundary: request.runId,
            message: "Process could not start; inspect its receipt",
          }),
        );
      }
      const child = launched.value;
      childPid = Number(child.pid);
      yield* save("running", "natural");
      const pump = (
        channel: "stdout" | "stderr",
        stream: typeof child.stdout,
      ) =>
        Effect.gen(function* () {
          const redactor = new TextRedactor(request.redact);
          yield* Stream.runForEach(Stream.decodeText(stream), (text) =>
            record(channel, redactor.push(text)),
          );
          yield* record(channel, redactor.push("", true));
        });
      const stdout = yield* Effect.forkIn(
        pump("stdout", child.stdout),
        logScope,
      );
      const stderr = yield* Effect.forkIn(
        pump("stderr", child.stderr),
        logScope,
      );
      // The launcher may exit before its engine child flushes its final log.
      const childrenStopped = yield* Deferred.make<void>();
      const gamePump = Effect.gen(function* () {
        if (request.gameLog === undefined) return;
        const paths = request.gameLog;
        const fail = (message: string) =>
          new BoundaryError({ boundary: request.runId, message });
        const identity = (info: FileSystem.File.Info) =>
          info.type !== "File" || Option.isNone(info.ino)
            ? Effect.fail(fail("Game log must be an identifiable regular file"))
            : Effect.succeed(`${info.dev}:${info.ino.value}`);
        const statPath = (path: string) =>
          Effect.gen(function* () {
            yield* assertCanonicalPath(path);
            return yield* fs
              .stat(path)
              .pipe(
                Effect.catch((error) =>
                  error.reason._tag === "NotFound"
                    ? Effect.succeed(undefined)
                    : Effect.fail(error),
                ),
              );
          });
        const buffer = new Uint8Array(8192);
        let expected: string | undefined;
        let previousIdentity: string | null = null;
        while (true) {
          const running = !(yield* Deferred.isDone(childrenStopped));
          const pending = yield* statPath(paths.current);
          if (pending === undefined) {
            if (!running)
              return yield* Effect.fail(
                fail(
                  "Expected game log was never created; stdout/stderr remain available",
                ),
              );
            yield* Effect.sleep(100);
            continue;
          }
          const pendingIdentity = yield* identity(pending);
          if (
            expected === undefined &&
            (yield* statPath(paths.previous)) !== undefined
          )
            return yield* Effect.fail(
              fail(
                "Game log rotated before collection began; diagnostic history is incomplete",
              ),
            );
          const next = yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(paths.current, { flag: "r" });
              const currentIdentity = yield* identity(yield* file.stat);
              if (
                currentIdentity !== pendingIdentity ||
                (expected !== undefined && expected !== currentIdentity)
              )
                return yield* Effect.fail(
                  fail(
                    "Game log rotated again before collection could attach; diagnostic gap",
                  ),
                );
              let revision = 0,
                offset = 0,
                headLength = 0,
                tailLength = 0,
                tailPosition = 0;
              let decoder = new TextDecoder(),
                redactor = new TextRedactor(request.redact);
              let digest = createHash("sha256");
              let metadata = {
                file: {
                  openedPath: paths.current,
                  identity: `${currentIdentity}:${revision}`,
                },
              };
              const head = new Uint8Array(8192),
                tail = new Uint8Array(8192),
                probe = new Uint8Array(8192);
              const sourceEvent = (replaces: string | null) =>
                Effect.gen(function* () {
                  const event = yield* decode(
                    GameLogFileEvent,
                    {
                      event: "game-log-file",
                      path: paths.current,
                      identity: metadata.file.identity,
                      previousIdentity:
                        replaces === null ? previousIdentity : replaces,
                      replaces,
                    },
                    "game log source event",
                  );
                  yield* log.append("lifecycle", JSON.stringify(event) + "\n", {
                    ...metadata,
                    event: event.event,
                  });
                });
              yield* sourceEvent(null);
              const restart = Effect.gen(function* () {
                yield* record(
                  "game",
                  redactor.push(decoder.decode(), true),
                  metadata,
                );
                const replaced = metadata.file.identity;
                revision++;
                metadata = {
                  file: {
                    openedPath: paths.current,
                    identity: `${currentIdentity}:${revision}`,
                  },
                };
                offset = headLength = tailLength = tailPosition = 0;
                decoder = new TextDecoder();
                redactor = new TextRedactor(request.redact);
                digest = createHash("sha256");
                yield* sourceEvent(replaced);
              });
              const windowMatches = (
                expected: Uint8Array,
                length: number,
                position: number,
              ) =>
                Effect.gen(function* () {
                  let read = 0;
                  while (read < length) {
                    const count = yield* file.read(
                      probe.subarray(read, length),
                      { position: BigInt(position + read) },
                    );
                    if (count === 0) return false;
                    read += count;
                  }
                  for (let index = 0; index < length; index++)
                    if (probe[index] !== expected[index]) return false;
                  return true;
                });
              const drain = Effect.gen(function* () {
                const size = Number((yield* file.stat).size);
                // Factorio can truncate and regrow this same inode during startup.
                // Bounded witnesses detect ordinary rewrites without rehashing a
                // growing log on every poll; finalization verifies all bytes.
                if (
                  size < offset ||
                  (headLength > 0 &&
                    !(yield* windowMatches(head, headLength, 0))) ||
                  (tailPosition > 0 &&
                    !(yield* windowMatches(tail, tailLength, tailPosition)))
                )
                  yield* restart;
                while (offset < size) {
                  const count = yield* file.read(
                    buffer.subarray(0, Math.min(buffer.length, size - offset)),
                    { position: BigInt(offset) },
                  );
                  if (count === 0) break; // A concurrent rewrite is observed on the next drain.
                  const chunk = buffer.subarray(0, count);
                  if (headLength < head.length) {
                    const retained = Math.min(count, head.length - headLength);
                    head.set(chunk.subarray(0, retained), headLength);
                    headLength += retained;
                  }
                  tail.set(chunk);
                  tailLength = count;
                  tailPosition = offset;
                  offset += count;
                  digest.update(chunk);
                  yield* record(
                    "game",
                    redactor.push(decoder.decode(chunk, { stream: true })),
                    metadata,
                  );
                }
              });
              const allBytesMatch = Effect.gen(function* () {
                if (Number((yield* file.stat).size) !== offset) return false;
                const actual = createHash("sha256");
                let position = 0;
                while (position < offset) {
                  const count = yield* file.read(
                    buffer.subarray(
                      0,
                      Math.min(buffer.length, offset - position),
                    ),
                    { position: BigInt(position) },
                  );
                  if (count === 0) return false;
                  actual.update(buffer.subarray(0, count));
                  position += count;
                }
                return (
                  Number((yield* file.stat).size) === offset &&
                  actual.digest("hex") === digest.copy().digest("hex")
                );
              });
              const finish = Effect.gen(function* () {
                yield* drain;
                if (!(yield* allBytesMatch)) {
                  yield* restart;
                  yield* drain;
                  if (!(yield* allBytesMatch))
                    return yield* Effect.fail(
                      fail(
                        "Game log changed during final snapshot; diagnostic gap",
                      ),
                    );
                }
                if (offset === 0)
                  return yield* Effect.fail(
                    fail("Game log ended empty; diagnostic gap"),
                  );
                yield* record(
                  "game",
                  redactor.push(decoder.decode(), true),
                  metadata,
                );
              });
              while (true) {
                const running = !(yield* Deferred.isDone(childrenStopped));
                yield* drain;
                const observed = yield* statPath(paths.current);
                if (observed !== undefined) {
                  const observedIdentity = yield* identity(observed);
                  if (observedIdentity !== currentIdentity) {
                    const rotated = yield* statPath(paths.previous);
                    if (
                      rotated === undefined ||
                      (yield* identity(rotated)) !== currentIdentity
                    )
                      return yield* Effect.fail(
                        fail(
                          "Rotated game log does not preserve the prior file; diagnostic gap",
                        ),
                      );
                    // Keep the old descriptor open until its final bytes have drained.
                    yield* finish;
                    return {
                      current: observedIdentity,
                      previous: metadata.file.identity,
                    };
                  }
                }
                if (!running) {
                  if (observed === undefined)
                    return yield* Effect.fail(
                      fail("Current game log disappeared before final drain"),
                    );
                  yield* finish;
                  return undefined;
                }
                yield* Effect.sleep(100);
              }
            }),
          );
          if (next === undefined) return;
          expected = next.current;
          previousIdentity = next.previous;
        }
      });
      const game = yield* Effect.forkIn(gamePump, logScope);
      const observe = child.exitCode.pipe(
        Effect.match({
          onSuccess: (code) => ({ code: Number(code), signal: null }),
          onFailure: (error) => ({
            code: null,
            signal:
              error.reason.cause instanceof Error
                ? (error.reason.cause.message.match(
                    /^Process interrupted due to receipt of signal: '(SIG[A-Z0-9]+)'$/,
                  )?.[1] ?? null)
                : null,
          }),
        }),
        Effect.flatMap((value) =>
          decode(ExitObservation, value, "process exit"),
        ),
        Effect.tap((value) =>
          Effect.sync(() => {
            observedExit = value;
          }),
        ),
      );
      const exitFiber = yield* Effect.forkIn(observe, logScope);
      const setPhase = (name: string) =>
        Effect.gen(function* () {
          phase = name;
          const event = yield* decode(
            ProcessPhaseEvent,
            { event: "process-phase", phase: name },
            "process phase event",
          );
          yield* log.append("lifecycle", JSON.stringify(event) + "\n", {
            event: event.event,
          });
          yield* save("running", requestedStop ? "requested-stop" : "natural");
        });
      const waitForExit = Effect.gen(function* () {
        const result = yield* Fiber.join(exitFiber);
        if (
          (result.code === null || !allowedExitCodes.includes(result.code)) &&
          !(
            requestedStop &&
            (result.signal === "SIGTERM" ||
              (container !== undefined && result.code === 143))
          )
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: request.runId,
              message: `Process failed: exit=${result.code} signal=${result.signal}; inspect run logs`,
            }),
          );
        return result;
      });
      const stop = Effect.gen(function* () {
        requestedStop = true;
        yield* setPhase("stopping");
        if (container !== undefined) yield* container.stop;
        else if (yield* child.isRunning)
          yield* child.kill({ forceKillAfter: request.shutdownMs });
        return yield* waitForExit;
      });
      const context: OwnedProcess = {
        pid: childPid,
        directory: request.directory,
        logs: logDirectory,
        phase: setPhase,
        waitForExit,
        stop,
        send: (text) =>
          Stream.run(
            Stream.make(new TextEncoder().encode(text)),
            child.stdin,
          ).pipe(
            Effect.mapError(
              () =>
                new BoundaryError({
                  boundary: request.runId,
                  message:
                    "Child input failed; command outcome may be unknown; not retried",
                }),
            ),
          ),
        waitForText: (pattern, name, timeoutMs) =>
          Effect.gen(function* () {
            yield* setPhase(name);
            let cursor = { runId: request.runId, sequence: 0 };
            const windows = new Map<LogEvent["channel"], string>();
            const waitDeadline = performance.now() + timeoutMs;
            while (performance.now() < waitDeadline) {
              const page = yield* readLogPage(logDirectory, cursor);
              cursor = page.cursor;
              for (const item of page.records) {
                if (item.channel === "lifecycle") continue;
                const window = (
                  (windows.get(item.channel) ?? "") + item.text
                ).slice(-8192);
                windows.set(item.channel, window);
                pattern.lastIndex = 0;
                const match = pattern.exec(window);
                if (match !== null) return match[0];
              }
              if (!(yield* child.isRunning))
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: request.runId,
                    message: `Process exited before ${name}`,
                  }),
                );
              yield* Effect.sleep(50);
            }
            deadline = { phase: name, limitMs: timeoutMs };
            return yield* Effect.fail(
              new BoundaryError({
                boundary: request.runId,
                message: `Deadline exceeded during ${name}`,
              }),
            );
          }).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
      };
      const watch = (fiber: typeof stdout) =>
        Fiber.join(fiber).pipe(Effect.flatMap(() => Effect.never));
      const operation = use(context).pipe(
        Effect.tap(() =>
          Effect.gen(function* () {
            if (yield* child.isRunning)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: request.runId,
                  message:
                    "Process callback returned before exit or explicit stop",
                }),
              );
          }),
        ),
        Effect.raceFirst(watch(stdout)),
        Effect.raceFirst(watch(stderr)),
        Effect.raceFirst(watch(game)),
        Effect.timeoutOrElse({
          duration: Math.max(
            1,
            request.deadlineMs - (performance.now() - start),
          ),
          orElse: () => {
            deadline = { phase, limitMs: request.deadlineMs };
            return Effect.fail(
              new BoundaryError({
                boundary: request.runId,
                message: `Process deadline exceeded during ${phase} (${request.deadlineMs} ms)`,
              }),
            );
          },
        }),
        Effect.mapError(
          (error) =>
            new BoundaryError({
              boundary: request.runId,
              message: errorText(error, request.redact),
            }),
        ),
      );
      return yield* operation.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const stillRunning = yield* child.isRunning;
            const stopped = yield* Effect.gen(function* () {
              return container === undefined
                ? { wasRunning: false }
                : yield* container.stop;
            }).pipe(Effect.exit);
            const groupClosed = yield* Scope.close(childScope, Exit.void).pipe(
              Effect.exit,
            );
            yield* Deferred.succeed(childrenStopped, undefined);
            const drained = yield* Effect.all(
              [
                Fiber.join(stdout),
                Fiber.join(stderr),
                Fiber.join(game),
                Fiber.join(exitFiber),
              ],
              { concurrency: "unbounded" },
            ).pipe(Effect.timeout(request.shutdownMs + 2000), Effect.exit);
            const logsClosed = yield* Scope.close(logScope, Exit.void).pipe(
              Effect.exit,
            );
            const containerExit = yield* Effect.gen(function* () {
              if (
                container === undefined ||
                Exit.isFailure(exit) ||
                Exit.isFailure(stopped)
              )
                return;
              if (stopped.value.wasRunning && !requestedStop)
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: request.runId,
                    message:
                      "Docker client completed while its container was still running",
                  }),
                );
              yield* container.verifyExit(requestedStop);
            }).pipe(Effect.exit);
            const removed = yield* (
              container === undefined ? Effect.void : container.remove
            ).pipe(Effect.exit);
            containerHandled = true;
            const cleanupErrors = [
              failureText(stopped),
              failureText(groupClosed),
              failureText(logsClosed),
              failureText(removed),
            ].filter((text) => text !== undefined);
            const cleanupRecorded = yield* (
              container !== undefined && cleanupErrors.length > 0
                ? container.failed(cleanupErrors.join("\n"))
                : Effect.void
            ).pipe(Effect.exit);
            const diagnosed = yield* (
              request.gameLog === undefined
                ? Effect.succeed(null)
                : collectEngineDiagnostics(
                    request.directory,
                    request.gameLog,
                    () => new TextRedactor(request.redact),
                  )
            ).pipe(Effect.exit);
            if (Exit.isSuccess(diagnosed)) engineDiagnostics = diagnosed.value;
            phase = "finished";
            const sealed = yield* log.seal.pipe(Effect.exit);
            const finalizationErrors = [
              ...cleanupErrors,
              failureText(drained),
              failureText(containerExit),
              failureText(cleanupRecorded),
              failureText(sealed),
              failureText(diagnosed),
            ].filter((text) => text !== undefined);
            finalizationIssues = finalizationErrors.map((text) =>
              errorText(text, request.redact),
            );
            interrupted =
              Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
            const finalizationFailed = finalizationErrors.length > 0;
            const failed = Exit.isFailure(exit) || finalizationFailed;
            const cancelled = !finalizationFailed && interrupted;
            const details = [failureText(exit), ...finalizationErrors]
              .filter((text) => text !== undefined)
              .join("\n");
            yield* save(
              cancelled ? "cancelled" : failed ? "failed" : "passed",
              requestedStop
                ? "requested-stop"
                : stillRunning
                  ? "scope-cleanup"
                  : "natural",
              details.length === 0
                ? undefined
                : errorText(details, request.redact),
            );
            if (finalizationFailed)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: request.runId,
                  message:
                    "Process cleanup, container state, or final diagnostics failed; inspect run receipts",
                }),
              );
          }),
        ),
      );
    }),
  );
}
