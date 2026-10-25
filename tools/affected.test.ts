import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  affectedProjects,
  selectAffected,
  verifyAffectedSelection,
} from "./affected.ts";
import { discoverProjects } from "./projects.ts";
import { runFiles } from "./fixtures/release.ts";
import { RunAnnouncements } from "./runs.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const quiet = <A, E>(effect: Parameters<typeof runFiles<A, E>>[0]) =>
  runFiles(
    effect.pipe(
      Effect.provideService(RunAnnouncements, { write: () => Effect.void }),
    ),
  );
async function fixture(cli = false) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-affected-")),
  );
  roots.push(root);
  for (const directory of [
    "tools",
    "patches",
    ".config",
    ".trunk",
    ...["primary", "companion", "leaf"].map((name) => "mods/" + name),
  ])
    await mkdir(join(root, directory), { recursive: true });
  for (const path of [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "license.txt",
    ".editorconfig",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    ".trunk/trunk.yaml",
    "tools/shared.ts",
    "patches/input.patch",
    ".config/policy.json",
  ])
    await writeFile(join(root, path), "{}\n");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await writeFile(join(root, ".gitignore"), ".factorio-test/\n*.scratch\n");
  for (const name of ["primary", "companion", "leaf"]) {
    await writeFile(
      join(root, "mods", name, "info.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        title: name,
        author: "test",
        description: "Affected selection fixture",
        factorio_version: "2.1",
        dependencies: [
          "base >= 2.1.20",
          ...(name === "companion" ? ["? leaf"] : []),
        ],
      }),
    );
    await writeFile(join(root, "mods", name, "control.lua"), "local n = 1\n");
  }
  await writeFile(
    join(root, "mods/primary/dev.config.ts"),
    "export default {companions: ['companion']};\n",
  );
  if (cli) {
    await cp(import.meta.dir, join(root, "tools"), { recursive: true });
    await cp(
      join(import.meta.dir, "../.config/factorio-dependencies.json"),
      join(root, ".config/factorio-dependencies.json"),
    );
    await symlink(
      join(import.meta.dir, "../node_modules"),
      join(root, "node_modules"),
    );
  }
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exit !== 0) throw new Error(stderr);
    return stdout.trim();
  };
  await git("init", "-q", "--initial-branch=main");
  await git("add", "-A");
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=" + join(root, "no-hooks"),
    "commit",
    "-qm",
    "fixture",
  );
  return { root, git, select: () => quiet(selectAffected(root, "HEAD")) };
}
const names = (projects: readonly { info: { name: string } }[]) =>
  projects.map((p) => p.info.name);

test("affected selection includes additions, deletions, renames, staged and ignored source inputs", async () => {
  const f = await fixture();
  expect(names((await f.select()).projects)).toEqual([]);
  await rm(join(f.root, "mods/primary/control.lua"));
  await writeFile(join(f.root, "mods/primary/new.lua"), "local n = 2\n");
  let result = await f.select();
  expect(names(result.projects)).toEqual(["primary"]);
  expect(result.selection.changed).toEqual([
    "mods/primary/control.lua",
    "mods/primary/new.lua",
  ]);
  await rm(join(f.root, "mods/primary/new.lua"));
  await writeFile(join(f.root, "mods/primary/control.lua"), "local n = 2\n");
  await f.git("add", "mods/primary/control.lua");
  await writeFile(join(f.root, "mods/primary/control.lua"), "local n = 1\n");
  expect(names((await f.select()).projects)).toEqual(["primary"]);
  await f.git("reset", "-q", "HEAD", "--", "mods/primary/control.lua");
  await rename(
    join(f.root, "mods/leaf/control.lua"),
    join(f.root, "mods/leaf/renamed.lua"),
  );
  result = await f.select();
  expect(names(result.projects)).toEqual(["companion", "leaf", "primary"]);
  expect(result.selection.changed).toEqual([
    "mods/leaf/control.lua",
    "mods/leaf/renamed.lua",
  ]);
  await rename(
    join(f.root, "mods/leaf/renamed.lua"),
    join(f.root, "mods/leaf/control.lua"),
  );
  await writeFile(
    join(f.root, "mods/primary/ignored.scratch"),
    "not in Git, but in the source seal\n",
  );
  result = await f.select();
  expect(names(result.projects)).toEqual(["primary"]);
  expect(result.selection.changed).toEqual(["mods/primary/ignored.scratch"]);
}, 20000);

test("shared and removed-product inputs select everyone; companions and runtime dependencies propagate", async () => {
  const f = await fixture();
  const projects = await runFiles(discoverProjects(f.root));
  for (const path of [
    "tools/deleted.ts",
    ".config/new.json",
    "mods/retired/control.lua",
  ])
    expect(
      names((await runFiles(affectedProjects(projects, [path]))).projects),
    ).toEqual(["companion", "leaf", "primary"]);
  expect(
    names(
      (
        await runFiles(
          affectedProjects(projects, ["mods/companion/deleted.lua"]),
        )
      ).projects,
    ),
  ).toEqual(["companion", "primary"]);
  expect(
    runFiles(affectedProjects(projects, ["../outside"])),
  ).rejects.toThrow();
});

test("affected verification rejects scope drift and missing revisions instead of reporting cached success", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "mods/primary/control.lua"), "local n = 2\n");
  const { selection } = await f.select();
  await quiet(verifyAffectedSelection(f.root, selection));
  await writeFile(join(f.root, "mods/leaf/new.lua"), "local n = 3\n");
  expect(quiet(verifyAffectedSelection(f.root, selection))).rejects.toThrow(
    "affected products changed",
  );
  expect(quiet(selectAffected(f.root, "missing-ref"))).rejects.toThrow();
  expect(quiet(selectAffected(f.root, "--help"))).rejects.toThrow();
}, 20000);

test("the CLI reports no-work instead of success and never narrows vac", async () => {
  const f = await fixture(true);
  const invoke = (...args: string[]) =>
    Bun.spawnSync({
      cmd: [process.execPath, join(f.root, "tools/cli.ts"), ...args],
      cwd: f.root,
      stdout: "pipe",
      stderr: "pipe",
    });
  const result = invoke("verify", "--affected", "HEAD");
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const report = JSON.parse(result.stdout.toString());
  expect(report.status).toBe("not-needed");
  expect(report.selection.projects).toEqual([]);
  expect(report.selection.changed).toEqual([]);
  expect(
    invoke("vac", "scope", "--affected", "HEAD", "--plan").exitCode,
  ).not.toBe(0);
});
