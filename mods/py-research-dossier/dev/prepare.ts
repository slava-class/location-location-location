import { Effect, FileSystem, Schema } from "effect";
import { join, resolve } from "node:path";
import { AbsolutePath, Sha256 } from "../../../tools/contracts.ts";
import { withZip } from "../../../tools/archives.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  decodeJSON,
  ModId,
  prepareOutputDirectory,
  readJSON,
  RelativePath,
  Version,
} from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import { GameSources } from "./contracts.ts";
import { extractDescriptionHelper } from "./py-helper.ts";
import { sha256 } from "./lib.mjs";

const Options = Schema.Struct({ mods: AbsolutePath, base: AbsolutePath });
const Identity = Schema.Struct({ name: ModId, version: Version });
const Review = Schema.Struct({
  schema: Schema.Literal(1),
  mods: Schema.Record(
    ModId,
    Schema.Struct({ version: Version, sha256: Schema.optionalKey(Sha256) }),
  ),
  files: Schema.Record(
    Schema.String,
    Schema.Struct({ mod: ModId, path: RelativePath, sha256: Sha256 }),
  ),
  helperSha256: Sha256,
});
export function reviewSources(project: ResolvedProject, input: unknown) {
  return Effect.gen(function* () {
    const options = yield* decode(Options, input, "reviewed source locations");
    const fs = yield* FileSystem.FileSystem;
    const game = yield* readJSON(
      GameSources,
      join(project.modRoot, "content/game-sources.json"),
    );
    const baseInfo = yield* readJSON(
      Identity,
      join(options.base, "info.json"),
      true,
    );
    if (
      baseInfo.name !== "base" ||
      baseInfo.version !== game.reviewedBase.version
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: options.base,
          message:
            "Base source version differs from reviewed corpus provenance",
        }),
      );
    const mods: Record<string, { version: string; sha256?: string }> = {
      base: { version: baseInfo.version },
    };
    const files: Record<string, { mod: string; path: string; sha256: string }> =
      {};
    const sources = new Map<string, Map<string, Buffer>>();
    function member(mod: string, path: string) {
      return Effect.gen(function* () {
        if (mod === "base")
          return yield* fs.readFileString(resolve(options.base, path));
        const bytes = sources.get(mod)?.get(path);
        if (bytes === undefined)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: mod,
              message: "Source file is absent from its reviewed archive",
            }),
          );
        return yield* Effect.try({
          try: () =>
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
              bytes,
            ),
          catch: () =>
            new BoundaryError({
              boundary: path,
              message: "Reviewed source is not UTF-8",
            }),
        });
      });
    }
    for (const [name, reviewed] of Object.entries(game.reviewedMods)) {
      const path = resolve(options.mods, reviewed.archive);
      const wanted = new Set([
        "info.json",
        ...Object.values(game.files)
          .filter((file) => file.mod === name)
          .map((file) => file.path),
      ]);
      const selected = yield* withZip(
        { archive: path, sha256: reviewed.sha256 },
        (zip) =>
          Effect.gen(function* () {
            const bytes = new Map<string, Buffer>();
            for (const member of wanted)
              bytes.set(
                member,
                yield* zip.read(`${reviewed.root}/${member}`, 8 * 1024 * 1024),
              );
            return bytes;
          }),
      );
      sources.set(name, selected);
      const info = yield* decodeJSON(
        Identity,
        new TextEncoder().encode(yield* member(name, "info.json")),
        name + " identity",
        true,
      );
      if (info.name !== name || info.version !== reviewed.version)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message: "Source archive identity differs from the reviewed corpus",
          }),
        );
      mods[name] = { version: info.version, sha256: reviewed.sha256 };
    }
    let helperSha256: string | undefined;
    for (const [id, file] of Object.entries(game.files)) {
      const source = yield* member(file.mod, file.path),
        digest = sha256(source);
      if (file.mod === "base" && digest !== file.sha256)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: file.path,
            message: "Base source bytes differ from reviewed provenance",
          }),
        );
      files[id] = { ...file, sha256: digest };
      if (id === "py-description-helper")
        helperSha256 = sha256(yield* extractDescriptionHelper(source));
    }
    const report = yield* decode(
      Review,
      { schema: 1, mods, files, helperSha256 },
      "reviewed source inventory",
    );
    yield* prepareOutputDirectory(project.outputRoot);
    const output = join(project.outputRoot, "source-manifest.json");
    yield* assertCanonicalPath(output);
    yield* fs.writeFileString(output, JSON.stringify(report, null, 2) + "\n");
    return { output, report };
  });
}
