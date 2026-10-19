import { Effect, FileSystem, Schema } from "effect";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createSocket } from "node:dgram";
import { join } from "node:path";
import {
  BoundaryError,
  decode,
  decodeJSON,
  ModId,
  TunerId,
} from "./projects.ts";
import type { ResolvedEngine } from "./engine.ts";
import { Observation, verifyActiveMods } from "./profiles.ts";
import type { prepareProfile } from "./profiles.ts";
import { withProcess } from "./process.ts";
import type { OwnedProcess } from "./process.ts";
import { RconOptions, withFactorioRcon } from "./rcon.ts";
import { luaString } from "./lua-string.ts";
import { readLogCursor, readLogPage } from "./logs.ts";
import { hashFile } from "./files.ts";
import { AbsolutePath, Sha256 } from "./contracts.ts";
import type { EngineRunKind } from "./runs.ts";

export const SavedGame = Schema.Struct({
  archive: AbsolutePath,
  sha256: Sha256,
  afterSequence: Schema.Int,
  startedSequence: Schema.Int,
  completedSequence: Schema.Int,
});

type Profile = Effect.Success<ReturnType<typeof prepareProfile>>;
type Client = Parameters<Parameters<typeof withFactorioRcon>[1]>[0];
export interface EngineSession {
  readonly process: OwnedProcess;
  readonly client: Client;
  readonly options: typeof RconOptions.Type;
  readonly gamePort: number;
  readonly profile: Profile;
}
const fault = (boundary: string, message: string) =>
  new BoundaryError({ boundary, message });

function privatePort(protocol: "tcp" | "udp") {
  return Effect.tryPromise({
    try: () =>
      new Promise<number>((resolve, reject) => {
        if (protocol === "tcp") {
          const server = createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const port = (server.address() as AddressInfo).port;
            server.close((error) => (error ? reject(error) : resolve(port)));
          });
        } else {
          const socket = createSocket("udp4");
          socket.once("error", (error) => {
            socket.close();
            reject(error);
          });
          socket.bind(0, "127.0.0.1", () => {
            const port = socket.address().port;
            socket.close(() => resolve(port));
          });
        }
      }),
    catch: () =>
      fault("loopback allocation", "Cannot reserve an unused local port"),
  });
}

/** Bind failures fail the run. Port selection never retries engine launch. */
export function withEngineSession<A, E, R>(
  profile: Profile,
  engine: ResolvedEngine,
  options: {
    readonly purpose: string;
    readonly evidence: typeof EngineRunKind.Type;
    readonly deadlineMs: number;
    readonly expectedMods: Readonly<Record<string, string>>;
  },
  use: (session: EngineSession) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (engine.docker !== undefined)
      return yield* Effect.fail(
        fault(
          "engine session",
          "Private RCON orchestration must run alongside the native engine in the same network namespace",
        ),
      );
    const tcpPort = yield* privatePort("tcp");
    const gamePort = yield* privatePort("udp");
    const rcon = yield* decode(
      RconOptions,
      {
        host: "127.0.0.1",
        port: tcpPort,
        password: crypto.randomUUID(),
        timeoutMs: 5000,
      },
      "engine session RCON",
    );
    // Raw Factorio logs include launch arguments. Restrict the entire owned
    // profile as well as redacting the public journal and process readbacks.
    yield* fs.chmod(profile.directory, 0o700);
    const settings = join(profile.directory, "server-settings.json");
    yield* fs.writeFileString(
      settings,
      JSON.stringify({
        name: "Private modkit session",
        description: "Owned loopback-only verification",
        visibility: { public: false, lan: false },
        require_user_verification: false,
        auto_pause: false,
        autosave_interval: 0,
      }),
    );
    return yield* withProcess(
      {
        ...profile.run,
        profile: options.purpose,
        evidence: options.evidence,
        deadlineMs: options.deadlineMs,
        redact: [rcon.password],
        gameLog: {
          current: join(profile.directory, "factorio-current.log"),
          previous: join(profile.directory, "factorio-previous.log"),
        },
        command: [
          engine.executable,
          "--config",
          join(profile.directory, "config.ini"),
          "--mod-directory",
          join(profile.directory, "mods"),
          "--start-server",
          join(profile.directory, "input.zip"),
          "--server-settings",
          settings,
          "--bind",
          `127.0.0.1:${gamePort}`,
          "--rcon-bind",
          `127.0.0.1:${tcpPort}`,
          "--rcon-password",
          rcon.password,
        ],
      },
      (process) =>
        Effect.gen(function* () {
          yield* process.waitForText(
            new RegExp(
              `Starting RCON interface at.*127\\.0\\.0\\.1:${tcpPort}`,
            ),
            "private RCON readiness",
            30000,
          );
          yield* process.waitForText(
            new RegExp(`Hosting game at.*127\\.0\\.0\\.1:${gamePort}`),
            "private game binding",
            1000,
          );
          return yield* withFactorioRcon(rcon, (client) =>
            Effect.gen(function* () {
              const activeMods = yield* evaluate(
                client,
                "local mods={}; for name,version in pairs(script.active_mods) do mods[name]=version end; return mods",
                Observation.fields.activeMods,
              );
              yield* verifyActiveMods(
                activeMods,
                options.expectedMods,
                profile.run.runId,
              );
              return yield* use({
                process,
                client,
                options: rcon,
                gamePort,
                profile,
              });
            }),
          );
        }),
    );
  });
}

/** Internal Lua source only; externally supplied values must use luaString. */
export function evaluate<S extends Schema.ConstraintDecoder<unknown>>(
  client: Client,
  expression: string,
  schema: S,
  scope?: string,
) {
  return Effect.gen(function* () {
    const prefix =
      scope === undefined
        ? ""
        : `__${yield* decode(ModId, scope, "console mod scope")}__ `;
    const raw = yield* client.execute(
      `/sc ${prefix}local ok,value=pcall(function() ${expression} end); if ok then rcon.print(helpers.table_to_json({schema=1,ok=true,value=value})) else rcon.print(helpers.table_to_json({schema=1,ok=false,error=tostring(value)})) end`,
    );
    const envelope = yield* decodeJSON(
      Schema.Union([
        Schema.Struct({
          schema: Schema.Literal(1),
          ok: Schema.Literal(true),
          value: Schema.Unknown,
        }),
        Schema.Struct({
          schema: Schema.Literal(1),
          ok: Schema.Literal(false),
          error: Schema.String,
        }),
      ]),
      Buffer.from(raw),
      "engine command response",
    );
    if (!envelope.ok)
      return yield* Effect.fail(fault("engine command", envelope.error));
    return yield* decode(schema, envelope.value, "engine command value");
  });
}

/**
 * Product-verifier save boundary: correlated completion, not an RCON reply.
 * @public
 */
export function saveEngineSession(session: EngineSession, input: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const name = yield* decode(TunerId, input, "owned save name");
    yield* fs.makeDirectory(join(session.profile.directory, "saves"), {
      recursive: true,
    });
    const archive = join(session.profile.directory, "saves", name + ".zip");
    if (yield* fs.exists(archive))
      return yield* Effect.fail(
        fault(name, "Owned save already exists; no overwrite was attempted"),
      );
    let cursor = yield* readLogCursor(
      session.process.logs,
      session.profile.run.runId,
    );
    const afterSequence = cursor.sequence;
    yield* evaluate(
      session.client,
      `game.server_save(${luaString(name)}); return {accepted=true}`,
      Schema.Struct({ accepted: Schema.Literal(true) }),
    );
    yield* session.process.phase("save-completion");
    const deadline = performance.now() + 30000;
    let pending = "",
      startedSequence: number | undefined;
    while (performance.now() < deadline) {
      const page = yield* readLogPage(session.process.logs, cursor);
      cursor = page.cursor;
      for (const event of page.records) {
        if (event.channel !== "game") continue;
        pending += event.text;
        let newline: number;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line.includes("Saving game as ")) {
            if (
              startedSequence !== undefined ||
              !new RegExp(`/${name}(?:\\.zip)?\\r?$`).test(line)
            )
              return yield* Effect.fail(
                fault(
                  name,
                  "Unexpected or overlapping save; completion is not attributable",
                ),
              );
            startedSequence = event.sequence;
          }
          if (
            line.includes("Saving finished") &&
            startedSequence !== undefined
          ) {
            const stat = yield* fs.stat(archive);
            if (stat.type !== "File" || stat.size === 0n)
              return yield* Effect.fail(
                fault(name, "Completed save is not a nonempty regular archive"),
              );
            return yield* decode(
              SavedGame,
              {
                archive,
                sha256: yield* hashFile(archive),
                afterSequence,
                startedSequence,
                completedSequence: event.sequence,
              },
              "completed owned save",
            );
          }
        }
        if (pending.length > 16384)
          return yield* Effect.fail(
            fault(name, "Save completion log line exceeded its bound"),
          );
      }
      if (page.complete)
        return yield* Effect.fail(
          fault(name, "Engine ended before save completion"),
        );
      yield* Effect.sleep(50);
    }
    return yield* Effect.fail(
      fault(
        name,
        "Save completion deadline exceeded; mutation was not retried",
      ),
    );
  });
}
