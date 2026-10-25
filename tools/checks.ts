import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import {
  BoundaryError,
  decode,
  discoverProjects,
  ModId,
  readJSON,
} from "./projects.ts";
import type { ExecutionContext, ResolvedProject } from "./projects.ts";
import { runCommand } from "./commands.ts";
import { RunId } from "./logs.ts";
import { rejectTrunkUserOverrides, trunkCommand } from "./quality.ts";
import { LuaToolsResult } from "./contracts.ts";
import { provisionLuaTools } from "./lua-tools.ts";
import { ApiProvisionResult, provisionApi } from "./api.ts";
import { invokeProjectTool, projectTooling } from "./project-tooling.ts";
export const CommandCheck = Schema.Struct({
  status: Schema.Literal("passed"),
  runId: RunId,
});

const Manifest = Schema.Struct({
  devDependencies: Schema.Record(Schema.String, Schema.NonEmptyString),
});
const Mise = Schema.Struct({
  tools: Schema.Record(Schema.String, Schema.NonEmptyString),
});
export const Toolchain = Schema.Struct({
  bun: Schema.NonEmptyString,
  packages: Schema.Record(Schema.String, Schema.NonEmptyString),
  native: Schema.Record(
    Schema.String,
    Schema.Struct({ version: Schema.NonEmptyString, runId: RunId }),
  ),
});
const SetupResult = Schema.Struct({
  toolchain: Toolchain,
  lua: LuaToolsResult,
  api: Schema.Array(ApiProvisionResult),
  extensions: Schema.Array(
    Schema.Struct({ mod: ModId, setup: Schema.Boolean }),
  ),
});
export function setupWorkspace(project: ExecutionContext) {
  return Effect.gen(function* () {
    const toolchain = yield* checkToolchain(project);
    const projects = yield* discoverProjects(project.repoRoot);
    return yield* decode(
      SetupResult,
      {
        toolchain,
        lua: yield* provisionLuaTools(project),
        api: yield* Effect.forEach(projects, provisionApi),
        extensions: yield* Effect.forEach(projects, (selected) =>
          Effect.gen(function* () {
            const { setup } = yield* projectTooling(selected);
            if (setup !== undefined)
              yield* invokeProjectTool(
                setup,
                selected,
                `${selected.info.name} setup`,
              );
            return { mod: selected.info.name, setup: setup !== undefined };
          }),
        ),
      },
      "workspace setup result",
    );
  });
}
export function checkToolchain(project: ExecutionContext) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      manifest = yield* readJSON(
        Manifest,
        join(project.repoRoot, "package.json"),
        true,
      );
    yield* rejectTrunkUserOverrides(project);
    const text = yield* fs.readFileString(
      join(project.repoRoot, ".config/mise.toml"),
    );
    const parsed = yield* Effect.try({
      try: (): unknown => Bun.TOML.parse(text),
      catch: () =>
        new BoundaryError({
          boundary: "Mise tool pins",
          message: "Invalid TOML",
        }),
    });
    const pins = yield* decode(Mise, parsed, "Mise tool pins", true);
    if (Bun.version !== pins.tools.bun)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Bun",
          message: `Run with the repository-pinned Bun ${pins.tools.bun}; actual ${Bun.version}`,
        }),
      );
    const packages: Record<string, string> = {};
    for (const [name, version] of Object.entries(manifest.devDependencies)) {
      const installed = yield* readJSON(
        Schema.Struct({ name: Schema.String, version: Schema.String }),
        join(project.repoRoot, "node_modules", name, "package.json"),
        true,
      );
      if (installed.name !== name || installed.version !== version)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: name,
            message:
              "Installed package does not match its exact root pin; run the explicit bootstrap command",
          }),
        );
      packages[name] = installed.version;
    }
    const trunkText = yield* fs.readFileString(
      join(project.repoRoot, ".trunk", "trunk.yaml"),
    );
    const trunk = yield* decode(
      Schema.Struct({ cli: Schema.Struct({ version: Schema.NonEmptyString }) }),
      yield* Effect.try({
        try: (): unknown => Bun.YAML.parse(trunkText),
        catch: () =>
          new BoundaryError({
            boundary: "Trunk configuration",
            message: "Invalid YAML",
          }),
      }),
      "Trunk CLI pin",
      true,
    );
    const native: Record<string, { version: string; runId: string }> = {};
    const commands: ReadonlyArray<readonly [string, string, string[]]> = [
      ["trunk", trunk.cli.version, ["--version"]],
      ["lua", pins.tools.lua!, ["-v"]],
      ["stylua", pins.tools.stylua!, ["--version"]],
      ["shellcheck", pins.tools.shellcheck!, ["--version"]],
      ["shfmt", pins.tools.shfmt!, ["--version"]],
      ["actionlint", pins.tools.actionlint!, ["-version"]],
      ["hadolint", pins.tools.hadolint!, ["--version"]],
      [
        "betterleaks",
        pins.tools["github:betterleaks/betterleaks"]!,
        ["--version"],
      ],
    ];
    for (const [name, expected, args] of commands) {
      const result = yield* runCommand(project, "tool-version-" + name, [
        ...(name === "trunk" ? trunkCommand : [name]),
        ...args,
      ]);
      const actual = (result.stdout + "\n" + result.stderr).match(
        /\bv?([0-9]+\.[0-9]+\.[0-9]+)\b/,
      )?.[1];
      if (!expected || actual !== expected)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: name,
            message: `Expected pinned version ${expected}; observed ${actual ?? "unrecognized output"}`,
          }),
        );
      native[name] = { version: actual, runId: result.run.runId };
    }
    return yield* decode(
      Toolchain,
      { bun: Bun.version, packages, native },
      "verified toolchain",
    );
  });
}
export const BunTestResult = Schema.Struct({
  runId: RunId,
  passed: Schema.Int,
  failed: Schema.Literal(0),
  skipped: Schema.Literal(0),
  todo: Schema.Literal(0),
});
export function runBunTests(
  project: ExecutionContext,
  paths: readonly string[],
  profile: string,
) {
  return Effect.gen(function* () {
    if (paths.length === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "No test files selected",
        }),
      );
    const result = yield* runCommand(project, profile, [
      process.execPath,
      "test",
      "--parallel=2",
      ...paths,
    ]);
    const output = result.stdout + "\n" + result.stderr;
    const passed = output.match(/^\s*([0-9]+) pass\s*$/m),
      failed = output.match(/^\s*([0-9]+) fail\s*$/m);
    if (!passed || !failed || Number(passed[1]) === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Pinned Bun did not report a non-empty completed test run",
        }),
      );
    return yield* decode(
      BunTestResult,
      {
        runId: result.run.runId,
        passed: Number(passed[1]),
        failed: Number(failed[1]),
        skipped: Number(output.match(/^\s*([0-9]+) skip\s*$/m)?.[1] ?? 0),
        todo: Number(output.match(/^\s*([0-9]+) todo\s*$/m)?.[1] ?? 0),
      },
      "Bun test result",
    );
  });
}
export const ModelResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("not-applicable"),
    reason: Schema.NonEmptyString,
  }),
  Schema.Struct({ status: Schema.Literal("passed"), ...BunTestResult.fields }),
]);
export function testModels(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      directory = join(project.modRoot, "dev");
    const files = (yield* fs.exists(directory))
      ? (yield* fs.readDirectory(directory))
          .filter((name) => /\.test\.(?:ts|mjs)$/.test(name))
          .sort()
          .map((name) => join(directory, name))
      : [];
    if (files.length === 0)
      return yield* decode(
        ModelResult,
        {
          status: "not-applicable",
          reason: "No project-owned offline model test files",
        },
        "model test result",
      );
    return yield* decode(
      ModelResult,
      {
        status: "passed",
        ...(yield* runBunTests(project, files, "test-model")),
      },
      "model test result",
    );
  });
}
