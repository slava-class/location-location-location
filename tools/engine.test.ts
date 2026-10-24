import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveDependency } from "./dependencies.ts";
import {
  parseEngineVersion,
  resolveEngine,
  resolveGraphicsPreset,
} from "./engine.ts";
import { BoundaryError, resolveProject } from "./projects.ts";
import { runFiles } from "./fixtures/release.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(layout: "mac" | "linux" = "mac") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-engine-")));
  roots.push(root);
  const modRoot = join(root, "mods/probe");
  await mkdir(modRoot, { recursive: true });
  await writeFile(
    join(modRoot, "info.json"),
    JSON.stringify({
      name: "probe",
      version: "1.0.0",
      title: "Probe",
      author: "Fixture",
      factorio_version: "2.1",
      dependencies: ["base >= 2.1.20"],
      description: "Engine resolution fixture",
    }),
  );
  const project = await runFiles(resolveProject(root, "probe", root));
  const install = join(
    root,
    "installation with spaces",
    layout === "mac" ? "factorio.app/Contents" : "factorio",
  );
  const executable = join(
    install,
    layout === "mac" ? "MacOS/factorio" : "bin/x64/factorio",
  );
  const data = join(install, "data");
  await mkdir(dirname(executable), { recursive: true });
  await mkdir(join(data, "core"), { recursive: true });
  await mkdir(join(data, "base"), { recursive: true });
  await writeFile(join(data, "core/info.json"), "{}");
  async function version(value = "2.1.20", distribution = "full") {
    await writeFile(
      executable,
      `#!${process.execPath}\nif(process.argv[2]!=="--version")process.exit(2);\nconsole.log(${JSON.stringify(`Version: ${value} (build 1, mac-arm64, ${distribution})`)});\n`,
    );
    await chmod(executable, 0o755);
    await writeFile(
      join(data, "base/info.json"),
      JSON.stringify({ version: value }),
    );
  }
  await version();
  return { root, project, executable, data, version };
}

test("version output requires the complete engine build, platform and distribution identity", async () => {
  expect(
    await Effect.runPromise(
      parseEngineVersion("Version: 2.1.21 (build 87673, mac-arm64, full)"),
    ),
  ).toEqual({
    version: "2.1.21",
    build: "87673",
    platform: "mac-arm64",
    distribution: "full",
  });
  for (const text of [
    "Steam requires restart",
    "Version: 2.1.20",
    "Version: 2.1.20 (build 1)",
    "Version: 2.1.20 (build 1, mac-arm64, unknown)",
  ])
    expect(Effect.runPromise(parseEngineVersion(text))).rejects.toBeInstanceOf(
      BoundaryError,
    );
});

test("asset graphics reject a low-quality request rather than silently changing it", async () => {
  const error = await Effect.runPromise(
    Effect.flip(resolveGraphicsPreset("asset", "low")),
  );
  expect(error).toBeInstanceOf(BoundaryError);
});

test("Mac and Linux installation layouts resolve matching data from an executed version probe", async () => {
  for (const layout of ["mac", "linux"] as const) {
    const f = await fixture(layout);
    const result = await runFiles(
      resolveEngine(f.project, "headless", f.executable),
    );
    expect(result.readData).toBe(f.data);
    expect(result.version).toBe("2.1.20");
    expect(result.executable).toBe(f.executable);
  }
});

test("engine floors, target families and graphical distribution requirements fail closed", async () => {
  const f = await fixture();
  for (const version of ["2.1.19", "2.0.72", "3.0.0"]) {
    await f.version(version);
    expect(
      runFiles(resolveEngine(f.project, "headless", f.executable)),
    ).rejects.toBeInstanceOf(BoundaryError);
  }
  await f.version("2.1.20", "headless");
  expect(
    runFiles(resolveEngine(f.project, "native", f.executable)),
  ).rejects.toBeInstanceOf(BoundaryError);
});

test("missing, ambiguous and mismatched data cannot certify an executable", async () => {
  const f = await fixture();
  await writeFile(
    join(f.data, "base/info.json"),
    JSON.stringify({ version: "2.1.21" }),
  );
  expect(
    runFiles(resolveEngine(f.project, "headless", f.executable)),
  ).rejects.toBeInstanceOf(BoundaryError);
  await f.version();
  const alternative = join(dirname(dirname(f.data)), "data/core");
  await mkdir(alternative, { recursive: true });
  await writeFile(join(alternative, "info.json"), "{}");
  expect(
    runFiles(resolveEngine(f.project, "headless", f.executable)),
  ).rejects.toBeInstanceOf(BoundaryError);
  await rm(dirname(alternative), { recursive: true });
  await rm(f.data, { recursive: true });
  expect(
    runFiles(resolveEngine(f.project, "headless", f.executable)),
  ).rejects.toBeInstanceOf(BoundaryError);
});

test("native Steam paths are rejected before any executable is launched", async () => {
  const f = await fixture();
  const executable = join(f.root, "Steam/steamapps/common/Factorio/factorio");
  const marker = join(f.root, "unexpected-launch");
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(
    executable,
    `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)},"launched");\n`,
  );
  await chmod(executable, 0o755);
  expect(
    runFiles(resolveEngine(f.project, "native", executable)),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

test("Docker selection rejects graphical or executable overrides and never falls back to a native engine", async () => {
  const f = await fixture();
  const marker = join(f.root, "unexpected-native-launch");
  await writeFile(
    f.executable,
    `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, "launched");\n`,
  );
  for (const operation of [
    resolveEngine(f.project, "native", undefined, "docker"),
    resolveEngine(f.project, "headless", f.executable, "docker"),
    resolveEngine(f.project, "headless", undefined, "docker"),
  ])
    expect(await runFiles(Effect.flip(operation))).toBeInstanceOf(
      BoundaryError,
    );
  expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    access(join(f.root, ".factorio-test/cache/runtimes")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("changed dependency cache bytes fail without downloading or selecting a newer release", async () => {
  const f = await fixture();
  const directory = join(f.root, ".factorio-test/cache/dependencies");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "pinned_1.0.0.zip"), "changed ZIP");
  let requests = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests++;
      return HttpClientResponse.fromWeb(
        request,
        new Response(null, { status: 503 }),
      );
    }),
  );
  expect(
    Effect.runPromise(
      resolveDependency(f.project, {
        name: "pinned",
        version: "1.0.0",
        sha256: "0".repeat(64),
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provideService(HttpClient.HttpClient, client),
      ),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
  expect(requests).toBe(0);
});
