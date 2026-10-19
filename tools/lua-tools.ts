import { Effect, Exit, FileSystem } from "effect";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { LuaToolsRequest, LuaToolsResult } from "./contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  prepareOutputDirectory,
  readJSON,
} from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";
import { hashFile, inventoryFiles, provisionPinnedFile } from "./files.ts";
import { getBytes } from "./network.ts";
import { withOwnedLock } from "./locks.ts";
import { runCommand } from "./commands.ts";
import { archiveLimits } from "./archives.ts";
import { readTar } from "./tar.ts";

const sources: Readonly<Record<string, { url: string; sha256: string }>> = {
  "luacheck-1.2.0": {
    url: "https://codeload.github.com/lunarmodules/luacheck/tar.gz/refs/tags/v1.2.0",
    sha256: "8efe62a7da4fdb32c0c22ec1f7c9306cbc397d7d40493c29988221a059636e25",
  },
  "argparse-0.7.1": {
    url: "https://codeload.github.com/luarocks/argparse/tar.gz/refs/tags/0.7.1",
    sha256: "d344e49404c3e7b3e7fa4fe6741c106f25909d9b24923cb08dcceda1f9754809",
  },
  "luafilesystem-1_8_0": {
    url: "https://codeload.github.com/lunarmodules/luafilesystem/tar.gz/refs/tags/v1_8_0",
    sha256: "16d17c788b8093f2047325343f5e9b74cccb1ea96001e45914a58bbae8932495",
  },
};
const targets: Readonly<Record<string, { target: string; sha256: string }>> = {
  "darwin-arm64": {
    target: "darwin-arm64",
    sha256: "eeaad59d173cb8d7cb0fe778936d7b584fe114a3eb46587ef3e4aec24b605af4",
  },
  "darwin-x64": {
    target: "darwin-x64",
    sha256: "e91fe82c361d8dece8e2ce9aeb2313b8809b4714f72bbbeab5a27e754d8de2c6",
  },
  "linux-arm64": {
    target: "linux-aarch64-glibc2.17",
    sha256: "62a9a56d3ff5d0e108909332cb91582a0c1a4ebbfdce1a4422e7ae74d4a7f8b1",
  },
  "linux-x64": {
    target: "linux-x64-glibc2.17",
    sha256: "e4a700af4921e2d908e2f7299eaa86e3e1b3b265e27225ab33c7eb03ebc2187d",
  },
};
// These sources and the lockfile determine archive policy and built bytes.
const builderFiles = [
  "tools/lua-tools.ts",
  "tools/archives.ts",
  "tools/tar.ts",
  "tools/files.ts",
  "tools/contracts.ts",
  "tools/projects.ts",
  "bun.lock",
];
function inputs(project: ExecutionContext) {
  return Effect.gen(function* () {
    const platform = process.platform + "-" + process.arch;
    const emmy = targets[platform];
    if (!emmy)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: platform,
          message: "No reviewed Lua tool archive for this platform",
        }),
      );
    const builder = new Map<string, string>();
    for (const name of builderFiles) {
      const path = join(project.repoRoot, name);
      yield* assertCanonicalPath(path);
      builder.set(name, yield* hashFile(path));
    }
    const inputSha256 = new Bun.CryptoHasher("sha256")
      .update(
        JSON.stringify({
          platform,
          sources,
          emmy,
          bun: Bun.version,
          bunRevision: Bun.revision,
          builder: Object.fromEntries(builder),
        }),
      )
      .digest("hex");
    const root = join(project.repoRoot, ".factorio-test/cache/lua");
    const archive = (name: string, sha256: string) => ({
      path: join(root, "archives", name + "-" + sha256 + ".tar.gz"),
      sha256,
      maxBytes: 128 * 1024 * 1024,
    });
    const request = yield* decode(
      LuaToolsRequest,
      {
        cache: join(root, platform, inputSha256),
        inputSha256,
        sources: Object.fromEntries(
          Object.entries(sources).map(([name, pin]) => [
            name,
            archive(name, pin.sha256),
          ]),
        ),
        emmy: archive("emmylua_check-" + emmy.target, emmy.sha256),
      },
      "Lua tool build inputs",
    );
    return {
      request,
      emmyUrl: `https://github.com/EmmyLuaLs/emmylua-analyzer-rust/releases/download/0.25.1/emmylua_check-${emmy.target}.tar.gz`,
    };
  });
}
function buildLuaTools(
  project: ExecutionContext,
  request: typeof LuaToolsRequest.Type,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* assertCanonicalPath(request.cache);
    if ((yield* fs.readDirectory(request.cache)).length !== 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.cache,
          message: "Build requires an empty owned cache",
        }),
      );
    const limits = {
      ...archiveLimits,
      expandedBytes: 128 * 1024 * 1024,
      entryBytes: 128 * 1024 * 1024,
    };
    for (const [root, pin] of Object.entries(request.sources)) {
      const files = yield* readTar(
        { pin, root, limits },
        (entry) => !entry.directory,
      );
      for (const [name, bytes] of files) {
        const target = join(request.cache, name);
        yield* prepareOutputDirectory(dirname(target));
        yield* fs.writeFile(target, bytes, { flag: "wx" });
      }
    }
    const luaPath = Bun.which("lua"),
      compilerPath = Bun.which(process.env.CC ?? "cc");
    if (luaPath === null || compilerPath === null)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Lua provisioning",
          message: "Explicit setup requires Lua 5.2.4 and a C compiler on PATH",
        }),
      );
    const lua = yield* fs.realPath(luaPath),
      compiler = yield* fs.realPath(compilerPath);
    const luaExecutableSha256 = yield* hashFile(lua),
      compilerExecutableSha256 = yield* hashFile(compiler);
    const luaVersion = yield* runCommand(
      project,
      "lua-build-version",
      [lua, "-v"],
      { deadlineMs: 30000 },
    );
    if (!(luaVersion.stdout + luaVersion.stderr).startsWith("Lua 5.2.4"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: lua,
          message: "Expected Lua 5.2.4 for native tool compilation",
        }),
      );
    const compilerVersion = yield* runCommand(
      project,
      "lua-build-compiler",
      [compiler, "--version"],
      { deadlineMs: 30000 },
    );
    const flags =
      process.platform === "darwin"
        ? ["-bundle", "-undefined", "dynamic_lookup"]
        : ["-shared", "-fPIC"];
    yield* runCommand(
      project,
      "lua-build-filesystem",
      [
        compiler,
        "-O2",
        ...flags,
        "-I" + join(dirname(dirname(lua)), "include"),
        join(request.cache, "luafilesystem-1_8_0/src/lfs.c"),
        "-o",
        join(request.cache, "lfs.so"),
      ],
      { deadlineMs: 120000 },
    );
    if (
      (yield* hashFile(lua)) !== luaExecutableSha256 ||
      (yield* hashFile(compiler)) !== compilerExecutableSha256
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.cache,
          message:
            "Native compiler or Lua executable changed during provisioning",
        }),
      );
    const emmy = (yield* readTar(
      { pin: request.emmy, limits },
      (entry) => entry.name === "emmylua_check",
    )).get("emmylua_check");
    if (emmy === undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.emmy.path,
          message: "EmmyLua archive has no unique bounded executable",
        }),
      );
    const executable = join(request.cache, "emmylua_check");
    yield* fs.writeFile(executable, emmy, { flag: "wx" });
    yield* fs.chmod(executable, 0o755);
    return yield* decode(
      LuaToolsResult,
      {
        schema: 3,
        cache: request.cache,
        inputSha256: request.inputSha256,
        luacheck: "1.2.0",
        emmy: "0.25.1",
        lua: "5.2.4",
        build: {
          compiler: compilerVersion.stdout.trim(),
          compilerExecutableSha256,
          luaExecutableSha256,
          bun: Bun.version,
          bunRevision: Bun.revision,
        },
        files: yield* inventoryFiles(request.cache),
      },
      "built Lua tools",
    );
  });
}
function validate(
  request: typeof LuaToolsRequest.Type,
  result: typeof LuaToolsResult.Type,
) {
  return Effect.gen(function* () {
    if (
      result.cache !== request.cache ||
      result.inputSha256 !== request.inputSha256 ||
      !isDeepStrictEqual(result.files, yield* inventoryFiles(request.cache))
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.cache,
          message:
            "Lua tool identity or complete file inventory differs; no implicit repair is allowed",
        }),
      );
    const fs = yield* FileSystem.FileSystem;
    if (
      ((yield* fs.stat(join(request.cache, "emmylua_check"))).mode & 0o111) ===
      0
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.cache,
          message: "Provisioned EmmyLua is not executable",
        }),
      );
    return result;
  });
}
function readTools(request: typeof LuaToolsRequest.Type) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      manifest = request.cache + ".json";
    yield* assertCanonicalPath(manifest);
    if (!(yield* fs.exists(manifest)))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: request.cache,
          message: "Pinned Lua tools are not provisioned; run mise run setup",
        }),
      );
    return yield* validate(request, yield* readJSON(LuaToolsResult, manifest));
  });
}
export function resolveLuaTools(project: ExecutionContext) {
  return Effect.gen(function* () {
    return yield* readTools((yield* inputs(project)).request);
  });
}
export function provisionLuaTools(project: ExecutionContext) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { request, emmyUrl } = yield* inputs(project);
    return yield* withOwnedLock(
      request.cache + ".lock",
      "Lua tool build",
      Effect.gen(function* () {
        if (
          (yield* fs.exists(request.cache)) ||
          (yield* fs.exists(request.cache + ".json"))
        )
          return yield* readTools(request);
        for (const [name, pin] of Object.entries(request.sources))
          yield* provisionPinnedFile(
            pin,
            getBytes(sources[name]!.url, name, pin.maxBytes, {
              origin: "github-source",
              redirects: false,
            }),
          );
        yield* provisionPinnedFile(
          request.emmy,
          getBytes(emmyUrl, "EmmyLua", request.emmy.maxBytes, {
            origin: "github-release",
            redirects: true,
          }),
        );
        yield* prepareOutputDirectory(request.cache);
        const manifest = request.cache + ".json",
          temporary = manifest + ".part";
        return yield* Effect.gen(function* () {
          const result = yield* buildLuaTools(project, request);
          if (
            (yield* inputs(project)).request.inputSha256 !== request.inputSha256
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: request.cache,
                message: "Lua builder changed during provisioning",
              }),
            );
          yield* validate(request, result);
          yield* fs.writeFileString(
            temporary,
            JSON.stringify(result, null, 2) + "\n",
            { flag: "wx" },
          );
          yield* fs.rename(temporary, manifest);
          return result;
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.gen(function* () {
                  yield* fs.remove(temporary, { force: true });
                  yield* fs.remove(manifest, { force: true });
                  yield* fs.remove(request.cache, { recursive: true });
                }).pipe(Effect.orDie)
              : Effect.void,
          ),
        );
      }),
    );
  });
}
