import { Effect, FileSystem, Schema } from "effect";
import { join, relative, resolve } from "node:path";
import { AbsolutePath, TypesRequest } from "./contracts.ts";
import {
  BoundaryError,
  decode,
  ModId,
  prepareOutputDirectory,
  readJSON,
  RelativePath,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import {
  dependencyPin,
  luaTypeRequirements,
  satisfies,
  resolveDependency,
  requirements,
} from "./dependencies.ts";
import { prepareTypes } from "./types.ts";
import { runCommand } from "./commands.ts";
import { packageInventory } from "./packaging.ts";
import { RunId } from "./logs.ts";
import { sourceFiles } from "./source.ts";
import { resolveLuaTools } from "./lua-tools.ts";
import { resolveApi } from "./api.ts";
const NoLua = Schema.Struct({
  mod: ModId,
  status: Schema.Literal("not-applicable"),
  reason: Schema.NonEmptyString,
});
const LuaPassed = Schema.Struct({
  mod: ModId,
  status: Schema.Literal("passed"),
  runId: RunId,
  files: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  ),
});
export const LuaCheckResult = Schema.Union([
  NoLua,
  Schema.Struct({
    ...LuaPassed.fields,
    toolFixtures: Schema.NullOr(
      Schema.Struct({
        runId: RunId,
        files: LuaPassed.fields.files,
      }),
    ),
  }),
]);
export const LuaTypecheckResult = Schema.Union([
  NoLua,
  Schema.Struct({
    ...LuaPassed.fields,
    negativeControl: Schema.Literal("invalid-engine-call-rejected"),
  }),
]);

const EmmyConfig = Schema.Struct({
  $schema: Schema.NonEmptyString,
  runtime: Schema.Struct({
    version: Schema.Literal("Lua5.2"),
    requirePattern: Schema.Array(Schema.NonEmptyString),
  }),
  strict: Schema.Struct({
    requirePath: Schema.Boolean,
    arrayIndex: Schema.Boolean,
  }),
  workspace: Schema.Struct({
    ignoreDir: Schema.Array(RelativePath),
    ignoreGlobs: Schema.Array(Schema.NonEmptyString),
    library: Schema.Array(RelativePath),
    moduleMap: Schema.Array(
      Schema.Struct({ pattern: Schema.NonEmptyString, replace: Schema.String }),
    ),
  }),
});
const GeneratedEmmyConfig = Schema.Struct({
  ...EmmyConfig.fields,
  workspace: Schema.Struct({
    ...EmmyConfig.fields.workspace.fields,
    ignoreDir: Schema.Array(AbsolutePath),
    library: Schema.Array(AbsolutePath),
  }),
});
const Position = Schema.Struct({
  line: Schema.Int,
  column: Schema.optionalKey(Schema.Int),
  character: Schema.optionalKey(Schema.Int),
});
const EmmyReport = Schema.Array(
  Schema.Struct({
    file: Schema.NonEmptyString,
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.NonEmptyString,
        message: Schema.String,
        range: Schema.Struct({ start: Position, end: Position }),
      }),
    ),
  }),
);
export function lintProject(project: ResolvedProject) {
  return Effect.gen(function* () {
    const prefix = relative(project.repoRoot, project.modRoot) + "/";
    const inventory = yield* sourceFiles(project);
    const files = inventory
      .filter(
        (path) =>
          path.startsWith(prefix) &&
          path.endsWith(".lua") &&
          !path.startsWith(prefix + "types/"),
      )
      .map((path) => relative(project.modRoot, join(project.repoRoot, path)));
    if (files.length === 0)
      return yield* decode(
        LuaCheckResult,
        {
          mod: project.info.name,
          status: "not-applicable",
          reason: "No authored runtime, test or tuner Lua sources",
        },
        "lint result",
      );
    const tools = yield* resolveLuaTools(project),
      cache = tools.cache;
    const env = {
      LUA_PATH: `${cache}/luacheck-1.2.0/src/?.lua;${cache}/luacheck-1.2.0/src/?/init.lua;${cache}/argparse-0.7.1/src/?.lua;;`,
      LUA_CPATH: `${cache}/?.so;;`,
    };
    const shared = inventory.filter(
      (path) =>
        path.startsWith("tools/") &&
        !path.startsWith("tools/types/") &&
        path.endsWith(".lua"),
    );
    const toolFixtures =
      shared.length === 0
        ? null
        : {
            runId: (yield* runCommand(
              project,
              "lint-tool-fixtures",
              [
                "lua",
                join(cache, "luacheck-1.2.0/bin/luacheck.lua"),
                "--codes",
                "--no-default-config",
                "--",
                ...shared.map((path) =>
                  relative(
                    join(project.repoRoot, "tools"),
                    join(project.repoRoot, path),
                  ),
                ),
              ],
              { cwd: join(project.repoRoot, "tools"), env },
            )).run.runId,
            files: shared.length,
          };
    const result = yield* runCommand(
      project,
      "lint",
      [
        "lua",
        join(cache, "luacheck-1.2.0/bin/luacheck.lua"),
        "--codes",
        "--no-default-config",
        "--",
        ...files,
      ],
      { cwd: project.modRoot, env },
    );
    return yield* decode(
      LuaCheckResult,
      {
        mod: project.info.name,
        status: "passed",
        runId: result.run.runId,
        files: files.length,
        toolFixtures,
      },
      "lint result",
    );
  });
}
export function typecheckProject(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (
      !(yield* packageInventory(project)).some((path) => path.endsWith(".lua"))
    )
      return yield* decode(
        LuaTypecheckResult,
        {
          mod: project.info.name,
          status: "not-applicable",
          reason: "No packaged Lua sources",
        },
        "typecheck result",
      );
    const api = yield* resolveApi(project);
    const config = yield* readJSON(
      EmmyConfig,
      join(project.modRoot, ".emmyrc.json"),
    );
    const tools = yield* resolveLuaTools(project);
    const directory = join(project.outputRoot, "types", crypto.randomUUID());
    yield* prepareOutputDirectory(directory);
    const typeRequirements = luaTypeRequirements(yield* requirements(project));
    let flib: (typeof TypesRequest.Type)["flib"] = null;
    if (typeRequirements.length > 0) {
      const pin = yield* dependencyPin("flib");
      if (
        typeRequirements.some(
          (requirement) => !satisfies(pin.version, requirement),
        )
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: project.info.name,
            message:
              "Pinned flib type library contradicts the declared dependency",
          }),
        );
      flib = {
        archive: yield* resolveDependency(project, pin),
        sha256: pin.sha256,
        version: pin.version,
        styleType: project.development.flibStyleType ?? null,
      };
    }
    const types = yield* prepareTypes(project, {
      overlay: join(directory, "overlay"),
      api,
      storageType: project.development.storageType ?? null,
      flib,
    });
    const generatedConfig = yield* decode(
      GeneratedEmmyConfig,
      {
        ...config,
        workspace: {
          ...config.workspace,
          ignoreDir: config.workspace.ignoreDir.map((path) =>
            resolve(project.modRoot, path),
          ),
          library: [
            types.library,
            ...types.dependencies,
            join(project.repoRoot, "tools", "types"),
            ...config.workspace.library.map((path) =>
              resolve(project.modRoot, path),
            ),
          ],
        },
      },
      "resolved EmmyLua configuration",
    );
    const configPath = join(directory, "emmy.json"),
      reportPath = join(directory, "report.json");
    yield* fs.writeFileString(
      configPath,
      JSON.stringify(generatedConfig, null, 2),
    );
    const checker = join(tools.cache, "emmylua_check");
    const result = yield* runCommand(project, "typecheck", [
      checker,
      project.modRoot,
      "-c",
      configPath,
      "-f",
      "json",
      "--output",
      reportPath,
      "--warnings-as-errors",
      "--severity",
      "warn",
    ]);
    const report = yield* readJSON(EmmyReport, reportPath, true);
    if (report.some((file) => file.diagnostics.length > 0))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Type checker reported diagnostics despite a successful exit",
        }),
      );
    const probeDirectory = join(directory, "negative-control"),
      probe = join(probeDirectory, "invalid-call.lua"),
      positiveProbe = join(probeDirectory, "guarded-gui.lua"),
      probeReport = join(directory, "negative-control.json");
    yield* fs.makeDirectory(probeDirectory);
    yield* fs.writeFileString(
      probe,
      'local surface = game.surfaces[1]\nif surface then surface.create_entity({name="transport-belt", position="invalid-position"}) end\nlocal player = game.get_player(1)\nif player then\n local name = "missing-child"\n local child = player.gui.screen[name]\n child.destroy()\nend\n',
    );
    yield* fs.writeFileString(
      positiveProbe,
      'local player = game.get_player(1)\nif player then\n local name = "optional-child"\n local child = player.gui.screen[name]\n if child then child.destroy() end\nend\n',
    );
    yield* runCommand(
      project,
      "typecheck-negative-control",
      [
        checker,
        probeDirectory,
        "-c",
        configPath,
        "-f",
        "json",
        "--output",
        probeReport,
        "--warnings-as-errors",
        "--severity",
        "warn",
      ],
      { allowedExitCodes: [1] },
    );
    const negative = yield* readJSON(EmmyReport, probeReport, true);
    if (
      !negative.some(
        (file) =>
          file.file === probe &&
          file.diagnostics.some((issue) =>
            ["param-type-mismatch", "assign-type-mismatch"].includes(
              issue.code,
            ),
          ) &&
          file.diagnostics.some(
            (issue) =>
              issue.code === "need-check-nil" && issue.range.start.line === 6,
          ),
      )
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Type checker did not diagnose both invalid API arguments and unguarded GUI child access",
        }),
      );
    const positive = negative.find((file) => file.file === positiveProbe);
    if (!positive || positive.diagnostics.length !== 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Type checker rejected or omitted guarded dynamic GUI child access",
        }),
      );
    return yield* decode(
      LuaTypecheckResult,
      {
        mod: project.info.name,
        status: "passed",
        runId: result.run.runId,
        files: report.length,
        negativeControl: "invalid-engine-call-rejected",
      },
      "typecheck result",
    );
  });
}
