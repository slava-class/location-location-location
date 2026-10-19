import { Effect, FileSystem, Schema } from "effect";
import type { PlatformError } from "effect";
import { extname, join } from "node:path";
import {
  BoundaryError,
  contains,
  decode,
  prepareOutputDirectory,
  RelativePath,
} from "./projects.ts";
import type { ExecutionContext, ResolvedProject } from "./projects.ts";
import {
  ArchiveRequest,
  ArchiveResult,
  PackageRequest,
  PackageResult,
} from "./contracts.ts";
import { runHelper } from "./helpers.ts";

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
    const outputDirectory = join(
      project.outputRoot,
      "packages",
      crypto.randomUUID(),
    );
    yield* prepareOutputDirectory(outputDirectory);
    const result = yield* runHelper(
      project,
      "tools/package.py",
      PackageRequest,
      PackageResult,
      {
        schema: 1,
        modRoot: project.modRoot,
        outputDirectory,
        info: project.info,
        members,
      },
    );
    if (
      result.mod.name !== project.info.name ||
      result.mod.version !== project.info.version ||
      result.archive !==
        join(
          outputDirectory,
          `${project.info.name}_${project.info.version}.zip`,
        ) ||
      Object.keys(result.files).sort().join("\n") !== members.join("\n")
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Packager returned a different artifact or inventory",
        }),
      );
    const bytes = yield* fs.readFile(result.archive);
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const sha1 = new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
    if (sha256 !== result.sha256 || sha1 !== result.sha1)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: result.archive,
          message: "Packager digest readback differs",
        }),
      );
    yield* fs.writeFileString(
      join(outputDirectory, "package.json"),
      JSON.stringify(Schema.encodeSync(PackageResult)(result), null, 2) + "\n",
    );
    return result;
  });
}
export function inspectArchive(
  project: ExecutionContext,
  archive: string,
  sha256: string,
) {
  return Effect.gen(function* () {
    const result = yield* runHelper(
      project,
      "tools/inspect-archive.py",
      ArchiveRequest,
      ArchiveResult,
      { schema: 1, archive, sha256 },
    );
    if (result.archive !== archive || result.sha256 !== sha256)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: archive,
          message: "Archive inspector returned another input identity",
        }),
      );
    return result;
  });
}
