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
type Hook<Input> = (input: Input) => Effect.Effect<void, Error, Services>;
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
/** Product-owned extensions share one typed, cancellable service boundary. @public */
export type ProjectTooling = typeof Tooling.Type;
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
  const failure = (error: unknown) =>
    error instanceof BoundaryError
      ? error
      : new BoundaryError({
          boundary,
          message: `Product tooling failed: ${String(error)}`,
        });
  return Effect.gen(function* () {
    const pending = yield* Effect.try({
      try: () => operation(input),
      catch: failure,
    });
    if (!Effect.isEffect(pending))
      return yield* Effect.fail(
        new BoundaryError({
          boundary,
          message: "Product tooling hooks must return an Effect",
        }),
      );
    const result: unknown = yield* pending;
    yield* decode(Schema.Undefined, result, boundary);
  }).pipe(
    Effect.provide(BunServices.layer),
    Effect.provide(BunHttpClient.layer),
    Effect.catchDefect((error) => Effect.fail(failure(error))),
    Effect.mapError(failure),
  );
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
