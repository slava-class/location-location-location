import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AbsolutePath, Sha256 } from "./contracts.ts";
import { DockerRuntime, dockerSettings, dockerCacheSuffix } from "./backend.ts";
import { dockerConnection } from "./docker.ts";
import { hashFile, inventoryFiles } from "./files.ts";
import { runCommand } from "./commands.ts";
import { withZip } from "./archives.ts";
import { withOwnedLock } from "./locks.ts";
import { getBytes } from "./network.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  decodeJSON,
  prepareOutputDirectory,
  readJSON,
  RelativePath,
} from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";

const pins = {
  factorio: {
    url: "https://factorio.com/get-download/2.1.21/headless/linux-arm64",
    sha256: "8ded7ed5a0eac128b686df6383815401852ff4402249daf43bc9885d38b93be7",
    origin: "factorio",
    file: "factorio-headless.tar.xz",
  },
  bun: {
    url: "https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-linux-aarch64.zip",
    sha256: "efa9813da5ed72423bf847f916e8d2c47c0d776add972354026a75e10da9aa21",
    origin: "github-release",
    file: "bun-linux-aarch64.zip",
  },
} as const;
const LocalArchives = Schema.Struct({
  factorio: AbsolutePath,
  bun: AbsolutePath,
});
const Installation = Schema.Struct({
  schema: Schema.Literal(1),
  factorioArchive: Schema.Literal(pins.factorio.sha256),
  bunArchive: Schema.Literal(pins.bun.sha256),
  files: Schema.Record(RelativePath, Sha256),
});
const Contexts = Schema.Array(
  Schema.Struct({
    Endpoints: Schema.Struct({
      docker: Schema.Struct({ Host: Schema.String }),
    }),
  }),
).check(Schema.makeFilter((values) => values.length === 1));
const ImageInspection = Schema.Array(
  Schema.Struct({
    RepoDigests: Schema.Array(Schema.String),
    Architecture: Schema.Literal("arm64"),
    Os: Schema.Literal("linux"),
  }),
).check(Schema.makeFilter((values) => values.length === 1));
const Server = Schema.Struct({
  Os: Schema.Literal("linux"),
  Arch: Schema.Literal("arm64"),
  Version: Schema.NonEmptyString,
});
function installationDirectory(context: ExecutionContext) {
  return join(context.repoRoot, dockerCacheSuffix);
}
function validateInstallation(directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* assertCanonicalPath(directory);
    const manifest = join(directory, "runtime.json");
    yield* assertCanonicalPath(manifest);
    if (!(yield* fs.exists(manifest)))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Docker runtime",
          message:
            "Pinned runtime is not provisioned; run mise run engine-provision",
        }),
      );
    const receipt = yield* readJSON(Installation, manifest);
    const current = yield* inventoryFiles(directory, [
      "factorio",
      "bun-linux-aarch64",
    ]);
    if (!isDeepStrictEqual(current, receipt.files))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: directory,
          message:
            "Provisioned runtime inventory changed; refusing to substitute or repair it during verification",
        }),
      );
    return receipt;
  });
}
function connection(context: ExecutionContext) {
  return Effect.gen(function* () {
    const found = Bun.which("docker");
    if (found === null)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Docker",
          message: "Docker CLI is unavailable",
        }),
      );
    const result = yield* runCommand(context, "docker-context", [
      found,
      "context",
      "inspect",
    ]);
    const contexts = yield* decodeJSON(
      Contexts,
      new TextEncoder().encode(result.stdout),
      "Docker context",
      true,
    );
    const connected = yield* dockerConnection(
      found,
      contexts[0]!.Endpoints.docker.Host,
    );
    const server = yield* runCommand(context, "docker-server", [
      connected.client,
      "--host",
      "unix://" + connected.socket,
      "version",
      "--format",
      "{{json .Server}}",
    ]);
    yield* decodeJSON(
      Server,
      new TextEncoder().encode(server.stdout),
      "Docker server platform",
      true,
    );
    return connected;
  });
}
function validateImage(
  context: ExecutionContext,
  connected: { client: string; socket: string },
) {
  return Effect.gen(function* () {
    const result = yield* runCommand(context, "docker-image", [
      connected.client,
      "--host",
      "unix://" + connected.socket,
      "image",
      "inspect",
      dockerSettings.image,
    ]);
    const images = yield* decodeJSON(
      ImageInspection,
      new TextEncoder().encode(result.stdout),
      "Docker image",
      true,
    );
    if (!images[0]!.RepoDigests.includes(dockerSettings.image))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Docker image",
          message: "Image digest does not match the selected pin",
        }),
      );
  });
}
export function resolveDockerRuntime(context: ExecutionContext) {
  return Effect.gen(function* () {
    const directory = installationDirectory(context);
    const receipt = yield* validateInstallation(directory);
    const connected = yield* connection(context);
    yield* validateImage(context, connected);
    return yield* decode(
      DockerRuntime,
      {
        ...connected,
        ...dockerSettings,
        engineRoot: join(directory, "factorio"),
        engineSha256: receipt.files["factorio/bin/arm64/factorio"],
        bun: join(directory, "bun-linux-aarch64/bun"),
        bunSha256: receipt.files["bun-linux-aarch64/bun"],
      },
      "resolved Docker runtime",
    );
  });
}
export function provisionDockerRuntime(
  context: ExecutionContext,
  archivesInput?: unknown,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const archives =
      archivesInput === undefined
        ? undefined
        : yield* decode(LocalArchives, archivesInput, "local runtime archives");
    if (archives !== undefined) {
      for (const key of ["factorio", "bun"] as const) {
        yield* assertCanonicalPath(archives[key]);
        if ((yield* hashFile(archives[key])) !== pins[key].sha256)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: key,
              message:
                "Selected local archive does not match the pinned checksum",
            }),
          );
      }
    }
    const directory = installationDirectory(context);
    const connected = yield* connection(context);
    // Provisioning is explicitly online; normal resolution never pulls or downloads.
    yield* runCommand(
      context,
      "docker-image-provision",
      [
        connected.client,
        "--host",
        "unix://" + connected.socket,
        "pull",
        "--platform",
        dockerSettings.platform,
        dockerSettings.image,
      ],
      { deadlineMs: 180000 },
    );
    yield* validateImage(context, connected);
    yield* withOwnedLock(
      directory + ".lock",
      "provision Docker runtime",
      Effect.gen(function* () {
        if (yield* fs.exists(directory)) {
          yield* validateInstallation(directory);
          return;
        }
        const stage = directory + "." + crypto.randomUUID() + ".part";
        yield* prepareOutputDirectory(stage);
        yield* Effect.gen(function* () {
          for (const key of ["factorio", "bun"] as const) {
            const pin = pins[key],
              path = join(stage, pin.file);
            if (archives === undefined) {
              const bytes = yield* getBytes(
                pin.url,
                key + " runtime archive",
                128 * 1024 * 1024,
                { origin: pin.origin, redirects: true },
              );
              if (
                new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
                pin.sha256
              )
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: key,
                    message: "Downloaded runtime archive checksum differs",
                  }),
                );
              yield* fs.writeFile(path, bytes, { flag: "wx" });
            } else yield* fs.copyFile(archives[key], path);
            if ((yield* hashFile(path)) !== pin.sha256)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: key,
                  message: "Staged runtime archive checksum differs",
                }),
              );
          }
          yield* runCommand(context, "extract-headless-engine", [
            "tar",
            "-xJf",
            join(stage, pins.factorio.file),
            "-C",
            stage,
          ]);
          yield* withZip(
            { archive: join(stage, pins.bun.file), sha256: pins.bun.sha256 },
            (zip) =>
              Effect.gen(function* () {
                yield* zip.verifyAll;
                const executable = yield* zip.read(
                  "bun-linux-aarch64/bun",
                  256 * 1024 * 1024,
                );
                yield* prepareOutputDirectory(join(stage, "bun-linux-aarch64"));
                const target = join(stage, "bun-linux-aarch64/bun");
                yield* fs.writeFile(target, executable, { flag: "wx" });
                yield* fs.chmod(target, 0o755);
              }),
          );
          const files = yield* inventoryFiles(stage, [
            "factorio",
            "bun-linux-aarch64",
          ]);
          const receipt = yield* decode(
            Installation,
            {
              schema: 1,
              factorioArchive: pins.factorio.sha256,
              bunArchive: pins.bun.sha256,
              files,
            },
            "runtime installation",
          );
          yield* fs.writeFileString(
            join(stage, "runtime.json"),
            JSON.stringify(receipt, null, 2) + "\n",
            { flag: "wx" },
          );
          yield* assertCanonicalPath(directory);
          yield* fs.rename(stage, directory);
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              if (yield* fs.exists(stage))
                yield* fs.remove(stage, { recursive: true });
            }).pipe(Effect.orDie),
          ),
        );
      }),
    );
    return yield* resolveDockerRuntime(context);
  });
}
