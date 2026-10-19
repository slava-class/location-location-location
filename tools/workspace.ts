import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { runCommand } from "./commands.ts";
import { decode, prepareOutputDirectory } from "./projects.ts";
import type { ResolvedWorkspace } from "./projects.ts";

export const GitObject = Schema.String.check(
  Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$(?![\s\S])/u),
);
export interface WorkspaceSnapshot {
  readonly head: string;
  readonly tree: string;
  readonly env: Readonly<Record<string, string>>;
  readonly snapshot: ReturnType<typeof snapshotIndex>;
}
function snapshotIndex(
  workspace: ResolvedWorkspace,
  env: Readonly<Record<string, string>>,
) {
  return Effect.gen(function* () {
    yield* runCommand(workspace, "workspace-git", ["git", "add", "-A"], {
      env,
    });
    const result = yield* runCommand(
      workspace,
      "workspace-git",
      ["git", "write-tree"],
      { env },
    );
    return yield* decode(GitObject, result.stdout.trim(), "workspace tree");
  });
}
export function withWorkspaceSnapshot<A, E, R>(
  workspace: ResolvedWorkspace,
  action: (snapshot: WorkspaceSnapshot) => Effect.Effect<A, E, R>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = join(
        workspace.outputRoot,
        "snapshots",
        crypto.randomUUID(),
      );
      yield* Effect.acquireRelease(prepareOutputDirectory(directory), () =>
        fs.remove(directory, { recursive: true }).pipe(Effect.orDie),
      );
      const env = { GIT_INDEX_FILE: join(directory, "index") };
      const git = (args: readonly string[]) =>
        runCommand(workspace, "workspace-git", ["git", ...args], { env });
      const head = yield* decode(
        GitObject,
        (yield* git(["rev-parse", "HEAD"])).stdout.trim(),
        "workspace HEAD",
      );
      yield* git(["read-tree", head]);
      const snapshot = snapshotIndex(workspace, env);
      const tree = yield* snapshot;
      return yield* action({ head, tree, env, snapshot });
    }),
  );
}
