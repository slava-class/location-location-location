import { Cause, Effect, Exit, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { AbsolutePath, ElapsedMs, Sha256 } from "./contracts.ts";
import type { Packaged } from "./contracts.ts";
import {
  Engine,
  GraphicsPreset,
  resolveEngine,
  resolveGraphicsPreset,
} from "./engine.ts";
import { hashFile } from "./files.ts";
import type { Backend } from "./backend.ts";
import { ImageEvidence, verifyPNG } from "./images.ts";
import { verifyEngineDiagnostics } from "./engine-diagnostics.ts";
import { packageProject } from "./packaging.ts";
import { withProcess } from "./process.ts";
import {
  Observation,
  ObservationRequest,
  prepareProfile,
  verifyObservation,
} from "./profiles.ts";
import {
  BoundaryError,
  decode,
  Locale,
  ModId,
  readJSON,
  RelativePath,
  resolveProject,
  Version,
} from "./projects.ts";
import type { ProfileName, ResolvedProject } from "./projects.ts";
import { inheritedEnvironment } from "./runs.ts";
import {
  nativePassRecords,
  selectedCases,
  TestInventory,
  TestResult,
  TestSelection,
  TestSummary,
  verifyNativeCases,
  verifySummary,
  verifyTestResult,
} from "./test-results.ts";
import { sourceSeal, SourceSeal, verifySourceSeal } from "./source.ts";

const NativeResult = Schema.Struct({
  ...Observation.fields,
  summary: TestSummary,
  player: Schema.Struct({
    locale: Locale,
    width: Schema.Int,
    height: Schema.Int,
    scale: Schema.Number,
  }),
});
const VerificationIdentity = Schema.Struct({
  request: ObservationRequest,
  engine: Engine,
  graphics: Schema.NullOr(GraphicsPreset),
  source: SourceSeal,
  directory: AbsolutePath,
  inventorySha256: Sha256,
  seedSha256: Sha256,
  fixtureSha256: Sha256,
  startedAt: Schema.String,
  elapsedMs: ElapsedMs,
});
export const VerificationRequest = Schema.Struct({
  ...VerificationIdentity.fields,
  expectedMods: Schema.Record(ModId, Version),
  expected: TestSelection,
});
export const VerificationResult = Schema.Struct({
  ...VerificationIdentity.fields,
  status: Schema.Literal("passed"),
  observed: Observation,
  summary: TestSummary,
  caseEvidence: Schema.Literals(["framework-json", "native-framework-log"]),
  passed: Schema.Array(Schema.String),
  skipped: Schema.Int,
  images: Schema.Array(
    Schema.Struct({ file: RelativePath, evidence: ImageEvidence }),
  ),
});
const VerificationFailure = Schema.Struct({
  ...VerificationIdentity.fields,
  status: Schema.Literals(["failed", "cancelled"]),
  error: Schema.String,
});
export const VerificationState = Schema.Union([
  VerificationResult,
  VerificationFailure,
]);
export function runEngineSuite(
  project: ResolvedProject,
  profile: ProfileName,
  options: {
    language?: string;
    engine?: string;
    artifact?: Packaged;
    backend?: typeof Backend.Type;
    graphics?: typeof GraphicsPreset.Type;
  } = {},
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      graphics = profile === "native" || profile === "gallery";
    if (
      project.capabilities.verification !== "engine" ||
      (!graphics && !project.capabilities.profiles.includes(profile))
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Requested engine profile is not declared by this project",
        }),
      );
    const native = project.development.native;
    if (graphics && native === undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Native capture scenes are not declared",
        }),
      );
    const language = yield* decode(
      Locale,
      options.language ?? "en",
      "suite locale",
    );
    if (!graphics && options.graphics !== undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Headless suites do not accept graphics settings",
        }),
      );
    const graphicsPreset = graphics
      ? yield* resolveGraphicsPreset(
          profile === "gallery" ? "asset" : "test",
          options.graphics,
        )
      : null;
    if (project.locales.length !== 0 && !project.locales.includes(language))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: `Locale is not declared by this mod: ${language}`,
        }),
      );
    const source = yield* sourceSeal(project);
    const inventoryPath = join(project.modRoot, "dev", "engine-inventory.json");
    const inventory = yield* readJSON(TestInventory, inventoryPath),
      expected = yield* selectedCases(inventory, profile);
    const inventorySha256 = yield* hashFile(inventoryPath);
    const engine = yield* resolveEngine(
        project,
        graphics ? "native" : "headless",
        options.engine,
        options.backend,
      ),
      artifact = options.artifact ?? (yield* packageProject(project));
    const companions = [];
    for (const id of project.development.companions ?? []) {
      const companion = yield* resolveProject(
        project.repoRoot,
        id,
        project.repoRoot,
      );
      companions.push({
        project: companion,
        artifact: yield* packageProject(companion),
      });
    }
    const context = yield* prepareProfile(
      project,
      engine,
      profile,
      language,
      artifact,
      companions,
      "suite",
      graphicsPreset === null ? {} : { graphics: graphicsPreset },
    );
    const { run, directory, request } = context;
    const startedAt = new Date().toISOString(),
      start = performance.now(),
      fixtureSha256 = yield* hashFile(
        join(context.observerDirectory, "control.lua"),
      );
    const identity = () => ({
      request,
      engine,
      graphics: context.graphics,
      source,
      directory,
      inventorySha256,
      seedSha256: context.seedSha256,
      fixtureSha256,
      startedAt,
      elapsedMs: performance.now() - start,
    });
    const input = yield* decode(
      VerificationRequest,
      { ...identity(), expectedMods: context.expectedMods, expected },
      "engine verification request",
    );
    yield* fs.writeFileString(
      join(directory, "verification-request.json"),
      JSON.stringify(input, null, 2) + "\n",
    );
    const operation = Effect.gen(function* () {
      yield* withProcess(
        {
          ...run,
          evidence: "engine-suite",
          ...(engine.docker === undefined ? {} : { docker: engine.docker }),
          command: [
            engine.docker === undefined ? process.execPath : "/opt/bun",
            join(
              project.repoRoot,
              "node_modules",
              "factorio-test-cli",
              "cli.js",
            ),
            "run",
            "--config",
            join(directory, "runner.json"),
            "--verbose",
            ...(graphics ? ["--graphics"] : []),
          ],
          env: inheritedEnvironment(),
          redact: [],
          gameLog: {
            current: join(directory, "factorio-current.log"),
            previous: join(directory, "factorio-previous.log"),
          },
          deadlineMs: graphics ? 240000 : 180000,
        },
        (child) =>
          Effect.gen(function* () {
            if (graphics) {
              yield* child.waitForText(
                new RegExp("MODKIT_CAPTURE_FLUSHED:" + run.runId),
                "native-capture-flush",
                210000,
              );
              yield* child.stop;
            } else yield* child.waitForExit;
          }),
      );
      if ((yield* hashFile(context.seedSource)) !== context.seedSha256)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: run.runId,
            message: "Shared seed changed during the run",
          }),
        );
      if ((yield* hashFile(inventoryPath)) !== inventorySha256)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: run.runId,
            message: "Expected case inventory changed during verification",
          }),
        );
      yield* verifySourceSeal(source, yield* sourceSeal(project));
      const observed = yield* readJSON(
        Observation,
        join(directory, "script-output", "modkit-observed-mods.json"),
      );
      yield* verifyObservation(observed, request, context.expectedMods);
      const logPath = join(directory, "factorio-current.log"),
        logStat = yield* fs.stat(logPath);
      if (Number(logStat.size) > 32 * 1024 * 1024)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: run.runId,
            message: "Engine log exceeds the bounded verification parser limit",
          }),
        );
      const log = yield* fs.readFileString(logPath);
      yield* verifyEngineDiagnostics(
        log,
        graphics ? "clean" : "factorio-test-exit",
        project.info,
      );
      const images: { file: string; evidence: typeof ImageEvidence.Type }[] =
        [];
      let summary: typeof TestSummary.Type;
      if (graphics && native !== undefined) {
        const result = yield* readJSON(
          NativeResult,
          join(directory, "script-output", "modkit-native-result.json"),
        );
        yield* verifyObservation(result, request, context.expectedMods);
        yield* verifySummary(result.summary, expected, run.runId);
        yield* verifyNativeCases(
          nativePassRecords(log),
          expected.passed,
          run.runId,
        );
        const width = profile === "gallery" ? 1920 : 1600,
          height = profile === "gallery" ? 1080 : 1000;
        if (
          result.player.locale !== context.language ||
          result.player.width !== width ||
          result.player.height !== height ||
          result.player.scale !== (profile === "gallery" ? 1.25 : 0.75) ||
          !log.includes(`Forced graphics settings preset: ${graphicsPreset}`)
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: run.runId,
              message: `Native capture contract mismatch: expected locale=${context.language}, viewport=${width}x${height}, scale=${profile === "gallery" ? 1.25 : 0.75}, preset=${graphicsPreset}; observed locale=${result.player.locale}, viewport=${result.player.width}x${result.player.height}, scale=${result.player.scale}, preset log confirmation=${log.includes(`Forced graphics settings preset: ${graphicsPreset}`)}`,
            }),
          );
        const scenes = profile === "gallery" ? native.gallery : native.scenes,
          suite = profile === "gallery" ? native.gallerySuite : native.suite;
        if (
          scenes.length !== expected.passed.length ||
          new Set(scenes.map((scene) => scene.file)).size !== scenes.length ||
          scenes.some(
            (scene) =>
              !expected.passed.some((path) =>
                path.endsWith(" > " + suite + " > " + scene.name),
              ),
          )
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: run.runId,
              message:
                "Capture scenes and independently declared selected cases disagree",
            }),
          );
        for (const scene of scenes)
          images.push({
            file: scene.file,
            evidence: yield* verifyPNG(
              join(directory, "script-output", scene.file),
              width,
              height,
            ),
          });
        summary = result.summary;
      } else {
        const result = yield* readJSON(
          TestResult,
          join(directory, "results.json"),
          true,
        );
        yield* verifyTestResult(result, project.info.name, expected);
        summary = result.summary;
      }
      const result = yield* decode(
        VerificationResult,
        {
          ...identity(),
          status: "passed",
          observed,
          summary,
          caseEvidence: graphics ? "native-framework-log" : "framework-json",
          passed: expected.passed,
          skipped: expected.skipped.length,
          images,
        },
        "verified engine result",
      );
      yield* fs.writeFileString(
        join(directory, "verification.json.part"),
        JSON.stringify(result, null, 2) + "\n",
      );
      yield* fs.rename(
        join(directory, "verification.json.part"),
        join(directory, "verification.json"),
      );
      return result;
    });
    return yield* operation.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) return;
          const failure = yield* decode(
            VerificationFailure,
            {
              ...identity(),
              status: Cause.hasInterruptsOnly(exit.cause)
                ? "cancelled"
                : "failed",
              error: Cause.pretty(exit.cause).slice(0, 4000),
            },
            "failed engine verification",
          );
          yield* fs.writeFileString(
            join(directory, "verification.json.part"),
            JSON.stringify(failure, null, 2) + "\n",
          );
          yield* fs.rename(
            join(directory, "verification.json.part"),
            join(directory, "verification.json"),
          );
        }),
      ),
    );
  });
}
