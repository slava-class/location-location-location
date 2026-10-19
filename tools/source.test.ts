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
import { sourceSeal, verifySourceSeal } from "./source.ts";

test("source seals isolate unrelated mods and invalidate selected, shared and required-companion changes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-seal-")));
  try {
    for (const directory of [
      "tools",
      "patches",
      ".trunk",
      "mods/primary",
      "mods/companion",
      "mods/unrelated",
    ])
      await mkdir(join(root, directory), { recursive: true });
    for (const name of [
      "package.json",
      "bun.lock",
      ".mise.toml",
      "tsconfig.json",
      "stylua.toml",
      "license.txt",
      ".gitignore",
      ".editorconfig",
      ".oxlintrc.json",
      ".oxfmtrc.json",
      ".trunk/trunk.yaml",
      ".betterleaks.toml",
      "knip.config.ts",
      "pyproject.toml",
      "uv.lock",
      ".python-version",
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
      ".gitignore",
      "pyproject.toml",
    ]) {
      const original = await Bun.file(join(root, path)).text();
      await writeFile(join(root, path), original + "-- changed input\n");
      const changed = await capture();
      expect(
        Effect.runPromise(verifySourceSeal(baseline, changed)),
      ).rejects.toBeInstanceOf(BoundaryError);
      await writeFile(join(root, path), original);
    }
    const companion = await Effect.runPromise(
      resolveProject(root, "companion", root).pipe(
        Effect.provide(BunServices.layer),
      ),
    );
    const foreign = await Effect.runPromise(
      sourceSeal(companion).pipe(Effect.provide(BunServices.layer)),
    );
    expect(
      Effect.runPromise(verifySourceSeal(baseline, foreign)),
    ).rejects.toBeInstanceOf(BoundaryError);
    await symlink(
      join(root, "mods/unrelated/control.lua"),
      join(root, "mods/primary/linked.lua"),
    );
    expect(capture()).rejects.toBeInstanceOf(BoundaryError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
