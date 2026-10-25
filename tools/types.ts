import { Effect, Exit, FileSystem } from "effect";
import { dirname, join } from "node:path";
import { TypesRequest, TypesResult } from "./contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  prepareOutputDirectory,
} from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";
import { inventoryFiles, verifyPinnedFile } from "./files.ts";
import { runCommand } from "./commands.ts";
import { withZip } from "./archives.ts";

function generateTypes(
  project: ExecutionContext,
  api: typeof TypesRequest.Type.api,
) {
  return Effect.gen(function* () {
    const directory = join(
      project.repoRoot,
      ".factorio-test/workspace/types",
      crypto.randomUUID(),
    );
    const fs = yield* FileSystem.FileSystem;
    yield* prepareOutputDirectory(dirname(directory));
    return yield* Effect.acquireUseRelease(
      fs.makeDirectory(directory),
      () =>
        Effect.gen(function* () {
          yield* runCommand(project, "prepare-types-fmtk", [
            process.execPath,
            join(
              project.repoRoot,
              "node_modules/factoriomod-debug/dist/fmtk-cli.js",
            ),
            "docs",
            "--docs",
            api.runtime.path,
            "--protos",
            api.prototype.path,
            "--docbase",
            "https://lua-api.factorio.com/" + api.version,
            directory,
          ]);
          for (const pin of [api.runtime, api.prototype])
            yield* verifyPinnedFile(pin, "mise run setup");
          return { directory, files: yield* inventoryFiles(directory) };
        }),
      (_resource, exit) =>
        Exit.isFailure(exit)
          ? Effect.gen(function* () {
              yield* assertCanonicalPath(directory);
              yield* fs.remove(directory, { recursive: true });
            }).pipe(Effect.orDie)
          : Effect.void,
    );
  });
}

/** Invocation-local immutable generation; every product receives its own patched overlay. */
export function makeTypePreparer() {
  const generations = new Map<string, ReturnType<typeof generateTypes>>();
  return function prepareTypes(project: ExecutionContext, input: unknown) {
    return Effect.gen(function* () {
      const request = yield* decode(TypesRequest, input, "type preparation");
      const fs = yield* FileSystem.FileSystem,
        { api, overlay, flib } = request;
      for (const pin of [api.runtime, api.prototype])
        yield* verifyPinnedFile(pin, "mise run setup");
      yield* assertCanonicalPath(overlay);
      return yield* Effect.acquireUseRelease(
        fs.makeDirectory(overlay),
        () =>
          Effect.gen(function* () {
            const generated = join(overlay, "factorio-" + api.version),
              library = join(generated, "factorio/library");
            const key = JSON.stringify([
              project.repoRoot,
              api.version,
              api.runtime.sha256,
              api.prototype.sha256,
            ]);
            let generation = generations.get(key);
            if (generation === undefined) {
              generation = yield* Effect.cached(generateTypes(project, api));
              generations.set(key, generation);
            }
            const base = yield* generation;
            if (
              JSON.stringify(yield* inventoryFiles(base.directory)) !==
              JSON.stringify(base.files)
            )
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: base.directory,
                  message:
                    "Generated type inputs changed within this invocation",
                }),
              );
            yield* fs.copy(base.directory, generated);
            if (
              JSON.stringify(yield* inventoryFiles(generated)) !==
              JSON.stringify(base.files)
            )
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: generated,
                  message: "Copied type inputs do not match their generation",
                }),
              );
            for (const pin of [api.runtime, api.prototype])
              yield* verifyPinnedFile(pin, "mise run setup");
            function rewrite(path: string, change: (source: string) => string) {
              return Effect.gen(function* () {
                yield* assertCanonicalPath(path);
                const source = yield* fs.readFile(path);
                const updated = yield* Effect.try({
                  try: () =>
                    change(
                      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
                        .decode(source)
                        .replace(/\r\n?/g, "\n"),
                    ),
                  catch: (error) =>
                    new BoundaryError({
                      boundary: path,
                      message: String(error),
                    }),
                });
                yield* fs.writeFileString(path, updated);
                return updated;
              });
            }
            // Native dictionary lookups can return nil; FMTK's table types omit it.
            yield* rewrite(
              join(library, "runtime-api/LuaBootstrap.lua"),
              (source) =>
                source.replaceAll(
                  "table<string,string>",
                  "table<string,string?>",
                ),
            );
            for (const name of ["LuaPrototypes", "LuaGameScript"])
              yield* rewrite(
                join(library, `runtime-api/${name}.lua`),
                (source) =>
                  source.replace(/table<([^,>]+),([^>]+)>/g, "table<$1,$2?>"),
              );
            const guiSource = yield* rewrite(
              join(library, "runtime-api/LuaGuiElement.lua"),
              (source) => {
                const header =
                    "---@class LuaGuiElement:LuaObject.base, LuaGuiElement_funcs",
                  index = "---@field [(string)|(uint)] LuaGuiElement";
                if (
                  source.indexOf(header) < 0 ||
                  source.indexOf(header) !== source.lastIndexOf(header) ||
                  source.indexOf(index) < 0 ||
                  source.indexOf(index) !== source.lastIndexOf(index)
                )
                  throw new Error(
                    "Generated GUI index declaration changed; review the adapter",
                  );
                return source
                  .replace(
                    header,
                    header + ", table<string|integer,LuaGuiElement?>",
                  )
                  .replace(index, "");
              },
            );
            yield* rewrite(join(library, "data/mods.lua"), (source) =>
              source.replaceAll("{[string]: string}", "{[string]: string?}"),
            );
            if (request.storageType !== null)
              yield* rewrite(join(library, "runtime/storage.lua"), (source) =>
                source.replaceAll(
                  "---@type table",
                  "---@type " + request.storageType,
                ),
              );
            const dependencies: string[] = [];
            if (flib !== null) {
              const prefix = "flib_" + flib.version,
                dependencyRoot = join(overlay, "dependencies");
              yield* withZip(
                { archive: flib.archive, sha256: flib.sha256 },
                (zip) =>
                  Effect.gen(function* () {
                    for (const member of zip.members) {
                      if (
                        member.name !== prefix &&
                        !member.name.startsWith(prefix + "/")
                      )
                        return yield* Effect.fail(
                          new BoundaryError({
                            boundary: member.name,
                            message: "Unexpected flib archive root",
                          }),
                        );
                      if (member.directory || !member.name.endsWith(".lua"))
                        continue;
                      const target = join(dependencyRoot, member.name),
                        bytes = yield* zip.read(member.name, member.size);
                      yield* prepareOutputDirectory(dirname(target));
                      yield* fs.writeFile(target, bytes, { flag: "wx" });
                    }
                  }),
              );
              dependencies.push(join(dependencyRoot, prefix));
              yield* rewrite(
                join(dependencyRoot, prefix, "gui.lua"),
                (source) => {
                  if (flib.styleType !== null)
                    source = source.replaceAll(
                      "style_mods LuaStyle?",
                      "style_mods " + flib.styleType + "?",
                    );
                  // EmmyLua cannot model LuaLS union inheritance; retain all native fields.
                  source = source.replace(
                    /--- @class flib\.GuiElemDef:.*/g,
                    "--- @class flib.GuiElemDef",
                  );
                  const fields = new Map<string, Set<string>>();
                  let active = false;
                  for (const line of guiSource.split("\n")) {
                    if (line.startsWith("---@class"))
                      active = line.includes("LuaGuiElement.add_param.");
                    if (!active || !line.startsWith("---@field ")) continue;
                    const match = /^---@field (\w+)\?? (.+)/.exec(line);
                    if (match !== null) {
                      let types = fields.get(match[1]!);
                      if (types === undefined) {
                        types = new Set();
                        fields.set(match[1]!, types);
                      }
                      types.add(match[2]!);
                    }
                  }
                  const definitions = [...fields]
                    .map(
                      ([name, types]) =>
                        "--- @field " +
                        name +
                        (name === "type" ? " " : "? ") +
                        [...types]
                          .sort()
                          .map((type) => "(" + type + ")")
                          .join("|"),
                    )
                    .join("\n");
                  return source.replaceAll(
                    "--- @class flib.GuiElemDef",
                    "--- @class flib.GuiElemDef\n" + definitions,
                  );
                },
              );
            }
            return yield* decode(
              TypesResult,
              {
                schema: 1,
                version: api.version,
                base: base.directory,
                library,
                dependencies,
              },
              "prepared type overlay",
            );
          }),
        (_resource, exit) =>
          Exit.isFailure(exit)
            ? Effect.gen(function* () {
                yield* assertCanonicalPath(overlay);
                yield* fs.remove(overlay, { recursive: true });
              }).pipe(Effect.orDie)
            : Effect.void,
      );
    });
  };
}
