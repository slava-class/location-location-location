import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWorkspaceSnapshot } from "./workspace.ts";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function git(root: string, ...args: string[]) {
  const child = Bun.spawn(["git", ...args], {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw Error(stderr);
  return stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "modkit-snapshot-"),
  );
  directories.push(root);
  await writeFile(join(root, ".gitignore"), ".factorio-test/\n");
  await writeFile(join(root, "tracked.txt"), "committed\n");
  await git(root, "init", "--initial-branch=main");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "baseline",
  );
  await writeFile(join(root, "tracked.txt"), "staged\n");
  await git(root, "add", "tracked.txt");
  await writeFile(join(root, "tracked.txt"), "working\n");
  await writeFile(join(root, "new.txt"), "new\n");
  return {
    repoRoot: root,
    outputRoot: join(root, ".factorio-test", "workspace"),
  };
}
test("isolated snapshot includes working and untracked content, detects drift, and preserves real staging", async () => {
  const context = await fixture(),
    root = context.repoRoot;
  const index = await readFile(join(root, ".git", "index")),
    head = await git(root, "rev-parse", "HEAD");
  let temporary = "";
  await Effect.runPromise(
    withWorkspaceSnapshot(context, (snapshot) =>
      Effect.gen(function* () {
        temporary = snapshot.env.GIT_INDEX_FILE!;
        expect(snapshot.head).toBe(head);
        expect(
          yield* Effect.promise(() =>
            git(root, "show", snapshot.tree + ":tracked.txt"),
          ),
        ).toBe("working");
        expect(
          yield* Effect.promise(() =>
            git(root, "show", snapshot.tree + ":new.txt"),
          ),
        ).toBe("new");
        yield* Effect.promise(() =>
          writeFile(join(root, "new.txt"), "changed\n"),
        );
        expect(yield* snapshot.snapshot).not.toBe(snapshot.tree);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  expect(await readFile(join(root, ".git", "index"))).toEqual(index);
  expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  expect(await git(root, "show", ":tracked.txt")).toBe("staged");
  expect(access(temporary)).rejects.toMatchObject({ code: "ENOENT" });
});
test("failed verification cleans its private index without changing the user index or HEAD", async () => {
  const context = await fixture(),
    root = context.repoRoot,
    index = await readFile(join(root, ".git", "index")),
    head = await git(root, "rev-parse", "HEAD");
  let temporary = "";
  const failure = new Error("verification failed");
  expect(
    Effect.runPromise(
      withWorkspaceSnapshot(context, (snapshot) => {
        temporary = snapshot.env.GIT_INDEX_FILE!;
        return Effect.fail(failure);
      }).pipe(Effect.provide(BunServices.layer)),
    ),
  ).rejects.toThrow("verification failed");
  expect(await readFile(join(root, ".git", "index"))).toEqual(index);
  expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  expect(access(temporary)).rejects.toMatchObject({ code: "ENOENT" });
});
