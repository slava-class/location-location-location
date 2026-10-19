import { Effect, FileSystem, Schema } from "effect";
import type { PlatformError } from "effect";
import { join, relative } from "node:path";
import { ModIdentity, Sha256 } from "./contracts.ts";
import { hashFile } from "./files.ts";
import {
  BoundaryError,
  decode,
  RelativePath,
  resolveProject,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";

export const SourceSeal = Schema.Struct({
  schema: Schema.Literal(1),
  mod: ModIdentity,
  files: Schema.Record(RelativePath, Sha256),
  sha256: Sha256,
});
const sharedFiles = [
  "package.json",
  "bun.lock",
  ".mise.toml",
  "tsconfig.json",
  "stylua.toml",
  "license.txt",
  ".gitignore",
  ".editorconfig",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  ".trunk/trunk.yaml",
  ".betterleaks.toml",
  "knip.config.ts",
];
const optionalGuidance = ["README.md", "AGENTS.md"];
const excluded = new Set(["node_modules", ".git", ".factorio-test", "dist"]);
export function sourceFiles(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      files = new Set<string>();
    const visit = (
      path: string,
    ): Effect.Effect<
      void,
      BoundaryError | PlatformError.PlatformError,
      FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        const actual = yield* fs.realPath(path);
        if (actual !== path)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Release inputs cannot be symlinks or aliases",
            }),
          );
        const stat = yield* fs.stat(path);
        if (stat.type === "Directory") {
          for (const name of [...(yield* fs.readDirectory(path))].sort())
            if (!excluded.has(name) && name !== ".DS_Store")
              yield* visit(join(path, name));
        } else if (stat.type === "File") {
          const name = relative(project.repoRoot, path).split("\\").join("/");
          yield* decode(RelativePath, name, "source input");
          files.add(name);
        } else
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Release input is not a regular file or directory",
            }),
          );
      });
    for (const name of sharedFiles) yield* visit(join(project.repoRoot, name));
    for (const name of optionalGuidance)
      if (yield* fs.exists(join(project.repoRoot, name)))
        yield* visit(join(project.repoRoot, name));
    for (const name of ["tools", "patches"])
      yield* visit(join(project.repoRoot, name));
    const visited = new Set<string>();
    const include = (
      target: ResolvedProject,
    ): Effect.Effect<
      void,
      BoundaryError | PlatformError.PlatformError,
      FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        if (visited.has(target.info.name)) return;
        visited.add(target.info.name);
        yield* visit(target.modRoot);
        for (const id of target.development.companions ?? [])
          yield* include(
            yield* resolveProject(project.repoRoot, id, project.repoRoot),
          );
      });
    yield* include(project);
    return [...files].sort();
  });
}
export function sourceSeal(project: ResolvedProject) {
  return Effect.gen(function* () {
    const sorted: Record<string, string> = {};
    for (const name of yield* sourceFiles(project))
      sorted[name] = yield* hashFile(join(project.repoRoot, name));
    const mod = { name: project.info.name, version: project.info.version };
    return yield* decode(
      SourceSeal,
      {
        schema: 1,
        mod,
        files: sorted,
        sha256: new Bun.CryptoHasher("sha256")
          .update(JSON.stringify({ schema: 1, mod, files: sorted }))
          .digest("hex"),
      },
      "source seal",
    );
  });
}
export function verifySourceSeal(
  expected: typeof SourceSeal.Type,
  actual: typeof SourceSeal.Type,
) {
  if (
    expected.mod.name !== actual.mod.name ||
    expected.mod.version !== actual.mod.version ||
    expected.sha256 !== actual.sha256 ||
    JSON.stringify(expected.files) !== JSON.stringify(actual.files)
  )
    return Effect.fail(
      new BoundaryError({
        boundary: expected.mod.name,
        message:
          "Selected, shared or companion source inputs changed; verification/release evidence is stale",
      }),
    );
  return Effect.void;
}
