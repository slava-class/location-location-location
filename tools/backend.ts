import { Schema } from "effect";
import { AbsolutePath, Sha256 } from "./contracts.ts";
export const Backend = Schema.Literals(["native", "docker"]);
export const dockerCacheSuffix =
  ".factorio-test/cache/runtimes/factorio-2.1.21-bun-1.4.2-linux-arm64";
export const dockerSettings = {
  image:
    "debian@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f",
  platform: "linux/arm64",
  limits: {
    cpus: 2,
    memoryBytes: 1073741824,
    pids: 64,
    temporaryBytes: 67108864,
  },
} as const;
export const DockerRuntime = Schema.Struct({
  client: AbsolutePath,
  socket: AbsolutePath,
  image: Schema.Literal(dockerSettings.image),
  platform: Schema.Literal(dockerSettings.platform),
  engineRoot: AbsolutePath,
  engineSha256: Sha256,
  bun: AbsolutePath,
  bunSha256: Sha256,
  limits: Schema.Struct({
    cpus: Schema.Literal(dockerSettings.limits.cpus),
    memoryBytes: Schema.Literal(dockerSettings.limits.memoryBytes),
    pids: Schema.Literal(dockerSettings.limits.pids),
    temporaryBytes: Schema.Literal(dockerSettings.limits.temporaryBytes),
  }),
});
export type ResolvedDockerRuntime = typeof DockerRuntime.Type;
