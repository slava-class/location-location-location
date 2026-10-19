import { Effect, Exit, FileSystem } from "effect";
import { join } from "node:path";
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
import { runHelper } from "./helpers.ts";

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
    const builder = join(project.repoRoot, "tools/setup-lua-tools.py");
    yield* assertCanonicalPath(builder);
    const builderSha256 = yield* hashFile(builder);
    const inputSha256 = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify({ platform, sources, emmy, builderSha256 }))
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
        schema: 2,
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
      builder,
      builderSha256,
      emmyUrl: `https://github.com/EmmyLuaLs/emmylua-analyzer-rust/releases/download/0.25.1/emmylua_check-${emmy.target}.tar.gz`,
    };
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
    const { request, builder, builderSha256, emmyUrl } = yield* inputs(project);
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
          const result = yield* runHelper(
            project,
            "tools/setup-lua-tools.py",
            LuaToolsRequest,
            LuaToolsResult,
            request,
          );
          if ((yield* hashFile(builder)) !== builderSha256)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: builder,
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
