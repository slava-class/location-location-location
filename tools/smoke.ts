import { Cause, Effect, Exit, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { AbsolutePath, ElapsedMs, PackageResult, Sha256 } from "./contracts.ts";
import type { Packaged } from "./contracts.ts";
import { readCommandOutput } from "./commands.ts";
import { Engine, resolveEngine } from "./engine.ts";
import { hashFile } from "./files.ts";
import { verifyEngineDiagnostics } from "./engine-diagnostics.ts";
import { packageProject } from "./packaging.ts";
import { withProcess } from "./process.ts";
import {
  Observation,
  ObservationRequest,
  prepareProfile,
  verifyObservation,
} from "./profiles.ts";
import { BoundaryError, decode, ModId, readJSON, Version } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { sourceSeal, SourceSeal, verifySourceSeal } from "./source.ts";
import type { Backend } from "./backend.ts";

const SmokeIdentity = Schema.Struct({
  request: ObservationRequest,
  engine: Engine,
  source: SourceSeal,
  artifact: PackageResult,
  directory: AbsolutePath,
  seedSha256: Sha256,
  fixtureSha256: Sha256,
  startedAt: Schema.NonEmptyString,
});
export const SmokeRequest = Schema.Struct({
  ...SmokeIdentity.fields,
  expectedMods: Schema.Record(ModId, Version),
  updates: Schema.Literal(60),
});
export const SmokeResult = Schema.Struct({
  ...SmokeIdentity.fields,
  status: Schema.Literal("passed"),
  elapsedMs: ElapsedMs,
  observed: Observation,
  updates: Schema.Literal(60),
});
const SmokeFailure = Schema.Struct({
  ...SmokeIdentity.fields,
  status: Schema.Literals(["failed", "cancelled"]),
  elapsedMs: ElapsedMs,
  error: Schema.String,
});
export const SmokeState = Schema.Union([SmokeResult, SmokeFailure]);

export function smokePackage(
  project: ResolvedProject,
  options: {
    artifact?: Packaged;
    engine?: string;
    backend?: typeof Backend.Type;
  } = {},
) {
  return Effect.gen(function* () {
    if (project.capabilities.verification !== "engine")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Project declares offline-only verification; package engine smoke is unavailable",
        }),
      );
    const fs = yield* FileSystem.FileSystem,
      source = yield* sourceSeal(project),
      engine = yield* resolveEngine(
        project,
        "headless",
        options.engine,
        options.backend,
      );
    const artifact = options.artifact ?? (yield* packageProject(project)),
      results: (typeof SmokeResult.Type)[] = [];
    for (const profile of project.capabilities.profiles) {
      // Test companions are deliberately absent: prove the independently installable product.
      const context = yield* prepareProfile(
        project,
        engine,
        profile,
        "en",
        artifact,
        [],
        "package-smoke",
      );
      const { run, directory, request } = context,
        startedAt = new Date().toISOString(),
        start = performance.now();
      const identity = {
        request,
        engine,
        source,
        artifact,
        directory,
        seedSha256: context.seedSha256,
        fixtureSha256: yield* hashFile(
          join(context.observerDirectory, "control.lua"),
        ),
        startedAt,
      };
      const input = yield* decode(
        SmokeRequest,
        { ...identity, expectedMods: context.expectedMods, updates: 60 },
        "package smoke request",
      );
      yield* fs.writeFileString(
        join(directory, "smoke-request.json"),
        JSON.stringify(input, null, 2) + "\n",
      );
      const operation = Effect.gen(function* () {
        const gameLog = join(directory, "factorio-current.log");
        yield* withProcess(
          {
            ...run,
            evidence: "package-smoke",
            ...(engine.docker === undefined ? {} : { docker: engine.docker }),
            command: [
              engine.executable,
              "--benchmark",
              join(directory, "input.zip"),
              "--benchmark-ticks",
              "60",
              "--benchmark-runs",
              "1",
              "--mod-directory",
              join(directory, "mods"),
              "--config",
              join(directory, "config.ini"),
            ],
            gameLog: {
              current: gameLog,
              previous: join(directory, "factorio-previous.log"),
            },
            deadlineMs: 120000,
          },
          (child) => child.waitForExit,
        );
        const output = yield* readCommandOutput(directory, run.runId);
        const completions = [
          ...output.stdout.matchAll(
            /^[ \t]*Performed ([0-9]+) updates in [0-9]+(?:\.[0-9]+)? ms\r?$/gm,
          ),
        ];
        if (completions.length !== 1 || completions[0]![1] !== "60")
          return yield* Effect.fail(
            new BoundaryError({
              boundary: run.runId,
              message:
                "Package engine did not report exactly one completed 60-update benchmark",
            }),
          );
        if (Number((yield* fs.stat(gameLog)).size) > 32 * 1024 * 1024)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: run.runId,
              message: "Engine log exceeds the bounded diagnostic parser limit",
            }),
          );
        yield* verifyEngineDiagnostics(
          yield* fs.readFileString(gameLog),
          "clean",
          project.info,
        );
        const observed = yield* readJSON(
          Observation,
          join(directory, "script-output", "modkit-observed-mods.json"),
        );
        yield* verifyObservation(observed, request, context.expectedMods);
        if (observed.activeMods["factorio-test"] !== undefined)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: run.runId,
              message: "Package smoke unexpectedly enabled FactorioTest",
            }),
          );
        if (
          (yield* hashFile(artifact.archive)) !== artifact.sha256 ||
          (yield* hashFile(context.seedSource)) !== context.seedSha256
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: run.runId,
              message: "Package or shared seed changed during smoke",
            }),
          );
        yield* verifySourceSeal(source, yield* sourceSeal(project));
        const result = yield* decode(
          SmokeResult,
          {
            ...identity,
            status: "passed",
            elapsedMs: performance.now() - start,
            observed,
            updates: 60,
          },
          "package smoke result",
        );
        yield* fs.writeFileString(
          join(directory, "smoke.json.part"),
          JSON.stringify(result, null, 2) + "\n",
        );
        yield* fs.rename(
          join(directory, "smoke.json.part"),
          join(directory, "smoke.json"),
        );
        return result;
      });
      results.push(
        yield* operation.pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              if (Exit.isSuccess(exit)) return;
              const failure = yield* decode(
                SmokeFailure,
                {
                  ...identity,
                  status: Cause.hasInterrupts(exit.cause)
                    ? "cancelled"
                    : "failed",
                  elapsedMs: performance.now() - start,
                  error: Cause.pretty(exit.cause),
                },
                "package smoke failure",
              );
              yield* fs.writeFileString(
                join(directory, "smoke.json.part"),
                JSON.stringify(failure, null, 2) + "\n",
              );
              yield* fs.rename(
                join(directory, "smoke.json.part"),
                join(directory, "smoke.json"),
              );
            }),
          ),
        ),
      );
    }
    return results;
  });
}
