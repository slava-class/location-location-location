import { Console, Effect, Exit, FileSystem } from "effect";
import { join } from "node:path";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  Info,
  readJSON,
} from "../projects.ts";
import type { ResolvedProject } from "../projects.ts";
import { resolveEngine } from "../engine.ts";
import { packageProject } from "../packaging.ts";
import { ModList, prepareProfile } from "../profiles.ts";
import { RunId } from "../logs.ts";
import type { OwnedProcess } from "../process.ts";
import { sourceSeal, verifySourceSeal } from "../source.ts";
import { withFactorioRcon } from "../rcon.ts";
import { evaluate, withEngineSession } from "../engine-session.ts";
import type { EngineSession } from "../engine-session.ts";
import { luaString } from "../lua-string.ts";
import { hashFile } from "../files.ts";
import { SavedGame } from "../engine-session.ts";
import {
  StudioConnection,
  StudioManifest,
  StudioState,
  StudioRequest,
  studioViewport,
  validateDescriptor,
  validateValues,
} from "./contracts.ts";
import { resolveStudio } from "./source.ts";
import type { Studio } from "./source.ts";
import { prepareNativeClient, withNativeClient } from "../native-client.ts";

const companion = "modkit-studio-fixture";
const fault = (boundary: string, message: string) =>
  new BoundaryError({ boundary, message });
type Client = EngineSession["client"];
export interface LiveStudio {
  readonly studio: Studio;
  readonly manifest: typeof StudioManifest.Type;
  readonly engineSession: EngineSession;
  readonly window: OwnedProcess;
}

function verifyState(
  state: typeof StudioState.Type,
  manifest: typeof StudioManifest.Type,
) {
  return Effect.gen(function* () {
    if (
      state.session !== manifest.session ||
      state.mod.name !== manifest.mod.name ||
      state.mod.version !== manifest.mod.version ||
      state.tuner !== manifest.tuner ||
      state.sourceSha256 !== manifest.sourceSha256 ||
      state.configurationSha256 !== manifest.configurationSha256 ||
      state.descriptorSha256 !== manifest.descriptorSha256
    )
      return yield* Effect.fail(
        fault(manifest.session, "Foreign or stale studio response"),
      );
    yield* validateValues(manifest.descriptor, state.values);
    yield* validateValues(manifest.descriptor, state.baseline);
    if (
      Object.keys(state.baseline).some(
        (key) => state.baseline[key] !== manifest.baseline[key],
      )
    )
      return yield* Effect.fail(
        fault(
          manifest.session,
          "Engine baseline differs from the frozen studio",
        ),
      );
    return state;
  });
}

export function readStudioState(
  client: Client,
  manifest: typeof StudioManifest.Type,
) {
  return Effect.gen(function* () {
    return yield* verifyState(
      yield* evaluate(
        client,
        'return remote.call("modkit-studio","get")',
        StudioState,
      ),
      manifest,
    );
  });
}

export function updateStudio(
  client: Client,
  manifest: typeof StudioManifest.Type,
  op: "set" | "reset" | "undo" | "stop" | "discard",
  revision: number,
  values?: unknown,
) {
  return Effect.gen(function* () {
    const checked = yield* decode(
      StudioState.fields.revision,
      revision,
      "expected studio revision",
    );
    const candidate =
      op === "set"
        ? yield* validateValues(manifest.descriptor, values)
        : undefined;
    // Establish session identity before the mutation, including when a local
    // endpoint was reused after an interrupted owner. Never replay on failure.
    yield* readStudioState(client, manifest);
    const argument =
      candidate === undefined
        ? "nil"
        : `helpers.json_to_table(${luaString(JSON.stringify(candidate))})`;
    const applied = yield* verifyState(
      yield* evaluate(
        client,
        `return remote.call("modkit-studio","update",${luaString(op)},${checked},${argument})`,
        StudioState,
      ),
      manifest,
    );
    if (applied.revision !== checked + 1)
      return yield* Effect.fail(
        fault(
          manifest.session,
          "Mutation acknowledgement has an unexpected revision; outcome requires inspection",
        ),
      );
    return applied;
  });
}

export function panelStudio(
  client: Client,
  manifest: typeof StudioManifest.Type,
  action: "open" | "close",
) {
  return Effect.gen(function* () {
    yield* readStudioState(client, manifest);
    return yield* verifyState(
      yield* evaluate(
        client,
        `return remote.call("modkit-studio","panel",${luaString(action)})`,
        StudioState,
      ),
      manifest,
    );
  });
}

export function withStudio<A, E, R>(
  project: ResolvedProject,
  tuner: string,
  options: { readonly engine?: string; readonly deadlineMs: number },
  use: (live: LiveStudio) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const studio = yield* resolveStudio(project, tuner);
    const source = yield* sourceSeal(project);
    const engine = yield* resolveEngine(project, "native", options.engine);
    const artifact = yield* packageProject(project);
    const host = yield* prepareProfile(
      project,
      engine,
      "base",
      "en",
      artifact,
      [],
      "session",
    );
    const metadata = yield* decode(
      Info,
      {
        name: companion,
        version: "0.1.0",
        title: "Private parameter studio",
        author: "local development",
        factorio_version: project.info.factorio_version,
        dependencies: [
          `base >= ${project.info.factorio_version}.0`,
          `${project.info.name} = ${project.info.version}`,
        ],
        description: "Isolated proxy preview; excluded from product packages.",
      },
      "studio companion metadata",
    );
    const directory = join(host.directory, "mods", companion);
    yield* fs.makeDirectory(directory);
    yield* fs.writeFileString(
      join(directory, "info.json"),
      JSON.stringify(metadata),
    );
    yield* fs.copyFile(
      join(project.repoRoot, "tools/tuning/control.lua"),
      join(directory, "control.lua"),
    );
    yield* fs.copyFile(
      join(studio.directory, "adapter.lua"),
      join(directory, "adapter.lua"),
    );
    const request = yield* decode(
      StudioRequest,
      {
        schema: 1,
        session: host.run.runId,
        mod: { name: project.info.name, version: project.info.version },
        descriptor: studio.descriptor,
        baseline: studio.baseline,
        viewport: studioViewport,
        sourceSha256: studio.sourceSha256,
        configurationSha256: studio.configurationSha256,
        descriptorSha256: studio.descriptorSha256,
      },
      "studio engine request",
    );
    yield* fs.writeFileString(
      join(directory, "request.lua"),
      "return " + luaString(JSON.stringify(request)) + "\n",
    );
    const modListPath = join(host.directory, "mods/mod-list.json");
    const modList = yield* readJSON(ModList, modListPath);
    yield* fs.writeFileString(
      modListPath,
      JSON.stringify(
        yield* decode(
          ModList,
          { mods: [...modList.mods, { name: companion, enabled: true }] },
          "studio mod list",
        ),
      ),
    );
    const client = yield* prepareNativeClient(project, host, {
      profile: `studio:${tuner}:client`,
      playerName: "ModkitStudio",
      viewport: studioViewport,
      // Appearance tuning is visual-fidelity work, not a routine behavioral test.
      graphics: "extreme",
    });
    let manifest = yield* decode(
      StudioManifest,
      {
        schema: 1,
        session: host.run.runId,
        clientRun: client.run.runId,
        mod: request.mod,
        tuner,
        directory: host.directory,
        clientDirectory: client.run.directory,
        status: "starting",
        descriptor: studio.descriptor,
        baseline: studio.baseline,
        viewport: request.viewport,
        sourceSha256: source.sha256,
        configurationSha256: studio.configurationSha256,
        descriptorSha256: studio.descriptorSha256,
        artifactSha256: artifact.sha256,
        engine,
      },
      "studio manifest",
    );
    const manifestPath = join(host.directory, "studio.json");
    const connectionPath = join(host.directory, "studio-connection.json");
    const persist = () =>
      Effect.gen(function* () {
        yield* fs.writeFileString(
          manifestPath + ".part",
          JSON.stringify(manifest, null, 2) + "\n",
        );
        yield* fs.rename(manifestPath + ".part", manifestPath);
      });
    yield* persist();
    const operation = withEngineSession(
      host,
      engine,
      {
        purpose: `studio:${tuner}:server`,
        evidence: "studio",
        deadlineMs: options.deadlineMs,
        expectedMods: { ...host.expectedMods, [companion]: metadata.version },
      },
      (engineSession) =>
        Effect.gen(function* () {
          const connection = yield* decode(
            StudioConnection,
            { schema: 1, session: manifest.session, ...engineSession.options },
            "studio connection",
          );
          yield* fs.writeFileString(
            connectionPath,
            JSON.stringify(connection),
            { flag: "wx", mode: 0o600 },
          );
          const result = yield* withNativeClient(
            client,
            engineSession,
            { evidence: "studio", deadlineMs: options.deadlineMs },
            ({ window }) =>
              Effect.gen(function* () {
                yield* window.waitForText(
                  new RegExp(`MODKIT_STUDIO_READY:${manifest.session}`),
                  "studio scene ready",
                  15000,
                );
                const state = yield* readStudioState(
                  engineSession.client,
                  manifest,
                );
                if (!state.ready)
                  return yield* Effect.fail(
                    fault(
                      manifest.session,
                      "Scene readiness marker disagrees with engine state",
                    ),
                  );
                manifest = { ...manifest, status: "ready" };
                yield* persist();
                yield* Console.log(
                  JSON.stringify({
                    status: "ready",
                    mod: project.info.name,
                    tuner,
                    session: manifest.session,
                    clientRun: manifest.clientRun,
                    revision: state.revision,
                    inspect: [
                      process.execPath,
                      join(project.repoRoot, "tools/cli.ts"),
                      "studio",
                      "inspect",
                      project.info.name,
                      manifest.session,
                    ],
                  }),
                );
                const value = yield* use({
                  studio,
                  manifest,
                  engineSession,
                  window,
                });
                return value;
              }),
          );
          yield* engineSession.process.stop;
          yield* verifySourceSeal(source, yield* sourceSeal(project));
          return result;
        }),
    );
    return yield* operation.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          manifest = {
            ...manifest,
            status: Exit.isSuccess(exit) ? "stopped" : "failed",
          };
          yield* persist();
          if (yield* fs.exists(connectionPath)) {
            const owner = yield* readJSON(StudioConnection, connectionPath);
            if (owner.session !== manifest.session)
              return yield* Effect.fail(
                fault(manifest.session, "Studio credential ownership changed"),
              );
            yield* fs.remove(connectionPath);
          }
        }).pipe(Effect.orDie),
      ),
    );
  });
}

/**
 * Fresh-process serialization proof for a product-owned studio verifier.
 * @public
 */
export function withStudioReload<A, E, R>(
  live: LiveStudio,
  save: typeof SavedGame.Type,
  use: (session: EngineSession) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { project } = live.studio;
    const prior = live.engineSession.profile;
    yield* decode(SavedGame, save, "studio save reload");
    yield* assertCanonicalPath(save.archive);
    if ((yield* hashFile(save.archive)) !== save.sha256)
      return yield* Effect.fail(
        fault(save.archive, "Saved bytes changed before reload"),
      );
    const profile = yield* prepareProfile(
      project,
      prior.engine,
      "base",
      "en",
      {
        archive: join(
          prior.directory,
          "mods",
          `${project.info.name}_${project.info.version}.zip`,
        ),
        sha256: live.manifest.artifactSha256,
      },
      [],
      "session",
    );
    const fixture = join(prior.directory, "mods", companion);
    const metadata = yield* readJSON(Info, join(fixture, "info.json"));
    if (metadata.name !== companion)
      return yield* Effect.fail(
        fault(fixture, "Wrong studio companion identity"),
      );
    yield* fs.copy(fixture, join(profile.directory, "mods", companion));
    const modListPath = join(profile.directory, "mods/mod-list.json");
    const modList = yield* readJSON(ModList, modListPath);
    yield* fs.writeFileString(
      modListPath,
      JSON.stringify(
        yield* decode(
          ModList,
          {
            mods: [...modList.mods, { name: companion, enabled: true }],
          },
          "reloaded studio mod list",
        ),
      ),
    );
    yield* fs.copyFile(save.archive, join(profile.directory, "input.zip"));
    if ((yield* hashFile(join(profile.directory, "input.zip"))) !== save.sha256)
      return yield* Effect.fail(fault(save.archive, "Staged save differs"));
    return yield* withEngineSession(
      profile,
      prior.engine,
      {
        purpose: `studio:${live.studio.id}:disk-reload`,
        evidence: "studio",
        deadlineMs: 30000,
        expectedMods: {
          ...profile.expectedMods,
          [companion]: metadata.version,
        },
      },
      (session) =>
        Effect.gen(function* () {
          const result = yield* use(session);
          yield* session.process.stop;
          return { run: profile.run.runId, result };
        }),
    );
  });
}

export function readStudioManifest(project: ResolvedProject, input: string) {
  return Effect.gen(function* () {
    const session = yield* decode(RunId, input, "studio session");
    const directory = join(project.outputRoot, "runs", session);
    yield* assertCanonicalPath(directory);
    const manifest = yield* readJSON(
      StudioManifest,
      join(directory, "studio.json"),
    );
    if (
      manifest.session !== session ||
      manifest.mod.name !== project.info.name ||
      manifest.directory !== directory ||
      manifest.clientDirectory !==
        join(project.outputRoot, "runs", manifest.clientRun)
    )
      return yield* Effect.fail(
        fault(session, "Studio manifest has foreign identity or paths"),
      );
    yield* validateDescriptor(manifest.descriptor);
    yield* validateValues(manifest.descriptor, manifest.baseline);
    return manifest;
  });
}

export function withLiveStudio<A, E, R>(
  project: ResolvedProject,
  session: string,
  use: (
    client: Client,
    manifest: typeof StudioManifest.Type,
  ) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const manifest = yield* readStudioManifest(project, session);
    if (manifest.status !== "ready")
      return yield* Effect.fail(
        fault(session, `Studio is ${manifest.status}, not ready`),
      );
    const path = join(manifest.directory, "studio-connection.json");
    yield* assertCanonicalPath(path);
    const connection = yield* readJSON(StudioConnection, path);
    if (connection.session !== manifest.session)
      return yield* Effect.fail(fault(session, "Foreign studio connection"));
    const { schema: _schema, session: _session, ...options } = connection;
    return yield* withFactorioRcon(options, (client) =>
      Effect.gen(function* () {
        yield* readStudioState(client, manifest);
        return yield* use(client, manifest);
      }),
    );
  });
}
