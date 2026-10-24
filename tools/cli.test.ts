import { afterEach, expect, test } from "bun:test";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("CLI plans cannot execute checkpoint mutations or engine work in an unprovisioned workspace", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-cli-plan-")),
  );
  roots.push(root);
  await cp(import.meta.dir, join(root, "tools"), { recursive: true });
  await mkdir(join(root, ".config"));
  await cp(
    resolve(import.meta.dir, "../.config/factorio-dependencies.json"),
    join(root, ".config/factorio-dependencies.json"),
  );
  await symlink(
    resolve(import.meta.dir, "../node_modules"),
    join(root, "node_modules"),
  );
  for (const [name, verification, profiles] of [
    ["engine-probe", "engine", ["base", "space-age"]],
    ["offline-probe", "offline", []],
  ] as const) {
    const directory = join(root, "mods", name);
    await mkdir(join(directory, "dev"), { recursive: true });
    await writeFile(
      join(directory, "info.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        title: name,
        author: "Fixture",
        factorio_version: "2.1",
        dependencies: ["base >= 2.1.20"],
        description: "Planning safety fixture",
      }),
    );
    await writeFile(
      join(directory, "dev.config.ts"),
      `export default ${JSON.stringify({ verification, profiles })};\n`,
    );
  }
  const before = (await readdir(root, { recursive: true })).sort();
  const invoke = (...args: string[]) =>
    Bun.spawnSync({
      cmd: [process.execPath, join(root, "tools/cli.ts"), ...args],
      cwd: root,
      env: {
        PATH: "",
        HOME: root,
        TERM_PROGRAM: "tern",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  for (const [command, commit] of [
    ["verify", "none"],
    ["checkpoint", "local"],
    ["vac", "push"],
  ] as const) {
    const result = invoke(command, "--plan", "--backend", "docker");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const plan = JSON.parse(result.stdout.toString());
    expect(plan.status).toBe("planned");
    expect(plan.commit).toBe(commit);
    expect(
      plan.projects.map(
        (project: { mod: { name: string }; backend: string | null }) => [
          project.mod.name,
          project.backend,
        ],
      ),
    ).toEqual([
      ["engine-probe", "docker"],
      ["offline-probe", null],
    ]);
  }
  const selected = invoke("verify", "offline-probe", "--plan");
  expect(selected.exitCode).toBe(0);
  expect(
    JSON.parse(selected.stdout.toString()).projects.map(
      (project: { mod: { name: string } }) => project.mod.name,
    ),
  ).toEqual(["offline-probe"]);
  for (const args of [
    ["verify", "offline-probe", "--all", "--plan"],
    ["verify", "missing", "--plan"],
    ["vac"],
    ["checkpoint"],
  ]) {
    expect(invoke(...args).exitCode).not.toBe(0);
  }
  expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
  // Progress must not corrupt the machine-readable result, including when
  // OMP's captured process inherits Tern's terminal environment.
  const failed = invoke("verify", "offline-probe");
  expect(failed.exitCode).not.toBe(0);
  const report = JSON.parse(failed.stdout.toString());
  expect(report.status).toBe("failed");
  expect(
    report.projects.map(
      (project: { mod: { name: string }; status: string }) => ({
        name: project.mod.name,
        status: project.status,
      }),
    ),
  ).toEqual([{ name: "offline-probe", status: "prerequisite-failed" }]);
});
