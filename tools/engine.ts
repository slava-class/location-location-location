import { Effect, FileSystem, Schema } from "effect";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AbsolutePath, Sha256 } from "./contracts.ts";
import { BoundaryError, decode, readJSON, Version } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { compareVersions, engineFloor } from "./dependencies.ts";
import { runCommand } from "./commands.ts";
import { hashFile } from "./files.ts";
import { Backend, DockerRuntime } from "./backend.ts";
import { resolveDockerRuntime } from "./docker-runtime.ts";

const Distribution = Schema.Literals(["full", "headless", "steam"]);
const EngineIdentity = Schema.Struct({
  version: Version,
  build: Schema.NonEmptyString,
  platform: Schema.NonEmptyString,
  distribution: Distribution,
});
export const Engine = Schema.Struct({
  executable: AbsolutePath,
  ...EngineIdentity.fields,
  readData: AbsolutePath,
  sha256: Sha256,
  docker: Schema.optionalKey(DockerRuntime),
});
export type ResolvedEngine = typeof Engine.Type;
export function parseEngineVersion(text: string) {
  return Effect.gen(function* () {
    const match =
      /^Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*\(build\s+(\d+),\s*([^,]+),\s*([^)\s]+)\)/m.exec(
        text,
      );
    if (!match)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "engine version",
          message:
            "Factorio returned no supported version/build/platform identity",
        }),
      );
    return yield* decode(
      EngineIdentity,
      {
        version: match[1],
        build: match[2],
        platform: match[3],
        distribution: match[4],
      },
      "engine version",
    );
  });
}
export function resolveEngine(
  project: ResolvedProject,
  mode: "headless" | "native",
  override?: string,
  backend: typeof Backend.Type = "native",
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const selectedBackend = yield* decode(Backend, backend, "engine backend");
    if (
      selectedBackend === "docker" &&
      (mode !== "headless" || override !== undefined)
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "engine selection",
          message:
            "Docker supports headless execution with its provisioned engine only; native rendering and --engine require the native backend",
        }),
      );
    const docker =
      selectedBackend === "docker"
        ? yield* resolveDockerRuntime(project)
        : undefined;
    let selected =
      docker === undefined
        ? (override ??
          (mode === "native"
            ? process.env.FACTORIO_NATIVE
            : process.env.FACTORIO))
        : join(docker.engineRoot, "bin/arm64/factorio");
    if (selected === undefined && mode === "native")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "native engine",
          message:
            "Select the verified standalone full client with --engine or FACTORIO_NATIVE; Steam launch approval is not automated",
        }),
      );
    if (selected === undefined) {
      const inPath = Bun.which("factorio");
      if (inPath !== null) selected = inPath;
      else {
        const candidates =
          process.platform === "darwin"
            ? [
                join(
                  homedir(),
                  "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio",
                ),
                "/Applications/factorio.app/Contents/MacOS/factorio",
              ]
            : [
                join(homedir(), ".factorio/bin/x64/factorio"),
                join(
                  homedir(),
                  ".local/share/Steam/steamapps/common/Factorio/bin/x64/factorio",
                ),
                "/usr/share/factorio/bin/x64/factorio",
                "/usr/share/games/factorio/bin/x64/factorio",
              ];
        const found: string[] = [];
        for (const candidate of candidates)
          if (yield* fs.exists(candidate)) found.push(candidate);
        if (found.length !== 1)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: "engine selection",
              message:
                "Factorio discovery is missing or ambiguous; select an exact executable with --engine or FACTORIO",
            }),
          );
        selected = found[0];
      }
    }
    if (selected === undefined || selected.length === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "engine selection",
          message: "Empty engine selection",
        }),
      );
    const lookup = selected.includes("/") ? selected : Bun.which(selected);
    if (lookup === null)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "engine selection",
          message: "Selected engine executable is not on PATH",
        }),
      );
    const executable = yield* fs.realPath(resolve(lookup));
    if (mode === "native" && executable.includes("/Steam/steamapps/"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "native engine",
          message:
            "The Steam installation requires an interactive launch route; select the standalone full client explicitly",
        }),
      );
    const probe = yield* runCommand(
      project,
      "engine-version",
      [executable, "--version"],
      { deadlineMs: 30000, ...(docker === undefined ? {} : { docker }) },
    );
    const identity = yield* parseEngineVersion(probe.stdout);
    const floor = yield* engineFloor(project);
    if (
      !identity.version.startsWith(project.info.factorio_version + ".") ||
      compareVersions(identity.version, floor) < 0
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: `Engine ${identity.version} does not satisfy ${floor} within ${project.info.factorio_version}`,
        }),
      );
    if (mode === "native" && identity.distribution !== "full")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "native engine",
          message: "Native rendering requires a full graphical client",
        }),
      );
    const candidates = [
        resolve(dirname(executable), "../data"),
        resolve(dirname(executable), "../../data"),
      ],
      data: string[] = [];
    for (const candidate of candidates)
      if (yield* fs.exists(join(candidate, "core", "info.json")))
        data.push(yield* fs.realPath(candidate));
    const readData = data[0];
    if (data.length !== 1 || readData === undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "engine data",
          message: "Selected engine has missing or ambiguous core data",
        }),
      );
    const base = yield* readJSON(
      Schema.Struct({ version: Version }),
      join(readData, "base", "info.json"),
      true,
    );
    if (base.version !== identity.version)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "engine data",
          message: "Executable and bundled base versions disagree",
        }),
      );
    return yield* decode(
      Engine,
      {
        executable,
        ...identity,
        readData,
        sha256: docker?.engineSha256 ?? (yield* hashFile(executable)),
        ...(docker === undefined ? {} : { docker }),
      },
      "resolved engine",
    );
  });
}
