import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";
import type { Layer, PlatformError } from "effect";
import { resolveStudio } from "./source.ts";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BoundaryError, decode } from "../projects.ts";
import type { ResolvedProject } from "../projects.ts";
import { SavedGame } from "../engine-session.ts";
import { RunId } from "../logs.ts";
import { CaptureEvidence } from "./capture.ts";
import { StudioManifest, StudioState } from "./contracts.ts";
import { readStudioManifest, withStudio } from "./session.ts";
import type { LiveStudio } from "./session.ts";
import type { RconError } from "../rcon.ts";

const Qualification = Schema.Struct({
  checks: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  captures: Schema.Array(CaptureEvidence).check(Schema.isMinLength(1)),
  save: SavedGame,
  reloaded: StudioState,
  reloadRun: RunId,
  final: StudioState,
});
const Receipt = Schema.Struct({
  schema: Schema.Literal(1),
  status: Schema.Literal("passed"),
  manifest: StudioManifest,
  result: Qualification,
});
type Verifier = (live: LiveStudio, signal: AbortSignal) => Promise<unknown>;
const Module = Schema.Struct({
  default: Schema.declare(
    (input): input is Verifier => typeof input === "function",
  ),
});

/**
 * Product-owned behavioral verification; the shared runner owns processes and receipts.
 * @public
 */
export function defineStudioVerification(
  verify: (
    live: LiveStudio,
  ) => Effect.Effect<
    typeof Qualification.Type,
    BoundaryError | PlatformError.PlatformError | RconError,
    Layer.Success<typeof BunServices.layer>
  >,
): Verifier {
  return (live, signal) =>
    Effect.runPromise(verify(live).pipe(Effect.provide(BunServices.layer)), {
      signal,
    });
}

export function verifyStudio(
  project: ResolvedProject,
  tuner: string,
  engine?: string,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const studio = yield* resolveStudio(project, tuner);
    const hook = join(studio.directory, "verify.ts");
    const loaded: unknown = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(hook).href),
      catch: (error) =>
        new BoundaryError({
          boundary: hook,
          message: `Cannot load studio verification: ${String(error)}`,
        }),
    });
    const module = yield* decode(Module, loaded, "studio verification module");
    const completed = yield* withStudio(
      project,
      tuner,
      {
        deadlineMs: 240000,
        ...(engine === undefined ? {} : { engine }),
      },
      (live) =>
        Effect.gen(function* () {
          const result: unknown = yield* Effect.tryPromise({
            try: async (signal) => {
              const pending = module.default(live, signal);
              if (!(pending instanceof Promise))
                throw new Error(
                  "Use defineStudioVerification to own Effect services",
                );
              return await pending;
            },
            catch: (error) =>
              new BoundaryError({ boundary: hook, message: String(error) }),
          });
          return {
            session: live.manifest.session,
            result: yield* decode(
              Qualification,
              result,
              "studio qualification",
            ),
          };
        }),
    );
    const manifest = yield* readStudioManifest(project, completed.session);
    const receipt = yield* decode(
      Receipt,
      { schema: 1, status: "passed", manifest, result: completed.result },
      "studio verification receipt",
    );
    const path = join(manifest.directory, "studio-verification.json");
    yield* fs.writeFileString(path, JSON.stringify(receipt, null, 2) + "\n", {
      flag: "wx",
    });
    return { path, receipt };
  });
}
