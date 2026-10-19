import { test, expect, afterEach } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { chmod, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointWorkspace } from "./checkpoint.ts";
import { runCommand } from "./commands.ts";
import { resolveWorkspace } from "./projects.ts";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(verify = "git diff --check HEAD") {
  const root = await mkdtemp(join(tmpdir(), "map-tag-vac-test-"));
  roots.push(root);
  const cwd = join(root, "work");
  await mkdir(cwd);
  const env = { ...process.env, MISE_TRUSTED_CONFIG_PATHS: root };
  delete env.GIT_INDEX_FILE;
  async function run(args, extraEnv = {}) {
    const child = Bun.spawn(args, {
      cwd,
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout: stdout.trim(), stderr, code };
  }
  async function git(...args) {
    const result = await run(["git", ...args]);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout;
  }
  await git("init", "-q", "--initial-branch=main");
  await git("config", "user.name", "Checkpoint Test");
  await git("config", "user.email", "checkpoint@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.hooksPath", join(root, "no-hooks"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await writeFile(join(cwd, ".gitignore"), ".factorio-test/\n");
  await writeFile(
    join(cwd, ".mise.toml"),
    `[tasks.verify]\nrun = ${JSON.stringify(verify)}\n`,
  );
  await writeFile(join(cwd, "content.txt"), "initial\n");
  await git("add", "-A");
  await git("commit", "-qm", "initial");
  async function invoke(mode, message) {
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const workspace = yield* resolveWorkspace(cwd);
          return yield* checkpointWorkspace(
            workspace,
            { mode, message },
            (snapshot) =>
              runCommand(
                workspace,
                "checkpoint-fixture-verification",
                ["mise", "run", "verify"],
                {
                  env: { ...snapshot.env, MISE_TRUSTED_CONFIG_PATHS: root },
                },
              ).pipe(Effect.as({ status: "passed" })),
          );
        }).pipe(Effect.provide(BunServices.layer)),
      );
      return { code: 0, result, stderr: "" };
    } catch (error) {
      return { code: 1, stderr: String(error) };
    }
  }
  return {
    root,
    cwd,
    run,
    git,
    vac: (message) => invoke("publish", message),
    checkpoint: (message) => invoke("local", message),
    change: (text) => writeFile(join(cwd, "content.txt"), text),
  };
}

test("vac commits the verified tree and pushes to a local remote with a literal message", async () => {
  const f = await fixture();
  const remote = join(f.root, "remote.git");
  await f.git("init", "--bare", "-q", remote);
  await f.git("remote", "add", "origin", remote);
  await f.change("verified change\n");
  const message = 'Keep "quotes", $variables, and ; punctuation literal';
  const result = await f.vac(message);
  expect(result.code, result.stderr).toBe(0);
  expect(await f.git("log", "-1", "--format=%s")).toBe(message);
  expect(await f.git("show", "HEAD:content.txt")).toBe("verified change");
  expect(await f.git("--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(
    await f.git("rev-parse", "HEAD"),
  );
});

test("failed verification preserves HEAD and the original staging", async () => {
  const f = await fixture("false");
  await f.change("staged\n");
  await f.git("add", "content.txt");
  const head = await f.git("rev-parse", "HEAD");
  const index = await f.git("write-tree");
  await f.change("unstaged\n");
  expect((await f.vac("Must not commit")).code).not.toBe(0);
  expect(await f.git("rev-parse", "HEAD")).toBe(head);
  expect(await f.git("write-tree")).toBe(index);
});

test("untracked whitespace errors fail before staging or committing", async () => {
  const f = await fixture();
  const head = await f.git("rev-parse", "HEAD");
  await writeFile(join(f.cwd, "new.txt"), "trailing whitespace  \n");
  expect((await f.vac("Must not commit whitespace")).code).not.toBe(0);
  expect(await f.git("rev-parse", "HEAD")).toBe(head);
  expect(await f.git("diff", "--cached", "--name-only")).toBe("");
});

test("files changed by verification are not committed", async () => {
  const f = await fixture("bun drift.mjs");
  await writeFile(
    join(f.cwd, "drift.mjs"),
    "await Bun.write('content.txt', 'changed during verification\\n');\n",
  );
  const head = await f.git("rev-parse", "HEAD");
  expect((await f.vac("Must not commit drift")).code).not.toBe(0);
  expect(await f.git("rev-parse", "HEAD")).toBe(head);
  expect(await f.git("diff", "--cached", "--name-only")).toBe("");
});

test("push failure retains a successful local checkpoint", async () => {
  const f = await fixture();
  await f.change("local checkpoint\n");
  const result = await f.vac("Local checkpoint");
  expect(result.code, result.stderr).toBe(0);
  expect(await f.git("show", "HEAD:content.txt")).toBe("local checkpoint");
  expect(result.result.publication).toBe("unconfirmed");
});

test("blank messages and unchanged trees do not create commits", async () => {
  const f = await fixture();
  const head = await f.git("rev-parse", "HEAD");
  for (const invalid of ["   ", "invalid\u0000message"])
    expect((await f.vac(invalid)).code).not.toBe(0);
  expect((await f.vac("Nothing changed")).code).toBe(0);
  expect(await f.git("rev-parse", "HEAD")).toBe(head);
});

test("a local checkpoint never pushes, even with an available remote", async () => {
  const f = await fixture();
  const remote = join(f.root, "remote.git");
  await f.git("init", "--bare", "-q", remote);
  await f.git("remote", "add", "origin", remote);
  await f.change("local only\n");
  const result = await f.checkpoint("Keep this local");
  expect(result.code, result.stderr).toBe(0);
  expect(result.result.publication).toBe("not-requested");
  expect(result.result.pushRun).toBe(null);
  expect(await f.git("show", "HEAD:content.txt")).toBe("local only");
  expect((await f.run(["git", "--git-dir", remote, "show-ref"])).code).toBe(1);
});

test("concurrent staging is preserved rather than overwritten by checkpointing", async () => {
  const f = await fixture("env -u GIT_INDEX_FILE git add content.txt");
  const head = await f.git("rev-parse", "HEAD");
  await f.change("new staged content\n");
  expect((await f.checkpoint("Must preserve staging")).code).toBe(1);
  expect(await f.git("rev-parse", "HEAD")).toBe(head);
  expect(await f.git("show", ":content.txt")).toBe("new staged content");
});

test("switching branches at the same commit during verification prevents committing", async () => {
  const f = await fixture("git switch -c unexpected");
  const head = await f.git("rev-parse", "HEAD");
  await f.change("uncommitted change\n");
  expect((await f.checkpoint("Wrong branch")).code).toBe(1);
  expect(await f.git("rev-parse", "HEAD")).toBe(head);
  expect(await f.git("branch", "--show-current")).toBe("unexpected");
});

test("an unchanged worktree leaves a deliberately different staged tree intact", async () => {
  const f = await fixture();
  await f.change("staged difference\n");
  await f.git("add", "content.txt");
  const index = await f.git("write-tree");
  await f.change("initial\n");
  const result = await f.checkpoint("Nothing new to commit");
  expect(result.code, result.stderr).toBe(0);
  expect(result.result.status).toBe("unchanged");
  expect(await f.git("write-tree")).toBe(index);
});

test("a hook-altered local commit is retained but never pushed", async () => {
  const f = await fixture();
  const remote = join(f.root, "remote.git");
  await f.git("init", "--bare", "-q", remote);
  await f.git("remote", "add", "origin", remote);
  const hooks = join(f.root, "no-hooks");
  await mkdir(hooks);
  const hook = join(hooks, "pre-commit");
  await writeFile(
    hook,
    "#!/bin/sh\nprintf 'hook change\\n' > hook.txt\ngit add hook.txt\n",
  );
  await chmod(hook, 0o755);
  await f.change("verified change\n");
  const previous = await f.git("rev-parse", "HEAD");
  expect((await f.vac("Hook changed this")).code).toBe(1);
  expect(await f.git("rev-parse", "HEAD")).not.toBe(previous);
  expect(await f.git("show", "HEAD:hook.txt")).toBe("hook change");
  expect((await f.run(["git", "--git-dir", remote, "show-ref"])).code).toBe(1);
});
