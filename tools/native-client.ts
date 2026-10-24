import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { BoundaryError, decode, Locale, RelativePath } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { EngineRunKind, newRun } from "./runs.ts";
import { RunId } from "./logs.ts";
import { Sha256 } from "./contracts.ts";
import { inventoryFiles } from "./files.ts";
import { evaluate } from "./engine-session.ts";
import type { EngineSession } from "./engine-session.ts";
import { withProcess } from "./process.ts";
import type { OwnedProcess } from "./process.ts";
import { verifyEngineDiagnostics } from "./engine-diagnostics.ts";
import { luaString } from "./lua-string.ts";
import { GraphicsPreset, resolveGraphicsPreset } from "./engine.ts";

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const PlayerName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,47}$(?![\s\S])/u),
);
const NativeViewport = Schema.Struct({
  width: PositiveInt,
  height: PositiveInt,
  scale: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  locale: Locale,
});
const Preparation = Schema.Struct({
  profile: Schema.NonEmptyString,
  playerName: PlayerName,
  viewport: NativeViewport,
  graphics: Schema.optionalKey(GraphicsPreset),
});
const Execution = Schema.Struct({
  evidence: EngineRunKind,
  deadlineMs: PositiveInt,
});
const ConnectedPlayer = Schema.Struct({
  ready: Schema.Literal(true),
  index: PositiveInt,
  name: PlayerName,
  viewport: NativeViewport,
});
const PlayerReadiness = Schema.Union([
  Schema.Struct({ ready: Schema.Literal(false) }),
  ConnectedPlayer,
]);
/** Product-owned verifiers persist this shared native-client proof. @public */
export const NativeClientEvidence = Schema.Struct({
  schema: Schema.Literal(1),
  kind: Schema.Literal("connected-native-client"),
  serverRun: RunId,
  clientRun: RunId,
  engineSha256: Sha256,
  graphics: GraphicsPreset,
  requested: NativeViewport,
  observed: NativeViewport,
  player: Schema.Struct({ index: PositiveInt, name: PlayerName }),
  inputs: Schema.Record(RelativePath, Sha256),
});
const fault = (boundary: string, message: string) =>
  new BoundaryError({ boundary, message });

/** Allocate an owned client identity before the server starts; copy its live profile only after readiness. */
export function prepareNativeClient(
  project: ResolvedProject,
  host: EngineSession["profile"],
  options: typeof Preparation.Type,
) {
  return Effect.gen(function* () {
    const selected = yield* decode(
      Preparation,
      options,
      "native client request",
    );
    const graphics = yield* resolveGraphicsPreset("test", selected.graphics);
    if (host.engine.docker !== undefined || host.engine.distribution !== "full")
      return yield* Effect.fail(
        fault("native client", "A standalone native full client is required"),
      );
    if (
      host.run.repository !== project.repoRoot ||
      host.run.modId !== project.info.name
    )
      return yield* Effect.fail(
        fault(
          "native client",
          "Host profile belongs to a different project or checkout",
        ),
      );
    const fs = yield* FileSystem.FileSystem;
    const run = yield* newRun(project, selected.profile);
    yield* fs.chmod(run.directory, 0o700);
    yield* fs.writeFileString(
      join(run.directory, "config.ini"),
      `[path]\nread-data=${host.engine.readData}\nwrite-data=${run.directory}\n[general]\nlocale=${selected.viewport.locale}\n[graphics]\nfull-screen=false\n[interface]\nautomatic-ui-scale=false\ncustom-ui-scale=${selected.viewport.scale}\nshow-tips-and-tricks=false\n[sound]\nmaster-muted=true\n[other]\ncheck-updates=false\nenable-crash-log-uploading=false\nautosave-interval=0\n`,
    );
    yield* fs.writeFileString(
      join(run.directory, "player-data.json"),
      JSON.stringify({
        "service-username": selected.playerName,
        "service-token": "",
      }),
    );
    return {
      run,
      engine: host.engine,
      hostRun: host.run.runId,
      hostDirectory: host.directory,
      mod: project.info,
      ...selected,
      graphics,
    };
  });
}
export type NativeClientProfile = Effect.Success<
  ReturnType<typeof prepareNativeClient>
>;
export interface LiveNativeClient {
  readonly profile: NativeClientProfile;
  readonly window: OwnedProcess;
  readonly evidence: typeof NativeClientEvidence.Type;
}

/** One launch, one named real player, qualified viewport, and explicit owned shutdown. */
export function withNativeClient<A, E, R>(
  profile: NativeClientProfile,
  host: EngineSession,
  options: typeof Execution.Type,
  use: (client: LiveNativeClient) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const execution = yield* decode(
      Execution,
      options,
      "native client execution",
    );
    if (
      profile.hostRun !== host.profile.run.runId ||
      profile.hostDirectory !== host.profile.directory
    )
      return yield* Effect.fail(
        fault(
          profile.run.runId,
          "Prepared client belongs to another host session",
        ),
      );
    const name = luaString(profile.playerName);
    if (
      yield* evaluate(
        host.client,
        `local p=game.get_player(${name}); return p~=nil and p.connected`,
        Schema.Boolean,
      )
    )
      return yield* Effect.fail(
        fault(
          profile.playerName,
          "A player with this client identity is already connected",
        ),
      );
    const fs = yield* FileSystem.FileSystem;
    const source = yield* inventoryFiles(profile.hostDirectory, ["mods"]);
    yield* fs.copy(
      join(profile.hostDirectory, "mods"),
      join(profile.run.directory, "mods"),
      { overwrite: false },
    );
    if (
      !isDeepStrictEqual(
        source,
        yield* inventoryFiles(profile.run.directory, ["mods"]),
      ) ||
      !isDeepStrictEqual(
        source,
        yield* inventoryFiles(profile.hostDirectory, ["mods"]),
      )
    )
      return yield* Effect.fail(
        fault(
          profile.run.runId,
          "Native client mod inputs differ or changed during staging",
        ),
      );
    const inputs = yield* inventoryFiles(profile.run.directory, [
      "mods",
      "config.ini",
      "player-data.json",
    ]);
    const result = yield* withProcess(
      {
        ...profile.run,
        evidence: execution.evidence,
        deadlineMs: execution.deadlineMs,
        // Large mod sets need time to disconnect and dispose of the native scenario.
        shutdownMs: 60000,
        gameLog: {
          current: join(profile.run.directory, "factorio-current.log"),
          previous: join(profile.run.directory, "factorio-previous.log"),
        },
        command: [
          profile.engine.executable,
          "--config",
          join(profile.run.directory, "config.ini"),
          "--mod-directory",
          join(profile.run.directory, "mods"),
          "--mp-connect",
          `127.0.0.1:${host.gamePort}`,
          "--disable-audio",
          "--disable-migration-window",
          "--window-size",
          `${profile.viewport.width}x${profile.viewport.height}`,
          "--force-graphics-preset",
          profile.graphics,
        ],
      },
      (window) =>
        Effect.gen(function* () {
          yield* window.waitForText(
            /Factorio initialised/,
            "native renderer startup",
            execution.deadlineMs,
          );
          yield* window.waitForText(
            /changing state from\([^)]+\) to\(InGame\)/,
            "native graphical client joined",
            execution.deadlineMs,
          );
          yield* window.phase("native player viewport readiness");
          // Joining can initially expose saved/default display values; wait for the
          // native display and locale events, without relaxing the requested values.
          const deadline = performance.now() + 10000;
          let observed: typeof ConnectedPlayer.Type | undefined;
          let lastObserved: typeof ConnectedPlayer.Type | undefined;
          while (performance.now() < deadline) {
            const state = yield* evaluate(
              host.client,
              `local p=game.get_player(${name}); if not p or not p.connected or p.display_resolution.width==0 or p.display_resolution.height==0 then return {ready=false} end; return {ready=true,index=p.index,name=p.name,viewport={width=p.display_resolution.width,height=p.display_resolution.height,scale=p.display_scale,locale=p.locale}}`,
              PlayerReadiness,
            );
            if (state.ready) {
              lastObserved = state;
              if (
                state.name === profile.playerName &&
                isDeepStrictEqual(state.viewport, profile.viewport)
              ) {
                observed = state;
                break;
              }
            }
            yield* Effect.sleep(50);
          }
          if (!observed)
            return yield* Effect.fail(
              fault(
                profile.run.runId,
                `Native viewport did not synchronize before the deadline: ${JSON.stringify(lastObserved ?? null)}`,
              ),
            );
          const log = yield* fs.readFileString(
            join(profile.run.directory, "factorio-current.log"),
          );
          if (
            !log.includes(
              `Forced graphics settings preset: ${profile.graphics}`,
            ) ||
            !log.includes(
              `Window: ${profile.viewport.width}x${profile.viewport.height}, Drawable: ${profile.viewport.width}x${profile.viewport.height}`,
            )
          )
            return yield* Effect.fail(
              fault(
                profile.run.runId,
                `Native window or ${profile.graphics} graphics proof is absent`,
              ),
            );
          const evidence = yield* decode(
            NativeClientEvidence,
            {
              schema: 1,
              kind: "connected-native-client",
              serverRun: profile.hostRun,
              clientRun: profile.run.runId,
              engineSha256: profile.engine.sha256,
              graphics: profile.graphics,
              requested: profile.viewport,
              observed: observed.viewport,
              player: { index: observed.index, name: observed.name },
              inputs,
            },
            "native client evidence",
          );
          yield* fs.writeFileString(
            join(profile.run.directory, "native-client.json"),
            JSON.stringify(evidence, null, 2) + "\n",
            { flag: "wx" },
          );
          const value = yield* use({ profile, window, evidence }).pipe(
            Effect.raceFirst(
              window.waitForExit.pipe(
                Effect.flatMap(() =>
                  Effect.fail(
                    fault(
                      profile.run.runId,
                      "Graphical client exited before its workflow completed",
                    ),
                  ),
                ),
              ),
            ),
          );
          yield* window.stop;
          return value;
        }),
    );
    yield* verifyEngineDiagnostics(
      yield* fs.readFileString(
        join(profile.run.directory, "factorio-current.log"),
      ),
      "clean",
      profile.mod,
    );
    return result;
  });
}
