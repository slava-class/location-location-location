import { Cause, Effect, Schema } from "effect";
import { join } from "node:path";
import { runCommand } from "./commands.ts";
import { withOwnedLock } from "./locks.ts";
import { RunId } from "./logs.ts";
import { BoundaryError, decode } from "./projects.ts";
import type { ResolvedWorkspace } from "./projects.ts";
import { GitObject, withWorkspaceSnapshot } from "./workspace.ts";
import type { WorkspaceSnapshot } from "./workspace.ts";

const CheckpointRequest = Schema.Struct({
  mode: Schema.Literals(["local", "publish"]),
  message: Schema.String.check(
    Schema.isPattern(/\S/u),
    // oxlint-disable-next-line no-control-regex -- A commit argument cannot contain NUL.
    Schema.isPattern(/^[^\u0000]+$(?![\s\S])/u),
  ),
});
const CheckpointResult = Schema.Struct({
  schema: Schema.Literal(1),
  mode: CheckpointRequest.fields.mode,
  status: Schema.Literals(["committed", "unchanged"]),
  previous: GitObject,
  commit: GitObject,
  tree: GitObject,
  branch: Schema.NullOr(Schema.NonEmptyString),
  publication: Schema.Literals([
    "not-requested",
    "not-needed",
    "detached",
    "confirmed",
    "unconfirmed",
  ]),
  pushRun: Schema.NullOr(RunId),
});

export function checkpointWorkspace<E, R>(
  workspace: ResolvedWorkspace,
  input: unknown,
  verify: (
    snapshot: WorkspaceSnapshot,
  ) => Effect.Effect<{ readonly status: "passed" | "failed" }, E, R>,
) {
  return Effect.gen(function* () {
    const request = yield* decode(
      CheckpointRequest,
      input,
      "checkpoint request",
    );
    const git = (args: readonly string[]) =>
      runCommand(workspace, "checkpoint-git", ["git", ...args]);
    const object = (args: readonly string[]) =>
      git(args).pipe(
        Effect.flatMap((result) =>
          decode(GitObject, result.stdout.trim(), "checkpoint Git identity"),
        ),
      );
    return yield* withOwnedLock(
      join(workspace.outputRoot, "checkpoint.lock"),
      `checkpoint:${request.mode}`,
      withWorkspaceSnapshot(workspace, (snapshot) =>
        Effect.gen(function* () {
          const index = yield* object(["write-tree"]);
          const branch =
            (yield* git(["branch", "--show-current"])).stdout.trim() || null;
          const verification = yield* verify(snapshot);
          if (verification.status !== "passed")
            return yield* Effect.fail(
              new BoundaryError({
                boundary: "checkpoint",
                message:
                  "Whole-workspace verification failed; nothing staged or committed",
              }),
            );
          if (
            (yield* object(["rev-parse", "HEAD"])) !== snapshot.head ||
            (yield* snapshot.snapshot) !== snapshot.tree
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: "checkpoint",
                message:
                  "Source or HEAD changed during verification; nothing staged or committed",
              }),
            );
          if ((yield* object(["write-tree"])) !== index)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: "checkpoint",
                message:
                  "Staging changed during verification; refusing to overwrite the new index",
              }),
            );
          if (
            ((yield* git(["branch", "--show-current"])).stdout.trim() ||
              null) !== branch
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: "checkpoint",
                message:
                  "The checked-out branch changed during verification; nothing committed",
              }),
            );
          if ((yield* object(["rev-parse", "HEAD^{tree}"])) === snapshot.tree)
            return yield* decode(
              CheckpointResult,
              {
                schema: 1,
                mode: request.mode,
                status: "unchanged",
                previous: snapshot.head,
                commit: snapshot.head,
                tree: snapshot.tree,
                branch,
                publication:
                  request.mode === "local" ? "not-requested" : "not-needed",
                pushRun: null,
              },
              "checkpoint result",
            );
          yield* git(["add", "-A"]);
          if ((yield* object(["write-tree"])) !== snapshot.tree)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: "checkpoint",
                message: "Source changed while staging; nothing committed",
              }),
            );
          yield* git(["commit", "-m", request.message.trim()]);
          const commit = yield* object(["rev-parse", "HEAD"]);
          if ((yield* object(["rev-parse", "HEAD^{tree}"])) !== snapshot.tree)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: commit,
                message: `Local commit ${commit} differs from the verified tree, possibly due to a hook; no push was attempted`,
              }),
            );
          if (
            ((yield* git(["branch", "--show-current"])).stdout.trim() ||
              null) !== branch
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: commit,
                message: `The checked-out branch changed during local commit ${commit}; no push was attempted`,
              }),
            );
          let publication: (typeof CheckpointResult.Type)["publication"] =
            "not-requested";
          let pushRun: string | null = null;
          if (request.mode === "publish") {
            if (branch === null) publication = "detached";
            else {
              // Push the verified object, not a branch ref that could advance before Git resolves it.
              const pushed = yield* runCommand(
                workspace,
                "checkpoint-push",
                [
                  "git",
                  "push",
                  "--",
                  "origin",
                  `${commit}:refs/heads/${branch}`,
                ],
                {
                  allowedExitCodes: Array.from(
                    { length: 256 },
                    (_, code) => code,
                  ),
                  env: {
                    GIT_TERMINAL_PROMPT: "0",
                    GIT_ASKPASS: "/usr/bin/false",
                    SSH_ASKPASS: "/usr/bin/false",
                    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
                    ...(process.env.SSH_AUTH_SOCK === undefined
                      ? {}
                      : { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
                  },
                },
              ).pipe(
                Effect.map((result) => ({
                  runId: result.run.runId,
                  confirmed: result.exit.code === 0,
                })),
                Effect.catchCause((cause) =>
                  Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.succeed({ runId: null, confirmed: false }),
                ),
              );
              pushRun = pushed.runId;
              publication = pushed.confirmed ? "confirmed" : "unconfirmed";
            }
          }
          return yield* decode(
            CheckpointResult,
            {
              schema: 1,
              mode: request.mode,
              status: "committed",
              previous: snapshot.head,
              commit,
              tree: snapshot.tree,
              branch,
              publication,
              pushRun,
            },
            "checkpoint result",
          );
        }),
      ),
    );
  });
}
