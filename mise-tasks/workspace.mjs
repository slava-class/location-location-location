import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

export async function runCommand(args, {root = resolve("."), capture = false, env = {}, allowFailure = false} = {}) {
  const child = Bun.spawn(args, {
    cwd: root, env: {...process.env, ...env}, stdin: "ignore",
    stdout: capture ? "pipe" : "inherit", stderr: "inherit",
  });
  const output = capture ? await new Response(child.stdout).text() : "";
  const code = await child.exited;
  if (code !== 0 && !allowFailure) throw new Error(`${args[0]} ${args[1]} failed (${code}); stopped.`);
  return {code, output: output.trim()};
}

export async function withWorkspaceSnapshot(root, action) {
  const git = async (...args) => (await runCommand(["git", ...args], {root, capture: true})).output;
  const head = await git("rev-parse", "HEAD");
  const directory = await mkdtemp(join(tmpdir(), "location-release-index-"));
  const env = {GIT_INDEX_FILE: join(directory, "index")};
  try {
    await runCommand(["git", "read-tree", head], {root, env});
    const snapshot = async () => {
      await runCommand(["git", "add", "-A"], {root, env});
      return (await runCommand(["git", "write-tree"], {root, env, capture: true})).output;
    };
    return await action({head, tree: await snapshot(), snapshot, env});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
