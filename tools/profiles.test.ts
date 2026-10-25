import { afterEach, expect, test } from "bun:test";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencyPin } from "./dependencies.ts";
import { runFiles } from "./fixtures/release.ts";
import { packageProject } from "./packaging.ts";
import { prepareProfile } from "./profiles.ts";
import { BoundaryError, resolveProject } from "./projects.ts";
import type { Info } from "./projects.ts";
import type { ResolvedEngine } from "./engine.ts";
import { Effect } from "effect";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-profile-")));
  roots.push(root);
  const info: typeof Info.Type = {
    name: "probe",
    version: "1.0.0",
    title: "Profile fixture",
    author: "Fixture",
    factorio_version: "2.1",
    dependencies: ["base >= 2.1.20"],
    description: "Archive identity and dependency fixture",
    homepage: "https://example.invalid/probe",
  };
  async function source(value: typeof Info.Type) {
    const directory = join(root, "mods", value.name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "info.json"), JSON.stringify(value));
    await writeFile(
      join(directory, "control.lua"),
      "-- Archive fixture; never executed.\n",
    );
    await writeFile(join(directory, "license.txt"), "Fixture license\n");
    await writeFile(
      join(directory, "changelog.txt"),
      `Version: ${value.version}\n  Changes:\n    - Fixture.\n`,
    );
    return runFiles(resolveProject(root, value.name, root));
  }
  const project = await source(info);
  const readData = join(root, "engine-data");
  await mkdir(join(readData, "base/locale/en"), { recursive: true });
  await writeFile(
    join(readData, "base/info.json"),
    JSON.stringify({ name: "base", version: "2.1.21" }),
  );
  await writeFile(
    join(readData, "base/locale/en/base.cfg"),
    "[fixture]\nname=Fixture\n",
  );
  await mkdir(join(root, "node_modules/factorio-test-cli"), {
    recursive: true,
  });
  await copyFile(
    join(
      import.meta.dir,
      "../node_modules/factorio-test-cli/headless-save.zip",
    ),
    join(root, "node_modules/factorio-test-cli/headless-save.zip"),
  );
  await mkdir(join(root, "tools/fixtures/benchmark"), { recursive: true });
  await copyFile(
    join(import.meta.dir, "fixtures/benchmark/control.lua"),
    join(root, "tools/fixtures/benchmark/control.lua"),
  );
  // Profile preparation reads engine metadata but does not execute an engine.
  const engine: ResolvedEngine = {
    executable: join(root, "not-launched"),
    readData,
    version: "2.1.21",
    build: "fixture",
    platform: "mac-arm64",
    distribution: "full",
    sha256: "0".repeat(64),
  };
  const build = async (value = info) =>
    runFiles(packageProject(await source(value)));
  return { root, project, engine, info, build };
}

test("an exact frozen archive stages without fabricated build or compression provenance", async () => {
  const f = await fixture(),
    built = await f.build();
  const context = await runFiles(
    prepareProfile(
      f.project,
      f.engine,
      "base",
      "en",
      {
        archive: built.archive,
        sha256: built.sha256,
      },
      [],
      "benchmark",
    ),
  );
  expect(context.expectedMods).toEqual({ base: "2.1.21", probe: "1.0.0" });
}, 30000);

test("profile eligibility follows the frozen ZIP dependency floor rather than checkout metadata", async () => {
  const f = await fixture();
  const archive = await f.build({
    ...f.info,
    dependencies: ["base >= 2.1.22"],
  });
  // f.project still declares >= 2.1.20. Even a complete build receipt must not
  // cause the profile builder to ignore the actual frozen archive's constraint.
  expect(
    await runFiles(
      Effect.flip(
        prepareProfile(
          f.project,
          f.engine,
          "base",
          "en",
          archive,
          [],
          "benchmark",
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
}, 30000);

test("frozen profile inputs reject wrong targets, versions and changed bytes", async () => {
  const f = await fixture();
  for (const info of [
    { ...f.info, name: "foreign" },
    { ...f.info, version: "1.0.1" },
  ]) {
    const archive = await f.build(info);
    expect(
      await runFiles(
        Effect.flip(
          prepareProfile(
            f.project,
            f.engine,
            "base",
            "en",
            archive,
            [],
            "benchmark",
          ),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
  }
  const archive = await f.build();
  await writeFile(archive.archive, "changed after freezing");
  expect(
    await runFiles(
      Effect.flip(
        prepareProfile(
          f.project,
          f.engine,
          "base",
          "en",
          archive,
          [],
          "benchmark",
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
}, 30000);

test("pY verification fails on an unprovisioned pinned closure before allocating a run", async () => {
  const f = await fixture();
  const archive = await f.build();
  const pin = await runFiles(dependencyPin("pyhardmode"));
  const failure = await runFiles(
    Effect.flip(
      prepareProfile(
        f.project,
        f.engine,
        "py-hardmode",
        "en",
        archive,
        [],
        "benchmark",
      ),
    ),
  );
  expect(failure).toMatchObject({
    _tag: "BoundaryError",
    boundary: join(
      f.root,
      ".factorio-test/cache/dependencies",
      `${pin.name}_${pin.version}.zip`,
    ),
  });
  expect(
    await access(join(f.project.outputRoot, "runs")).catch(
      (error: unknown) => error,
    ),
  ).toMatchObject({ code: "ENOENT" });
});

test("disabled controls retain archive identity without weakening suites or package smoke", async () => {
  const f = await fixture(),
    built = await f.build({
      ...f.info,
      dependencies: ["base >= 2.1.20", "unprovisioned-product-dependency"],
    });
  for (const purpose of [
    "session",
    "benchmark",
    "benchmark-activity",
    "benchmark-proof",
  ] as const) {
    const context = await runFiles(
      prepareProfile(f.project, f.engine, "base", "en", built, [], purpose, {
        productEnabled: false,
      }),
    );
    expect(context.expectedMods).not.toHaveProperty("probe");
    expect(context.expectedMods.base).toBe("2.1.21");
    expect(context.archives.probe?.sha256).toBe(built.sha256);
    expect(
      (
        await Bun.file(join(context.directory, "mods/mod-list.json")).json()
      ).mods.find((mod: { name: string }) => mod.name === "probe"),
    ).toEqual({ name: "probe", enabled: false });
  }
  for (const purpose of ["suite", "package-smoke"] as const)
    expect(
      await runFiles(
        Effect.flip(
          prepareProfile(
            f.project,
            f.engine,
            "base",
            "en",
            built,
            [],
            purpose,
            {
              productEnabled: false,
            },
          ),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
});

test("undeclared and duplicate verification roots fail before profile allocation", async () => {
  const f = await fixture(),
    built = await f.build();
  for (const dependencies of [["flib"], ["flib", "flib"]]) {
    expect(
      await runFiles(
        Effect.flip(
          prepareProfile(
            f.project,
            f.engine,
            "base",
            "en",
            built,
            [],
            "session",
            {
              dependencies,
            },
          ),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
  }
  expect(
    await access(join(f.project.outputRoot, "runs")).catch(
      (error: unknown) => error,
    ),
  ).toMatchObject({ code: "ENOENT" });
});

test("declared optional verification roots require their exact provisioned pin", async () => {
  const f = await fixture(),
    built = await f.build();
  const project = {
    ...f.project,
    development: { verificationDependencies: ["flib"] },
  };
  const pin = await runFiles(dependencyPin("flib"));
  const failure = await runFiles(
    Effect.flip(
      prepareProfile(project, f.engine, "base", "en", built, [], "session", {
        dependencies: ["flib"],
      }),
    ),
  );
  expect(failure).toMatchObject({
    _tag: "BoundaryError",
    boundary: join(
      f.root,
      ".factorio-test/cache/dependencies",
      `${pin.name}_${pin.version}.zip`,
    ),
  });
  expect(
    await access(join(f.project.outputRoot, "runs")).catch(
      (error: unknown) => error,
    ),
  ).toMatchObject({ code: "ENOENT" });
});

test("changed profile settings fail before allocating a run", async () => {
  const f = await fixture(),
    built = await f.build();
  const file = join(f.root, "owned-mod-settings.dat");
  const original = new Uint8Array([1, 2, 3, 4]);
  const sha256 = new Bun.CryptoHasher("sha256").update(original).digest("hex");
  await writeFile(file, new Uint8Array([1, 2, 3, 5]));
  const failure = await runFiles(
    Effect.flip(
      prepareProfile(f.project, f.engine, "base", "en", built, [], "session", {
        settings: { file, sha256 },
      }),
    ),
  );
  expect(failure).toMatchObject({
    _tag: "BoundaryError",
    boundary: file,
    message:
      "Cached input differs from its size/checksum pin; refusing substitution",
  });
  expect(
    await access(join(f.project.outputRoot, "runs")).catch(
      (error: unknown) => error,
    ),
  ).toMatchObject({ code: "ENOENT" });
});
