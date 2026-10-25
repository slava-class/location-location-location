import { Effect, Schema } from "effect";
import { relative } from "node:path";
import { ModIdentity } from "./contracts.ts";
import { runCommand } from "./commands.ts";
import { requirements } from "./dependencies.ts";
import {
  BoundaryError,
  decode,
  discoverProjects,
  RelativePath,
  resolveWorkspace,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { sourceFiles, sourceProjects } from "./source.ts";
import { GitObject } from "./workspace.ts";

export const AffectedSelection = Schema.Struct({
  schema: Schema.Literal(1),
  base: GitObject,
  changed: Schema.Array(RelativePath),
  workspaceChanges: Schema.Array(RelativePath),
  projects: Schema.Array(ModIdentity),
});

/** Deleted paths retain their owning root; undeclared roots conservatively affect everyone. */
export function affectedProjects(
  projects: readonly ResolvedProject[],
  input: readonly string[],
) {
  return Effect.gen(function* () {
    const changed = yield* decode(
      Schema.Array(RelativePath),
      input,
      "changed source paths",
    );
    if (projects.length === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "affected selection",
          message: "No products discovered",
        }),
      );
    const all = yield* sourceProjects(projects);
    const roots = all.map(
      (project) => relative(project.repoRoot, project.modRoot) + "/",
    );
    const workspaceChanges = changed.filter(
      (path) => !roots.some((root) => path.startsWith(root)),
    );
    const selected = new Set<string>();
    const consumers = new Map<string, Set<string>>();
    for (const project of projects) {
      const closure = yield* sourceProjects(project);
      const inputs = closure.map((p) => relative(p.repoRoot, p.modRoot) + "/");
      if (
        workspaceChanges.length > 0 ||
        changed.some((path) => inputs.some((root) => path.startsWith(root)))
      )
        selected.add(project.info.name);
      const dependencies = new Set(closure.map((p) => p.info.name));
      for (const requirement of yield* requirements(project))
        dependencies.add(requirement.name);
      consumers.set(project.info.name, dependencies);
    }
    let previous = -1;
    while (previous !== selected.size) {
      previous = selected.size;
      for (const [consumer, dependencies] of consumers)
        if ([...dependencies].some((name) => selected.has(name)))
          selected.add(consumer);
    }
    return {
      projects: projects.filter((p) => selected.has(p.info.name)),
      workspaceChanges,
    };
  });
}

/** Read-only Git queries use the owned command/log boundary, never the user's index. */
export function selectAffected(repository: string, revision: string) {
  return Effect.gen(function* () {
    yield* decode(Schema.NonEmptyString, revision, "affected base revision");
    const workspace = yield* resolveWorkspace(repository);
    const git = (args: readonly string[]) =>
      runCommand(workspace, "affected-git", ["git", ...args], {
        env: { GIT_OPTIONAL_LOCKS: "0" },
      });
    const base = yield* decode(
      GitObject,
      (yield* git([
        "rev-parse",
        "--verify",
        "--end-of-options",
        revision + "^{commit}",
      ])).stdout.trim(),
      "affected base commit",
    );
    const paths = (output: string) =>
      decode(
        Schema.Array(RelativePath),
        output.split("\0").filter(Boolean),
        "Git changed paths",
      );
    const changed = new Set<string>();
    for (const args of [
      [
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "-z",
        base,
        "--",
      ],
      [
        "diff",
        "--cached",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "-z",
        base,
        "--",
      ],
      ["ls-files", "--others", "--exclude-standard", "-z"],
    ])
      for (const path of yield* paths((yield* git(args)).stdout))
        changed.add(path);
    const tracked = new Set(
      yield* paths((yield* git(["ls-files", "--cached", "-z"])).stdout),
    );
    const projects = yield* discoverProjects(workspace.repoRoot);
    // Git ignores do not narrow the canonical source seal. Such inputs have no
    // committed comparison identity, so conservatively select their consumers.
    for (const path of yield* sourceFiles(projects))
      if (!tracked.has(path)) changed.add(path);
    const sorted = [...changed].sort();
    const selected = yield* affectedProjects(projects, sorted);
    const selection = yield* decode(
      AffectedSelection,
      {
        schema: 1,
        base,
        changed: sorted,
        workspaceChanges: selected.workspaceChanges,
        projects: selected.projects.map((p) => ({
          name: p.info.name,
          version: p.info.version,
        })),
      },
      "affected selection",
    );
    return { selection, projects: selected.projects };
  });
}

export function verifyAffectedSelection(
  repository: string,
  expected: typeof AffectedSelection.Type,
) {
  return Effect.gen(function* () {
    const actual = (yield* selectAffected(repository, expected.base)).selection;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "affected selection",
          message:
            "Changed paths or affected products changed during verification; select and verify again",
        }),
      );
  });
}
