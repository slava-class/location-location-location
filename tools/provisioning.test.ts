import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoundaryError, resolveProject, resolveWorkspace } from "./projects.ts";
import { resolveLuaTools } from "./lua-tools.ts";
import { resolveApi } from "./api.ts";
import { runHelper } from "./helpers.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-prerequisite-")),
  );
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await cp(import.meta.dir, join(root, "tools"), { recursive: true });
  await copyFile(join(import.meta.dir, "../bun.lock"), join(root, "bun.lock"));
  return {
    root,
    workspace: await Effect.runPromise(
      resolveWorkspace(root).pipe(Effect.provide(BunServices.layer)),
    ),
  };
}
test("missing compiled Lua inputs fail without invoking setup or creating a cache", async () => {
  const { root, workspace } = await fixture();
  const error = await Effect.runPromise(
    Effect.flip(resolveLuaTools(workspace)).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
  expect(error).toBeInstanceOf(BoundaryError);
  expect(access(join(root, ".factorio-test"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
test("a helper without its explicitly bootstrapped Python environment cannot create one or launch a run", async () => {
  const { root, workspace } = await fixture();
  const Wire = Schema.Struct({ schema: Schema.Literal(1) });
  const error = await Effect.runPromise(
    Effect.flip(
      runHelper(workspace, "tools/unstarted.py", Wire, Wire, { schema: 1 }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  expect(error).toBeInstanceOf(BoundaryError);
  for (const name of [".venv", ".factorio-test"])
    expect(access(join(root, name))).rejects.toMatchObject({
      code: "ENOENT",
    });
});
test("API resolution rejects missing or altered documents without replacing them", async () => {
  const { root } = await fixture();
  await mkdir(join(root, "mods/probe"), { recursive: true });
  await writeFile(
    join(root, "mods/probe/info.json"),
    JSON.stringify({
      name: "probe",
      version: "1.0.0",
      title: "Probe",
      author: "Fixture",
      description: "API boundary",
      factorio_version: "2.1",
      dependencies: ["base >= 2.1.20"],
    }),
  );
  const project = await Effect.runPromise(
    resolveProject(root, "probe", root).pipe(Effect.provide(BunServices.layer)),
  );
  const resolve = () =>
    Effect.runPromise(
      Effect.flip(resolveApi(project)).pipe(Effect.provide(BunServices.layer)),
    );
  expect(await resolve()).toBeInstanceOf(BoundaryError);
  expect(access(join(root, ".factorio-test"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const directory = join(root, ".factorio-test/cache/api/2.1.20"),
    path = join(directory, "runtime-api.json");
  await mkdir(directory, { recursive: true });
  await writeFile(path, "altered definitions");
  expect(await resolve()).toBeInstanceOf(BoundaryError);
  expect(await readFile(path, "utf8")).toBe("altered definitions");
});
