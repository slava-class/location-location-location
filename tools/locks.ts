import { Effect, FileSystem, Schema } from "effect";
import { dirname, join } from "node:path";
import { AbsolutePath } from "./contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  prepareOutputDirectory,
  readJSON,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { RunId } from "./logs.ts";

export const LockOwner = Schema.Struct({
  schema: Schema.Literal(1),
  token: RunId,
  pid: Schema.Int,
  path: AbsolutePath,
  purpose: Schema.NonEmptyString,
  startedAt: Schema.NonEmptyString,
});
export function withOwnedLock<A, E, R>(
  path: string,
  purpose: string,
  operation: Effect.Effect<A, E, R>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const owner = yield* decode(
        LockOwner,
        {
          schema: 1,
          token: crypto.randomUUID(),
          pid: process.pid,
          path,
          purpose,
          startedAt: new Date().toISOString(),
        },
        "lock owner",
      );
      yield* assertCanonicalPath(path);
      yield* prepareOutputDirectory(dirname(path));
      const acquire = fs
        .writeFileString(path, JSON.stringify(owner, null, 2) + "\n", {
          flag: "wx",
        })
        .pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              if (!(yield* fs.exists(path))) return yield* Effect.fail(error);
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: path,
                  message:
                    "Exclusive resource is busy or interrupted. Inspect its owner record before recovery; no lock was removed or stolen.",
                }),
              );
            }),
          ),
        );
      yield* Effect.acquireRelease(acquire, () =>
        Effect.gen(function* () {
          yield* assertCanonicalPath(path);
          const current = yield* readJSON(LockOwner, path);
          if (current.token !== owner.token || current.path !== path)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: path,
                message:
                  "Lock ownership changed; refusing to remove another owner's lock",
              }),
            );
          yield* fs.remove(path);
        }).pipe(Effect.orDie),
      );
      return yield* operation;
    }),
  );
}
export function withReleaseLock<A, E, R>(
  project: ResolvedProject,
  operation: Effect.Effect<A, E, R>,
) {
  return withOwnedLock(
    join(project.outputRoot, "release.lock"),
    "release:" + project.info.name,
    operation,
  );
}
