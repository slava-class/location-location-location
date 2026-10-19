import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import {
  AbsolutePath,
  ArchiveIdentity,
  ModIdentity,
  Sha256,
} from "./contracts.ts";
import type { Packaged } from "./contracts.ts";
import {
  BoundaryError,
  decode,
  Info,
  Locale,
  ModId,
  Profile,
  readJSON,
  Version,
} from "./projects.ts";
import type { ProfileName, ResolvedProject } from "./projects.ts";
import {
  builtins,
  dependencyPin,
  resolveDependency,
  parseDependency,
  satisfies,
} from "./dependencies.ts";
import type { Requirement } from "./dependencies.ts";
import { hashFile } from "./files.ts";
import type { ResolvedEngine } from "./engine.ts";
import { inspectArchive } from "./packaging.ts";
import { newRun } from "./runs.ts";
import { RunId } from "./logs.ts";
import { luaString } from "./lua-string.ts";

const observerId = "modkit-verification-fixture";
const Metadata = Schema.Struct({
  name: ModId,
  version: Version,
  dependencies: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
});
const VerificationPurpose = Schema.Literals([
  "suite",
  "package-smoke",
  "benchmark",
  "benchmark-activity",
  "benchmark-proof",
  "session",
]);
export const ObservationRequest = Schema.Struct({
  schema: Schema.Literal(1),
  runId: RunId,
  mod: ModIdentity,
  purpose: VerificationPurpose,
  profile: Profile,
  language: Locale,
  artifactSha256: Sha256,
});
export const ModList = Schema.Struct({
  mods: Schema.Array(Schema.Struct({ name: ModId, enabled: Schema.Boolean })),
});
export const Observation = Schema.Struct({
  ...ObservationRequest.fields,
  tick: Schema.Int,
  activeMods: Schema.Record(ModId, Version),
});
const RunnerConfig = Schema.Struct({
  modName: ModId,
  factorioPath: AbsolutePath,
  dataDirectory: AbsolutePath,
  outputFile: AbsolutePath,
  save: AbsolutePath,
  forbidOnly: Schema.Literal(true),
  outputTimeout: Schema.Literal(60),
  mods: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[A-Za-z0-9_-]{1,100}=(?:true|false)$(?![\s\S])/u),
    ),
  ),
  factorioArgs: Schema.Array(Schema.String),
  test: Schema.Struct({
    default_timeout: Schema.Literal(120),
    log_passed_tests: Schema.Literal(true),
    tag_blacklist: Schema.Array(Schema.String),
    tag_whitelist: Schema.optionalKey(Schema.Array(Schema.String)),
    game_speed: Schema.optionalKey(Schema.Literal(1)),
  }),
});
export interface Companion {
  readonly project: ResolvedProject;
  readonly artifact: Packaged;
}
interface ArchiveInput {
  readonly path: string;
  readonly sha256: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

function resolveClosure(
  project: ResolvedProject,
  engine: ResolvedEngine,
  profile: ProfileName,
  artifact: typeof ArchiveIdentity.Type,
  companions: readonly Companion[],
  purpose: typeof VerificationPurpose.Type,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bundled = new Map<string, typeof Metadata.Type>();
    for (const name of yield* fs.readDirectory(engine.readData)) {
      // Core is engine data, not an enabled mod; its info.json has no version.
      if (name === "core") continue;
      const path = join(engine.readData, name, "info.json");
      if (
        (yield* fs.stat(join(engine.readData, name))).type === "Directory" &&
        (yield* fs.exists(path))
      ) {
        const metadata = yield* readJSON(Metadata, path, true);
        if (metadata.name !== name)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message: "Bundled module directory and metadata disagree",
            }),
          );
        bundled.set(name, metadata);
      }
    }
    const enabled = new Map<string, string>(),
      archives = new Map<string, ArchiveInput>();
    const pending: { owner: string; declaration: string }[] = [],
      constraints: { owner: string; requirement: Requirement }[] = [];
    for (const entry of [{ project, artifact }, ...companions]) {
      const input = yield* decode(
        ArchiveIdentity,
        {
          archive: entry.artifact.archive,
          sha256: entry.artifact.sha256,
        },
        "profile artifact",
      );
      const packaged = yield* inspectArchive(input.archive, input.sha256);
      if (
        packaged.mod.name !== entry.project.info.name ||
        packaged.mod.version !== entry.project.info.version ||
        enabled.has(packaged.mod.name)
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: entry.project.info.name,
            message: "Duplicate, stale or wrong-target profile artifact",
          }),
        );
      enabled.set(packaged.mod.name, packaged.mod.version);
      archives.set(packaged.mod.name, {
        path: packaged.archive,
        sha256: packaged.sha256,
        version: packaged.mod.version,
        dependencies: packaged.dependencies,
      });
      for (const declaration of packaged.dependencies)
        pending.push({ owner: packaged.mod.name, declaration });
    }
    if (profile === "space-age" && !bundled.has("space-age"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Selected engine does not contain the Space Age expansion",
        }),
      );
    const initial = [
      "base",
      ...(purpose === "suite" ? ["factorio-test"] : []),
      ...(profile === "space-age"
        ? [...builtins].filter((name) => name !== "base" && bundled.has(name))
        : []),
    ];
    for (const name of initial)
      pending.push({ owner: "verification profile", declaration: name });
    for (let index = 0; index < pending.length; index++) {
      const item = pending[index]!;
      const requirement = yield* parseDependency(item.declaration);
      constraints.push({ owner: item.owner, requirement });
      if (
        requirement.kind === "optional" ||
        requirement.kind === "recommended" ||
        requirement.kind === "hidden-optional" ||
        requirement.kind === "incompatible"
      )
        continue;
      if (enabled.has(requirement.name)) continue;
      const builtin = bundled.get(requirement.name);
      if (builtin) {
        if (
          profile !== "space-age" &&
          builtin.name !== "base" &&
          builtin.name !== "core"
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: item.owner,
              message: `Profile ${profile} cannot satisfy required expansion module ${builtin.name}`,
            }),
          );
        enabled.set(builtin.name, builtin.version);
        for (const declaration of builtin.dependencies ?? [])
          pending.push({ owner: builtin.name, declaration });
      } else {
        const pin = yield* dependencyPin(requirement.name),
          path = yield* resolveDependency(project, pin);
        const metadata = yield* inspectArchive(path, pin.sha256);
        if (
          metadata.mod.name !== pin.name ||
          metadata.mod.version !== pin.version
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: pin.name,
              message: "Pinned ZIP metadata does not match its pin",
            }),
          );
        enabled.set(pin.name, pin.version);
        archives.set(pin.name, {
          path,
          sha256: pin.sha256,
          version: pin.version,
          dependencies: metadata.dependencies,
        });
        for (const declaration of metadata.dependencies)
          pending.push({ owner: pin.name, declaration });
      }
    }
    for (const { owner, requirement } of constraints) {
      const version = enabled.get(requirement.name);
      if (version === undefined) continue;
      if (!satisfies(version, requirement))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: owner,
            message: `Enabled ${requirement.name} ${version} contradicts its dependency declaration`,
          }),
        );
    }
    return { enabled, archives, bundled };
  });
}
export function prepareProfile(
  project: ResolvedProject,
  engine: ResolvedEngine,
  profile: ProfileName,
  language: string,
  artifact: typeof ArchiveIdentity.Type,
  companions: readonly Companion[],
  purpose: typeof VerificationPurpose.Type,
) {
  return Effect.gen(function* () {
    yield* decode(Profile, profile, "test profile");
    yield* decode(Locale, language, "profile locale");
    if (project.locales.length !== 0 && !project.locales.includes(language))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: `Locale is not declared by this mod: ${language}`,
        }),
      );
    const fs = yield* FileSystem.FileSystem;
    if (
      !(yield* fs.exists(
        join(engine.readData, "base", "locale", language, "base.cfg"),
      ))
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: language,
          message: "Selected engine has no matching base locale",
        }),
      );
    yield* decode(VerificationPurpose, purpose, "verification purpose");
    if (
      purpose === "package-smoke" &&
      (profile === "native" || profile === "gallery")
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Package smoke requires a headless profile",
        }),
      );
    const closure = yield* resolveClosure(
      project,
      engine,
      profile,
      artifact,
      companions,
      purpose,
    );
    if (closure.enabled.has(observerId))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: observerId,
          message:
            "Product closure collides with the private verification fixture",
        }),
      );
    if (purpose !== "suite" && closure.enabled.has("factorio-test"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Framework-free execution cannot enable FactorioTest through a production dependency",
        }),
      );
    const run = yield* newRun(
        project,
        `${purpose === "suite" ? "test" : purpose}-${profile}-${language}`,
      ),
      directory = run.directory,
      modsDirectory = join(directory, "mods");
    yield* fs.makeDirectory(modsDirectory, { recursive: true });
    for (const [name, input] of closure.archives) {
      const destination = join(modsDirectory, `${name}_${input.version}.zip`);
      yield* fs.copyFile(input.path, destination);
      if ((yield* hashFile(destination)) !== input.sha256)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: name,
            message: "Staged archive differs from the verified input",
          }),
        );
    }
    const request = yield* decode(
      ObservationRequest,
      {
        schema: 1,
        runId: run.runId,
        mod: { name: project.info.name, version: project.info.version },
        purpose,
        profile,
        language,
        artifactSha256: artifact.sha256,
      },
      "observation request",
    );
    const observerDirectory = join(modsDirectory, observerId + "_0.1.0");
    if (purpose !== "benchmark" && purpose !== "session") {
      yield* fs.makeDirectory(observerDirectory);
      const observerDependencies = [
        `base >= ${project.info.factorio_version}.0`,
        `${project.info.name} = ${project.info.version}`,
      ];
      if (purpose === "suite") {
        const framework = yield* dependencyPin("factorio-test");
        observerDependencies.push(`${framework.name} = ${framework.version}`);
      }
      const observerInfo = yield* decode(
        Info,
        {
          name: observerId,
          version: "0.1.0",
          title: "Private verification observer",
          author: "local development",
          factorio_version: project.info.factorio_version,
          dependencies: observerDependencies,
          description:
            "Isolated verification evidence only; never installed or included in product archives.",
        },
        "observer metadata",
      );
      yield* fs.writeFileString(
        join(observerDirectory, "info.json"),
        JSON.stringify(observerInfo),
      );
      yield* fs.copyFile(
        join(
          project.repoRoot,
          "tools",
          "fixtures",
          purpose === "benchmark-proof" || purpose === "benchmark-activity"
            ? "benchmark"
            : "observer",
          "control.lua",
        ),
        join(observerDirectory, "control.lua"),
      );
      yield* fs.writeFileString(
        join(observerDirectory, "request.lua"),
        "return " + luaString(JSON.stringify(request)) + "\n",
      );
      closure.enabled.set(observerId, "0.1.0");
    }
    const toggles = new Map<string, boolean>(
      [...closure.bundled.keys()]
        .filter((name) => name !== "core")
        .map((name) => [name, false] as const),
    );
    for (const name of closure.enabled.keys())
      if (name !== "core") toggles.set(name, true);
    const modList = yield* decode(
      ModList,
      { mods: [...toggles].map(([name, enabled]) => ({ name, enabled })) },
      "profile mod list",
    );
    yield* fs.writeFileString(
      join(modsDirectory, "mod-list.json"),
      JSON.stringify(modList, null, 2),
    );
    const seedSource = join(
        project.repoRoot,
        "node_modules",
        "factorio-test-cli",
        "headless-save.zip",
      ),
      seed = join(directory, "input.zip");
    const seedSha256 = yield* hashFile(seedSource);
    yield* fs.copyFile(seedSource, seed);
    const graphics = profile === "native" || profile === "gallery",
      gallery = profile === "gallery";
    const config = yield* decode(
      RunnerConfig,
      {
        modName: project.info.name,
        factorioPath: engine.executable,
        dataDirectory: directory,
        outputFile: join(directory, "results.json"),
        save: seed,
        forbidOnly: true,
        outputTimeout: 60,
        mods: [...toggles].map(([name, enabled]) => `${name}=${enabled}`),
        factorioArgs: graphics
          ? [
              "--disable-migration-window",
              "--disable-audio",
              "--window-size",
              gallery ? "1920x1080" : "1600x1000",
              "--force-graphics-preset",
              "extreme",
            ]
          : [],
        test: {
          default_timeout: 120,
          log_passed_tests: true,
          tag_blacklist:
            profile === "native"
              ? ["portal-gallery"]
              : graphics
                ? []
                : ["native-ui"],
          ...(graphics
            ? {
                tag_whitelist: [gallery ? "portal-gallery" : "native-ui"],
                game_speed: 1,
              }
            : {}),
        },
      },
      "FactorioTest runner configuration",
    );
    if (purpose === "suite")
      yield* fs.writeFileString(
        join(directory, "runner.json"),
        JSON.stringify(config, null, 2),
      );
    yield* fs.writeFileString(
      join(directory, "config.ini"),
      `[path]\nread-data=${engine.readData}\nwrite-data=${directory}\n[general]\nlocale=${language}\n[graphics]\nfull-screen=false\n${gallery ? "[interface]\nautomatic-ui-scale=false\ncustom-ui-scale=1.25\nshow-tips-and-tricks=false\n" : ""}[sound]\nmaster-muted=true\n[other]\ncheck-updates=false\nenable-crash-log-uploading=false\nautosave-interval=0\n`,
    );
    return {
      run,
      directory,
      config,
      engine,
      profile,
      language,
      request,
      expectedMods: Object.fromEntries(closure.enabled),
      archives: Object.fromEntries(
        [...closure.archives].map(([name, input]) => [
          name,
          { version: input.version, sha256: input.sha256 },
        ]),
      ),
      seedSource,
      seedSha256,
      observerDirectory,
    };
  });
}
export function verifyObservation(
  observed: typeof Observation.Type,
  expected: typeof ObservationRequest.Type,
  expectedMods: Readonly<Record<string, string>>,
) {
  return Effect.gen(function* () {
    if (
      observed.runId !== expected.runId ||
      observed.mod.name !== expected.mod.name ||
      observed.mod.version !== expected.mod.version ||
      observed.artifactSha256 !== expected.artifactSha256 ||
      observed.purpose !== expected.purpose ||
      observed.profile !== expected.profile ||
      observed.language !== expected.language
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: expected.runId,
          message: "Foreign or stale engine observation",
        }),
      );
    yield* verifyActiveMods(observed.activeMods, expectedMods, expected.runId);
  });
}

export function verifyActiveMods(
  observed: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
  boundary: string,
) {
  return Effect.gen(function* () {
    const entries = (value: Readonly<Record<string, string>>) =>
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    if (JSON.stringify(entries(observed)) !== JSON.stringify(entries(expected)))
      return yield* Effect.fail(
        new BoundaryError({
          boundary,
          message:
            "Actual enabled mod names or versions differ from the exact requested closure",
        }),
      );
  });
}
