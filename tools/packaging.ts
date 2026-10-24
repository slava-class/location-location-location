import { Effect, Exit, FileSystem, Schema } from "effect";
import type { PlatformError } from "effect";
import { extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { version as yazlVersion } from "yazl/package.json";
import { withZip, writeZip } from "./archives.ts";
import { hashFile } from "./files.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  contains,
  decode,
  decodeJSON,
  Info,
  readJSON,
  prepareOutputDirectory,
  RelativePath,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { ArchiveIdentity, ArchiveResult, PackageResult } from "./contracts.ts";

const excluded = new Set(["dev", "types", "node_modules"]);
const runtimeExtensions = new Set([
  ".lua",
  ".cfg",
  ".png",
  ".ogg",
  ".wav",
  ".ttf",
  ".otf",
]);
const rootMembers = new Set(["info.json", "changelog.txt", "license.txt"]);

export function packageInventory(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const members = new Set<string>();
    const visit = (
      name: string,
      explicit: boolean,
    ): Effect.Effect<void, BoundaryError | PlatformError.PlatformError> =>
      Effect.gen(function* () {
        yield* decode(RelativePath, name, "package member");
        if (
          name
            .split("/")
            .some((part) => part.startsWith(".") || excluded.has(part))
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message:
                "Development and hidden paths cannot enter release packages",
            }),
          );
        const path = join(project.modRoot, name),
          real = yield* fs.realPath(path);
        if (real !== path || !contains(project.modRoot, real))
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message:
                "Symlinks and escaping paths cannot enter release packages",
            }),
          );
        const stat = yield* fs.stat(path);
        if (stat.type === "Directory") {
          for (const child of [...(yield* fs.readDirectory(path))].sort()) {
            if (child.startsWith(".") || excluded.has(child)) continue;
            yield* visit(name + "/" + child, explicit);
          }
        } else if (stat.type !== "File")
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message: "Release member is not a regular file",
            }),
          );
        else if (
          explicit ||
          runtimeExtensions.has(extname(name)) ||
          rootMembers.has(name)
        )
          members.add(name);
      });
    for (const name of [...(yield* fs.readDirectory(project.modRoot))].sort()) {
      if (name.startsWith(".") || excluded.has(name)) continue;
      yield* visit(name, false);
    }
    for (const name of project.development.packageExtras ?? [])
      yield* visit(name, true);
    for (const required of rootMembers)
      if (!members.has(required))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: project.info.name,
            message: `Required release member is missing: ${required}`,
          }),
        );
    return [...members].sort();
  });
}
export function packageProject(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const members = yield* packageInventory(project);
    const metadata = yield* readJSON(
      Info,
      join(project.modRoot, "info.json"),
      true,
    );
    if (!isDeepStrictEqual(metadata, project.info))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Source metadata changed after project resolution",
        }),
      );
    const outputDirectory = join(
      project.outputRoot,
      "packages",
      crypto.randomUUID(),
    );
    const prefix = `${project.info.name}_${project.info.version}`,
      archive = join(outputDirectory, prefix + ".zip"),
      temporary = archive + ".part";
    if (contains(project.modRoot, outputDirectory))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: outputDirectory,
          message: "Package output must not modify the source tree",
        }),
      );
    yield* prepareOutputDirectory(outputDirectory);
    return yield* Effect.gen(function* () {
      const hashes = new Map<string, string>();
      for (const name of members)
        hashes.set(name, yield* hashFile(join(project.modRoot, name)));
      yield* writeZip(
        temporary,
        members.map((name) => ({
          name: prefix + "/" + name,
          path: join(project.modRoot, name),
        })),
      );
      const sha256 = yield* withZip({ archive: temporary }, (zip) =>
        Effect.gen(function* () {
          if (
            !isDeepStrictEqual(
              zip.members.map((member) => member.name),
              members.map((name) => prefix + "/" + name),
            )
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: archive,
                message: "ZIP inventory differs from package selection",
              }),
            );
          for (const name of members) {
            const path = join(project.modRoot, name);
            yield* assertCanonicalPath(path);
            if (
              (yield* zip.hash(prefix + "/" + name)) !== hashes.get(name) ||
              (yield* hashFile(path)) !== hashes.get(name)
            )
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: name,
                  message: "Packaged bytes differ or source changed",
                }),
              );
          }
          if (
            !isDeepStrictEqual(
              yield* decodeJSON(
                Info,
                yield* zip.read(prefix + "/info.json", 1024 * 1024),
                "packaged metadata",
                true,
              ),
              metadata,
            )
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: archive,
                message: "Packaged metadata differs",
              }),
            );
          return zip.sha256;
        }),
      );
      if (!isDeepStrictEqual(yield* packageInventory(project), members))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: project.modRoot,
            message: "Package inventory changed during writing",
          }),
        );
      const result = yield* decode(
        PackageResult,
        {
          schema: 2,
          mod: { name: project.info.name, version: project.info.version },
          archive,
          sha256,
          sha1: yield* hashFile(temporary, "sha1"),
          files: Object.fromEntries(hashes),
          compression: {
            implementation: "yazl",
            version: yazlVersion,
            bun: Bun.version,
            bunRevision: Bun.revision,
            zlib: process.versions.zlib,
            method: "deflate",
            level: 9,
          },
        },
        "package result",
      );
      yield* assertCanonicalPath(archive);
      if (yield* fs.exists(archive))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: archive,
            message: "Refusing to replace an existing package",
          }),
        );
      yield* fs.rename(temporary, archive);
      yield* fs.writeFileString(
        join(outputDirectory, "package.json"),
        JSON.stringify(Schema.encodeSync(PackageResult)(result), null, 2) +
          "\n",
        { flag: "wx" },
      );
      return result;
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? Effect.gen(function* () {
              yield* assertCanonicalPath(outputDirectory);
              yield* fs.remove(outputDirectory, { recursive: true });
            }).pipe(Effect.orDie)
          : Effect.void,
      ),
    );
  });
}
export function inspectArchive(archive: string, sha256: string) {
  return Effect.gen(function* () {
    const input = yield* decode(
      ArchiveIdentity,
      { archive, sha256 },
      "archive identity",
    );
    return yield* withZip(input, (zip) =>
      Effect.gen(function* () {
        const candidates = zip.members.filter(
          (member) =>
            !member.directory &&
            member.name.split("/").length === 2 &&
            member.name.endsWith("/info.json"),
        );
        if (candidates.length !== 1)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: archive,
              message: "Archive requires exactly one bounded root info.json",
            }),
          );
        const metadata = yield* decodeJSON(
          Schema.Struct({
            ...ArchiveResult.fields.mod.fields,
            factorio_version: Schema.optionalKey(Info.fields.factorio_version),
            dependencies: Schema.optionalKey(ArchiveResult.fields.dependencies),
          }),
          yield* zip.read(candidates[0]!.name, 1024 * 1024),
          "archive metadata",
          true,
        );
        const root = candidates[0]!.name.split("/")[0]!;
        if (
          (root !== metadata.name &&
            root !== `${metadata.name}_${metadata.version}`) ||
          zip.members.some((member) =>
            member.name === root
              ? !member.directory
              : !member.name.startsWith(root + "/"),
          )
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: archive,
              message: "Archive root does not match its declared identity",
            }),
          );
        yield* zip.verifyAll;
        return yield* decode(
          ArchiveResult,
          {
            schema: 1,
            archive,
            sha256: zip.sha256,
            mod: { name: metadata.name, version: metadata.version },
            ...(metadata.factorio_version === undefined
              ? {}
              : { factorio_version: metadata.factorio_version }),
            dependencies: metadata.dependencies ?? ["base"],
            members: zip.members
              .filter((member) => !member.directory)
              .map((member) => member.name.slice(root.length + 1))
              .sort(),
          },
          "archive inspection",
        );
      }),
    );
  });
}
