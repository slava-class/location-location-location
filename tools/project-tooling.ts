import { BunHttpClient, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";
import type { Layer } from "effect";
import type { HttpClient } from "effect/http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BoundaryError, decode } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";

interface AuditContext {
  readonly project: ResolvedProject;
  readonly members: readonly string[];
  readonly english: ReadonlyMap<string, string>;
}
interface CommandContext {
  readonly project: ResolvedProject;
  readonly args: readonly string[];
}
type Services = Layer.Success<typeof BunServices.layer> | HttpClient.HttpClient;
type Work<Input> = (input: Input) => Effect.Effect<void, Error, Services>;
type Hook<Input> = (input: Input, signal: AbortSignal) => Promise<void>;
interface Definition {
  readonly setup?: Work<ResolvedProject>;
  readonly audit?: Work<AuditContext>;
  readonly command?: Work<CommandContext>;
}
function own<Input>(work: Work<Input>): Hook<Input> {
  return (input, signal) =>
    Effect.runPromise(
      work(input).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(BunHttpClient.layer),
      ),
      { signal },
    );
}
/** Product-owned extensions share one typed, cancellable service boundary. @public */
export function defineProjectTooling(definition: Definition) {
  return {
    ...(definition.setup === undefined ? {} : { setup: own(definition.setup) }),
    ...(definition.audit === undefined ? {} : { audit: own(definition.audit) }),
    ...(definition.command === undefined
      ? {}
      : { command: own(definition.command) }),
  };
}
function hook<Input>() {
  return Schema.declare(
    (value): value is Hook<Input> => typeof value === "function",
  );
}
const Tooling = Schema.Struct({
  setup: Schema.optional(hook<ResolvedProject>()),
  audit: Schema.optional(hook<AuditContext>()),
  command: Schema.optional(hook<CommandContext>()),
});
export function projectTooling(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(project.modRoot, "dev", "tooling.ts");
    if (!(yield* fs.exists(path)))
      return yield* decode(Tooling, {}, "absent product tooling");
    const loaded = yield* Effect.tryPromise({
      try: (): Promise<unknown> => import(pathToFileURL(path).href),
      catch: (error) =>
        new BoundaryError({
          boundary: path,
          message: `Product tooling could not load: ${String(error)}`,
        }),
    });
    const module = yield* decode(
      Schema.Struct({ default: Tooling }),
      loaded,
      path,
    );
    return module.default;
  });
}
export function invokeProjectTool<Input>(
  operation: Hook<Input>,
  input: Input,
  boundary: string,
) {
  return Effect.gen(function* () {
    const result: unknown = yield* Effect.tryPromise({
      try: async (signal) => {
        const pending: unknown = operation(input, signal);
        if (!(pending instanceof Promise))
          throw new BoundaryError({
            boundary,
            message:
              "Product tooling must use defineProjectTooling to own its Effect services",
          });
        return await pending;
      },
      catch: (error) =>
        error instanceof BoundaryError
          ? error
          : new BoundaryError({
              boundary,
              message: `Product tooling failed: ${String(error)}`,
            }),
    });
    yield* decode(Schema.Undefined, result, boundary);
  });
}
export function runProjectCommand(
  project: ResolvedProject,
  args: readonly string[],
) {
  return Effect.gen(function* () {
    const { command } = yield* projectTooling(project);
    if (command === undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "This product has no additional commands",
        }),
      );
    yield* invokeProjectTool(
      command,
      { project, args },
      `${project.info.name} command`,
    );
  });
}
