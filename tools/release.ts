import { Cause, Effect, Exit, FileSystem, Schema } from "effect";
import { basename, dirname, join, relative } from "node:path";
import { ModIdentity, Sha1, Sha256 } from "./contracts.ts";
import { withReleaseLock } from "./locks.ts";
import type { PortalFile } from "./mod-portal.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  Locale,
  prepareOutputDirectory,
  readJSON,
  RelativePath,
  Version,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { Listing, readListing } from "./release-info.ts";
import { smokePackage, SmokeResult } from "./smoke.ts";
import { sourceSeal, SourceSeal, verifySourceSeal } from "./source.ts";
import { selectedCases, TestInventory, verifySummary } from "./test-results.ts";
import { runEngineSuite, VerificationResult } from "./testing.ts";
import { ProjectVerification, verifyProjects } from "./verification.ts";
import { Backend } from "./backend.ts";

const FileRecord = Schema.Struct({
  file: RelativePath,
  sha256: Sha256,
  sha1: Sha1,
});
export const ReleaseManifest = Schema.Struct({
  schema: Schema.Literal(1),
  mod: ModIdentity,
  preparedAt: Schema.NonEmptyString,
  locale: Locale,
  source: SourceSeal,
  archive: FileRecord,
  captures: Schema.Array(FileRecord),
  images: Schema.Array(RelativePath),
  listing: Listing,
  evidence: Schema.Struct({
    verification: ProjectVerification,
    smoke: Schema.Array(SmokeResult),
    native: Schema.NullOr(VerificationResult),
    gallery: Schema.NullOr(VerificationResult),
  }),
});
export type PreparedRelease = {
  readonly manifest: typeof ReleaseManifest.Type;
  readonly directory: string;
  readonly archive: PortalFile;
  readonly images: readonly PortalFile[];
};
const hash = (bytes: Uint8Array, algorithm: "sha256" | "sha1") =>
  new Bun.CryptoHasher(algorithm).update(bytes).digest("hex");
const record = (file: string, bytes: Uint8Array) => ({
  file,
  sha256: hash(bytes, "sha256"),
  sha1: hash(bytes, "sha1"),
});
const requireRelease = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : Effect.fail(new BoundaryError({ boundary: "release", message }));
const bundleDirectory = (project: ResolvedProject, version: string) =>
  join(project.outputRoot, "releases", version);

export function saveReleaseJSON<S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  value: unknown,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const parsed = yield* decode(schema, value, basename(path));
      const fs = yield* FileSystem.FileSystem;
      yield* prepareOutputDirectory(dirname(path));
      const temporary = yield* fs.makeTempDirectoryScoped({
        directory: dirname(path),
        prefix: ".release-",
      });
      const part = join(temporary, "value.json");
      yield* fs.writeFileString(part, JSON.stringify(parsed, null, 2) + "\n", {
        flag: "wx",
      });
      yield* fs.rename(part, path);
    }),
  );
}
function readFrozen(
  directory: string,
  item: typeof FileRecord.Type,
  maximum: number,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(directory, item.file);
    yield* requireRelease(
      (yield* fs.realPath(path)) === path,
      `Frozen file is redirected: ${item.file}`,
    );
    const stat = yield* fs.stat(path);
    yield* requireRelease(
      stat.type === "File" && Number(stat.size) <= maximum,
      `Frozen file is not a bounded regular file: ${item.file}`,
    );
    const bytes = yield* fs.readFile(path);
    yield* requireRelease(
      hash(bytes, "sha256") === item.sha256 &&
        hash(bytes, "sha1") === item.sha1,
      `Frozen bytes changed: ${item.file}`,
    );
    return bytes;
  });
}

export function loadPrepared(project: ResolvedProject, inputVersion: string) {
  return Effect.gen(function* () {
    const version = yield* decode(
      Version,
      inputVersion,
      "prepared release version",
    );
    yield* requireRelease(
      version === project.info.version,
      "Prepared version differs from the resolved project",
    );
    const fs = yield* FileSystem.FileSystem;
    const directory = bundleDirectory(project, version);
    yield* requireRelease(
      (yield* fs.realPath(directory)) === directory,
      "Prepared bundle is redirected",
    );
    const manifestPath = join(directory, "manifest.json");
    yield* requireRelease(
      (yield* fs.realPath(manifestPath)) === manifestPath,
      "Prepared manifest is redirected",
    );
    const manifest = yield* readJSON(ReleaseManifest, manifestPath);
    yield* requireRelease(
      manifest.mod.name === project.info.name &&
        manifest.mod.version === version,
      "Prepared mod identity differs",
    );
    yield* verifySourceSeal(manifest.source, yield* sourceSeal(project));
    yield* requireRelease(
      JSON.stringify(manifest.listing) ===
        JSON.stringify(yield* readListing(project)),
      "Prepared listing differs from current source",
    );
    const proof = manifest.evidence.verification;
    yield* verifySourceSeal(manifest.source, proof.source);
    yield* requireRelease(
      proof.mod.name === manifest.mod.name &&
        proof.mod.version === version &&
        JSON.stringify(proof.capabilities) ===
          JSON.stringify(project.capabilities),
      "Verification belongs to another product or capability contract",
    );
    yield* requireRelease(
      manifest.archive.file === `${project.info.name}_${version}.zip` &&
        proof.artifact.mod.name === project.info.name &&
        proof.artifact.mod.version === version &&
        proof.artifact.sha256 === manifest.archive.sha256 &&
        proof.artifact.sha1 === manifest.archive.sha1,
      "Prepared ZIP differs from the verified package",
    );
    const archive = {
      file: manifest.archive.file,
      sha1: manifest.archive.sha1,
      bytes: yield* readFrozen(directory, manifest.archive, 256 * 1024 * 1024),
    };
    const profiles =
      project.capabilities.verification === "engine"
        ? [...project.capabilities.profiles].sort()
        : [];
    const suites = [...proof.engine];
    yield* requireRelease(
      JSON.stringify(
        proof.engine.map((entry) => entry.request.profile).sort(),
      ) === JSON.stringify(profiles),
      "Verification does not cover the declared engine profiles",
    );
    yield* requireRelease(
      JSON.stringify(
        manifest.evidence.smoke.map((entry) => entry.request.profile).sort(),
      ) === JSON.stringify(profiles),
      "Independent package smoke does not cover the declared engine profiles",
    );
    const graphics =
      project.capabilities.verification === "engine" &&
      project.development.native !== undefined;
    yield* requireRelease(
      (manifest.evidence.native !== null) === graphics &&
        (manifest.evidence.gallery !== null) === graphics,
      "Native proof coverage differs from the declared scenes",
    );
    if (manifest.evidence.native) suites.push(manifest.evidence.native);
    if (manifest.evidence.gallery) suites.push(manifest.evidence.gallery);
    const inventory = profiles.length
      ? yield* readJSON(
          TestInventory,
          join(project.modRoot, "dev", "engine-inventory.json"),
        )
      : null;
    const runIds = new Set<string>();
    for (const entry of [...suites, ...manifest.evidence.smoke]) {
      yield* verifySourceSeal(manifest.source, entry.source);
      yield* requireRelease(
        !runIds.has(entry.request.runId),
        "A single engine run cannot certify multiple verification phases",
      );
      runIds.add(entry.request.runId);
      yield* requireRelease(
        entry.request.mod.name === project.info.name &&
          entry.request.mod.version === version &&
          entry.request.artifactSha256 === manifest.archive.sha256,
        "Engine evidence belongs to another mod or ZIP",
      );
      const observed = entry.observed;
      yield* requireRelease(
        observed.schema === entry.request.schema &&
          observed.runId === entry.request.runId &&
          observed.mod.name === project.info.name &&
          observed.mod.version === version &&
          observed.artifactSha256 === manifest.archive.sha256 &&
          observed.purpose === entry.request.purpose &&
          observed.profile === entry.request.profile &&
          observed.language === entry.request.language &&
          observed.activeMods[project.info.name] === version,
        "Engine observation differs from its request",
      );
    }
    for (const entry of suites) {
      yield* requireRelease(
        entry.request.purpose === "suite" && inventory !== null,
        "Suite proof has the wrong purpose or inventory",
      );
      if (inventory === null)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "release",
            message: "Missing engine inventory",
          }),
        );
      const expected = yield* selectedCases(inventory, entry.request.profile);
      yield* verifySummary(entry.summary, expected, entry.request.profile);
      yield* requireRelease(
        JSON.stringify([...entry.passed].sort()) ===
          JSON.stringify(expected.passed) &&
          entry.skipped === expected.skipped.length &&
          entry.inventorySha256 ===
            manifest.source.files[
              relative(
                project.repoRoot,
                join(project.modRoot, "dev", "engine-inventory.json"),
              )
            ],
        "Suite cases differ from the sealed inventory",
      );
    }
    for (const entry of manifest.evidence.smoke) {
      yield* requireRelease(
        entry.request.purpose === "package-smoke" &&
          entry.artifact.sha256 === manifest.archive.sha256 &&
          entry.artifact.sha1 === manifest.archive.sha1 &&
          entry.observed.activeMods["factorio-test"] === undefined,
        "Package smoke is not independent proof of the frozen ZIP",
      );
    }
    const captures = new Map(
      manifest.captures.map((item) => [item.file, item]),
    );
    yield* requireRelease(
      captures.size === manifest.captures.length,
      "Duplicate frozen capture identity",
    );
    const expectedCaptures: string[] = [];
    for (const profile of ["native", "gallery"] as const) {
      const entry = manifest.evidence[profile];
      if (entry === null) continue;
      yield* requireRelease(
        entry.request.profile === profile &&
          entry.request.language === manifest.locale,
        "Native proof has the wrong profile or locale",
      );
      yield* requireRelease(
        entry.graphics === "extreme",
        "Prepared release captures require verified Extreme graphics",
      );
      const scenes =
        profile === "native"
          ? project.development.native!.scenes
          : project.development.native!.gallery;
      yield* requireRelease(
        JSON.stringify(entry.images.map((image) => image.file).sort()) ===
          JSON.stringify(scenes.map((scene) => scene.file).sort()),
        "Native captures do not cover the declared scenes",
      );
      for (const image of entry.images) {
        const file = `captures/${profile}/${image.file}`;
        expectedCaptures.push(file);
        const frozen = captures.get(file);
        yield* requireRelease(
          frozen !== undefined && frozen.sha256 === image.evidence.sha256,
          `Capture differs from decoded engine evidence: ${file}`,
        );
      }
    }
    yield* requireRelease(
      JSON.stringify([...captures.keys()].sort()) ===
        JSON.stringify(expectedCaptures.sort()),
      "Frozen capture inventory differs from the engine evidence",
    );
    const selected = graphics
      ? project.development.native!.gallerySelection.map(
          (file) => `captures/gallery/${file}`,
        )
      : [];
    yield* requireRelease(
      JSON.stringify(manifest.images) === JSON.stringify(selected) &&
        new Set(selected).size === selected.length,
      "Prepared gallery selection or ordering differs",
    );
    const imageBytes = new Map<string, PortalFile>();
    for (const item of manifest.captures) {
      const bytes = yield* readFrozen(directory, item, 64 * 1024 * 1024);
      if (selected.includes(item.file))
        imageBytes.set(item.file, {
          file: basename(item.file),
          sha1: item.sha1,
          bytes,
        });
    }
    const images: PortalFile[] = [];
    for (const file of selected) {
      const image = imageBytes.get(file);
      if (!image)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: file,
            message: "Selected gallery capture is missing",
          }),
        );
      images.push(image);
    }
    yield* requireRelease(
      new Set(images.map((image) => image.sha1)).size === images.length,
      "Portal gallery must contain distinct scenes",
    );
    return { manifest, directory, archive, images } satisfies PreparedRelease;
  });
}

export const PreparedStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({ state: Schema.Literal("unusable"), error: Schema.String }),
  Schema.Struct({
    state: Schema.Literal("ready"),
    directory: Schema.String,
    source: Sha256,
    archiveSha1: Sha1,
  }),
]);

/** Offline readback shares the complete publication qualification boundary. */
export function inspectPrepared(project: ResolvedProject) {
  return Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = join(
        bundleDirectory(project, project.info.version),
        "manifest.json",
      );
      yield* assertCanonicalPath(path);
      return (yield* fs.exists(path))
        ? yield* loadPrepared(project, project.info.version)
        : null;
    }).pipe(Effect.exit);
    if (Exit.isFailure(outcome)) {
      if (Cause.hasInterrupts(outcome.cause))
        return yield* Effect.failCause(outcome.cause);
      return {
        status: {
          state: "unusable",
          error: Cause.pretty(outcome.cause).slice(0, 8192),
        },
        bundle: null,
      } as const;
    }
    const bundle = outcome.value;
    return bundle === null
      ? ({ status: { state: "absent" }, bundle: null } as const)
      : ({
          status: {
            state: "ready",
            directory: bundle.directory,
            source: bundle.manifest.source.sha256,
            archiveSha1: bundle.archive.sha1,
          },
          bundle,
        } as const);
  });
}

export function prepareRelease(
  project: ResolvedProject,
  options: {
    language?: string;
    engine?: string;
    backend?: typeof Backend.Type;
  } = {},
) {
  return withReleaseLock(
    project,
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const backend = yield* decode(
          Backend,
          options.backend ?? "native",
          "release verification backend",
        );
        const language = yield* decode(
          Locale,
          options.language ?? "en",
          "release locale",
        );
        const directory = bundleDirectory(project, project.info.version);
        yield* prepareOutputDirectory(directory);
        const manifestPath = join(directory, "manifest.json");
        if (yield* fs.exists(manifestPath))
          yield* fs.rename(
            manifestPath,
            join(directory, `invalidated-${crypto.randomUUID()}.json`),
          );
        yield* requireRelease(
          project.locales.length === 0 || project.locales.includes(language),
          "Release locale is not declared by this mod",
        );
        yield* requireRelease(
          project.capabilities.verification === "offline" ||
            project.capabilities.visual !== "undeclared",
          "Declare visual presence or absence before release preparation",
        );
        yield* requireRelease(
          project.capabilities.visual !== "present" ||
            project.capabilities.verification === "offline" ||
            project.development.native !== undefined,
          "Visual engine verification requires native scenes",
        );
        const source = yield* sourceSeal(project);
        const listing = yield* readListing(project);
        const report = yield* verifyProjects([project], backend, false);
        const row = report.projects[0];
        if (!row || row.status !== "passed")
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message:
                "Release preparation requires passing project verification; inspect its run receipt",
            }),
          );
        const verification = yield* readJSON(
          ProjectVerification,
          join(row.directory, "verify.json"),
        );
        yield* verifySourceSeal(source, verification.source);
        const artifact = verification.artifact;
        const engineBacked = project.capabilities.verification === "engine";
        const graphics =
          engineBacked && project.development.native !== undefined;
        const native = graphics
          ? yield* runEngineSuite(project, "native", {
              artifact,
              language,
              graphics: "extreme",
              ...(options.engine === undefined
                ? {}
                : { engine: options.engine }),
            })
          : null;
        const smoke = engineBacked
          ? yield* smokePackage(project, { artifact, backend })
          : [];
        const gallery = graphics
          ? yield* runEngineSuite(project, "gallery", {
              artifact,
              language,
              ...(options.engine === undefined
                ? {}
                : { engine: options.engine }),
            })
          : null;
        const stage = yield* fs.makeTempDirectoryScoped({
          directory: dirname(directory),
          prefix: ".prepare-",
        });
        const writeFile = (file: string, bytes: Uint8Array) =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(dirname(join(stage, file)), {
              recursive: true,
            });
            yield* fs.writeFile(join(stage, file), bytes, { flag: "wx" });
            return record(file, bytes);
          });
        const archiveBytes = yield* fs.readFile(artifact.archive);
        yield* requireRelease(
          hash(archiveBytes, "sha256") === artifact.sha256 &&
            hash(archiveBytes, "sha1") === artifact.sha1,
          "Verified archive changed before freezing",
        );
        const archive = yield* writeFile(
          `${project.info.name}_${project.info.version}.zip`,
          archiveBytes,
        );
        const captures: (typeof FileRecord.Type)[] = [];
        for (const entry of [native, gallery]) {
          if (entry === null) continue;
          for (const image of entry.images) {
            const bytes = yield* fs.readFile(
              join(entry.directory, "script-output", image.file),
            );
            yield* requireRelease(
              hash(bytes, "sha256") === image.evidence.sha256,
              "Capture changed after full PNG decoding",
            );
            captures.push(
              yield* writeFile(
                `captures/${entry.request.profile}/${image.file}`,
                bytes,
              ),
            );
          }
        }
        const manifest = yield* decode(
          ReleaseManifest,
          {
            schema: 1,
            mod: source.mod,
            preparedAt: new Date().toISOString(),
            locale: language,
            source,
            archive,
            captures,
            images: graphics
              ? project.development.native!.gallerySelection.map(
                  (file) => `captures/gallery/${file}`,
                )
              : [],
            listing,
            evidence: { verification, smoke, native, gallery },
          },
          "prepared release",
        );
        yield* verifySourceSeal(source, yield* sourceSeal(project));
        // Preserve invalidated candidates; publication journals live outside this version directory.
        const history = join(dirname(directory), ".history");
        yield* prepareOutputDirectory(history);
        yield* fs.rename(
          directory,
          join(history, `${project.info.version}-${crypto.randomUUID()}`),
        );
        yield* fs.makeDirectory(directory);
        for (const name of yield* fs.readDirectory(stage))
          yield* fs.rename(join(stage, name), join(directory, name));
        return yield* saveReleaseJSON(
          manifestPath,
          ReleaseManifest,
          manifest,
        ).pipe(
          Effect.andThen(loadPrepared(project, project.info.version)),
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? fs.remove(manifestPath, { force: true })
              : Effect.void,
          ),
        );
      }),
    ),
  );
}
