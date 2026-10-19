import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { join, resolve } from "node:path";
import {
  BoundaryError,
  decode,
  readJSON,
  resolveProject,
  TunerId,
} from "../projects.ts";
import { Preset, Revision, StudioState } from "./contracts.ts";
import {
  makePreset,
  promotePreset,
  resolveStudio,
  validatePreset,
} from "./source.ts";
import {
  panelStudio,
  readStudioManifest,
  readStudioState,
  updateStudio,
  withLiveStudio,
  withStudio,
} from "./session.ts";
import { captureStudio } from "./capture.ts";
import { verifyStudio } from "./verification.ts";

export function studioCommand(root: string) {
  const selector = {
    mod: Argument.String("mod"),
    session: Argument.String("session"),
  };
  const revision = Flag.Int("revision").pipe(
    Flag.withSchema(Schema.Number.pipe(Schema.decodeTo(Revision))),
  );
  const print = (value: unknown) => Console.log(JSON.stringify(value, null, 2));
  const launch = Command.make(
    "launch",
    {
      mod: Argument.String("mod"),
      tuner: Argument.String("tuner"),
      engine: Flag.String("engine").pipe(Flag.optional),
      minutes: Flag.Int("minutes").pipe(
        Flag.withSchema(
          Schema.Number.pipe(
            Schema.decodeTo(
              Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
            ),
          ),
        ),
        Flag.withDefault(60),
      ),
    },
    ({ mod, tuner, engine, minutes }) =>
      Effect.gen(function* () {
        const project = yield* resolveProject(root, mod, process.cwd());
        const executable = Option.getOrUndefined(engine);
        yield* withStudio(
          project,
          tuner,
          {
            deadlineMs: minutes * 60000,
            ...(executable === undefined ? {} : { engine: executable }),
          },
          (live) =>
            Effect.gen(function* () {
              while (true) {
                const state = yield* readStudioState(
                  live.engineSession.client,
                  live.manifest,
                );
                if (state.discardRequested) return;
                yield* Effect.sleep(500);
              }
            }),
        );
      }),
  );
  const inspect = Command.make("inspect", selector, ({ mod, session }) =>
    Effect.gen(function* () {
      const project = yield* resolveProject(root, mod, process.cwd());
      const manifest = yield* readStudioManifest(project, session);
      if (manifest.status === "ready") {
        yield* print(
          yield* withLiveStudio(project, session, (client, current) =>
            readStudioState(client, current),
          ),
        );
      } else {
        const fs = yield* FileSystem.FileSystem;
        const path = join(
          manifest.directory,
          "script-output/modkit-studio/state.json",
        );
        yield* print({
          manifest,
          freshness: "last-recorded",
          state: (yield* fs.exists(path))
            ? yield* readJSON(StudioState, path)
            : null,
        });
      }
    }),
  );
  const set = Command.make(
    "set",
    { ...selector, revision, preset: Flag.String("preset") },
    ({ mod, session, revision, preset }) =>
      Effect.gen(function* () {
        const project = yield* resolveProject(root, mod, process.cwd());
        yield* print(
          yield* withLiveStudio(project, session, (client, manifest) =>
            Effect.gen(function* () {
              const studio = yield* resolveStudio(project, manifest.tuner);
              const value = yield* validatePreset(
                studio,
                yield* readJSON(Preset, resolve(preset)),
                "preview",
              );
              if (studio.sourceSha256 !== manifest.sourceSha256)
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: session,
                    message: "Studio source changed; preset was not applied",
                  }),
                );
              return yield* updateStudio(
                client,
                manifest,
                "set",
                revision,
                value.values,
              );
            }),
          ),
        );
      }),
  );
  const mutate = (name: "reset" | "undo" | "stop-preview" | "discard") =>
    Command.make(
      name,
      { ...selector, revision },
      ({ mod, session, revision }) =>
        Effect.gen(function* () {
          const project = yield* resolveProject(root, mod, process.cwd());
          yield* print(
            yield* withLiveStudio(project, session, (client, manifest) =>
              updateStudio(
                client,
                manifest,
                name === "stop-preview" ? "stop" : name,
                revision,
              ),
            ),
          );
        }),
    );
  const panel = Command.make(
    "panel",
    {
      ...selector,
      state: Flag.String("state").pipe(
        Flag.withSchema(
          Schema.String.pipe(
            Schema.decodeTo(Schema.Literals(["open", "close"])),
          ),
        ),
      ),
    },
    ({ mod, session, state }) =>
      Effect.gen(function* () {
        const project = yield* resolveProject(root, mod, process.cwd());
        yield* print(
          yield* withLiveStudio(project, session, (client, manifest) =>
            panelStudio(client, manifest, state),
          ),
        );
      }),
  );
  const capture = Command.make("capture", selector, ({ mod, session }) =>
    Effect.gen(function* () {
      const project = yield* resolveProject(root, mod, process.cwd());
      yield* print(yield* withLiveStudio(project, session, captureStudio));
    }),
  );
  const exportPreset = Command.make(
    "export",
    {
      ...selector,
      name: Argument.String("name"),
      scope: Flag.String("scope").pipe(
        Flag.withSchema(
          Schema.String.pipe(Schema.decodeTo(Preset.fields.scope)),
        ),
        Flag.withDefault("preview"),
      ),
    },
    ({ mod, session, name, scope }) =>
      Effect.gen(function* () {
        const project = yield* resolveProject(root, mod, process.cwd());
        const label = yield* decode(TunerId, name, "preset name");
        yield* print(
          yield* withLiveStudio(project, session, (client, manifest) =>
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const studio = yield* resolveStudio(project, manifest.tuner);
              if (studio.sourceSha256 !== manifest.sourceSha256)
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: session,
                    message:
                      "Studio source changed; source-backed export is stale",
                  }),
                );
              const state = yield* readStudioState(client, manifest);
              const preset = yield* makePreset(
                studio,
                session,
                state.revision,
                state.values,
                scope,
              );
              const directory = join(
                manifest.directory,
                "script-output/modkit-studio/presets",
              );
              yield* fs.makeDirectory(directory, { recursive: true });
              const path = join(directory, label + ".json");
              yield* fs.writeFileString(
                path,
                JSON.stringify(preset, null, 2) + "\n",
                { flag: "wx" },
              );
              return { path, preset };
            }),
          ),
        );
      }),
  );
  const promote = Command.make(
    "promote",
    {
      mod: Argument.String("mod"),
      tuner: Argument.String("tuner"),
      preset: Argument.String("preset"),
      apply: Flag.Boolean("apply"),
    },
    ({ mod, tuner, preset, apply }) =>
      Effect.gen(function* () {
        const project = yield* resolveProject(root, mod, process.cwd());
        yield* print(
          yield* promotePreset(project, tuner, resolve(preset), apply),
        );
      }),
  );
  const verify = Command.make(
    "verify",
    {
      mod: Argument.String("mod"),
      tuner: Argument.String("tuner"),
      engine: Flag.String("engine").pipe(Flag.optional),
    },
    ({ mod, tuner, engine }) =>
      Effect.gen(function* () {
        const project = yield* resolveProject(root, mod, process.cwd());
        yield* print(
          yield* verifyStudio(project, tuner, Option.getOrUndefined(engine)),
        );
      }),
  );
  return Command.make("studio").pipe(
    Command.withSubcommands([
      launch,
      verify,
      inspect,
      set,
      mutate("reset"),
      mutate("undo"),
      mutate("stop-preview"),
      mutate("discard"),
      panel,
      capture,
      exportPreset,
      promote,
    ]),
  );
}
