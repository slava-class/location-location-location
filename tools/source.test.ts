import { test, expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import {
  mkdtemp,
  mkdir,
  writeFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoundaryError, resolveProject } from "./projects.ts";
import { sourceFiles, sourceSeal, verifySourceSeal } from "./source.ts";

test("source seals isolate unrelated mods and invalidate selected, shared and required-companion changes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-seal-")));
  try {
    for (const directory of [
      "tools",
      "patches",
      ".trunk",
      ".config",
      "mods/primary",
      "mods/companion",
      "mods/unrelated",
    ])
      await mkdir(join(root, directory), { recursive: true });
    for (const name of [
      "package.json",
      "bun.lock",
      ".config/mise.toml",
      "tsconfig.json",
      ".config/stylua.toml",
      "license.txt",
      ".gitignore",
      ".editorconfig",
      ".oxlintrc.json",
      ".oxfmtrc.json",
      ".trunk/trunk.yaml",
      ".config/betterleaks.toml",
      ".config/knip.ts",
      ".config/emmy.json",
      ".config/workshop-luacheck.lua",
    ])
      await writeFile(join(root, name), "source input\n");
    await writeFile(
      join(root, "tools", "shared.ts"),
      "export const revision=1;\n",
    );
    for (const name of ["primary", "companion", "unrelated"]) {
      await writeFile(
        join(root, "mods", name, "info.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          title: name,
          author: "test",
          description: "Source-closure regression",
          factorio_version: "2.1",
          dependencies: ["base >= 2.1.20"],
        }),
      );
      await writeFile(
        join(root, "mods", name, "control.lua"),
        "local revision = 1\n",
      );
    }
    await writeFile(
      join(root, "mods/primary/dev.config.ts"),
      "export default {companions:['companion']};\n",
    );
    const project = await Effect.runPromise(
      resolveProject(root, "primary", root).pipe(
        Effect.provide(BunServices.layer),
      ),
    );
    const capture = (selected = project) =>
      Effect.runPromise(
        sourceSeal(selected).pipe(Effect.provide(BunServices.layer)),
      );
    const baseline = await capture();
    const extended = await Effect.runPromise(
      resolveProject(root, "primary", root, { companions: ["unrelated"] }).pipe(
        Effect.provide(BunServices.layer),
      ),
    );
    const extendedBaseline = await capture(extended);
    await writeFile(
      join(root, "mods/unrelated/control.lua"),
      "local revision = 2\n",
    );
    expect((await capture()).sha256).toBe(baseline.sha256);
    expect(
      await Effect.runPromise(
        Effect.flip(
          verifySourceSeal(extendedBaseline, await capture(extended)),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
    for (const path of [
      "tools/shared.ts",
      "mods/primary/control.lua",
      "mods/companion/control.lua",
      ".trunk/trunk.yaml",
      ".oxlintrc.json",
      ".config/mise.toml",
      ".config/stylua.toml",
      ".config/betterleaks.toml",
      ".config/knip.ts",
      ".config/emmy.json",
      ".config/workshop-luacheck.lua",
      ".gitignore",
      "bun.lock",
    ]) {
      const original = await Bun.file(join(root, path)).text();
      await writeFile(join(root, path), original + "-- changed input\n");
      const changed = await capture();
      expect(
        await Effect.runPromise(
          Effect.flip(verifySourceSeal(baseline, changed)),
        ),
      ).toBeInstanceOf(BoundaryError);
      await writeFile(join(root, path), original);
    }
    const newConfiguration = join(root, ".config/factorio-dependencies.json");
    await writeFile(newConfiguration, '{"newlyDeclaredDependency":"1.0.0"}\n');
    expect(
      await Effect.runPromise(
        Effect.flip(verifySourceSeal(baseline, await capture())),
      ),
    ).toBeInstanceOf(BoundaryError);
    await rm(newConfiguration);
    expect((await capture()).sha256).toBe(baseline.sha256);
    const companion = await Effect.runPromise(
      resolveProject(root, "companion", root).pipe(
        Effect.provide(BunServices.layer),
      ),
    );
    const inventory = (selection: Parameters<typeof sourceFiles>[0]) =>
      Effect.runPromise(
        sourceFiles(selection).pipe(Effect.provide(BunServices.layer)),
      );
    expect(await inventory([project, companion])).toEqual(
      Object.keys(baseline.files),
    );
    expect(await inventory([project, extended])).toEqual(
      Object.keys(extendedBaseline.files),
    );
    const added = "mods/unrelated/new.lua";
    await writeFile(join(root, added), "return 1\n");
    expect(await inventory([project, companion])).not.toContain(added);
    expect(await inventory([project, extended])).toContain(added);
    await rm(join(root, added));
    expect(inventory([])).rejects.toBeInstanceOf(BoundaryError);
    expect(
      inventory([project, { ...companion, repoRoot: join(root, "foreign") }]),
    ).rejects.toBeInstanceOf(BoundaryError);
    const foreign = await Effect.runPromise(
      sourceSeal(companion).pipe(Effect.provide(BunServices.layer)),
    );
    expect(
      await Effect.runPromise(Effect.flip(verifySourceSeal(baseline, foreign))),
    ).toBeInstanceOf(BoundaryError);
    await symlink(
      join(root, "mods/unrelated/control.lua"),
      join(root, "mods/primary/linked.lua"),
    );
    expect(await capture().catch((error: unknown) => error)).toBeInstanceOf(
      BoundaryError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
