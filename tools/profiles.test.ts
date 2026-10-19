import { afterEach, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
