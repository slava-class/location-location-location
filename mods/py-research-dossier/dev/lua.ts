import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { readCommandOutput } from "../../../tools/commands.ts";
import { withProcess } from "../../../tools/process.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import { newRun } from "../../../tools/runs.ts";

export function runLua(project: ResolvedProject, source: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const run = yield* newRun(project, "offline-lua");
    const script = join(run.directory, "case.lua");
    yield* fs.writeFileString(script, source);
    yield* withProcess(
      { ...run, command: ["lua", script], cwd: project.modRoot },
      (child) => child.waitForExit,
    );
    return (yield* readCommandOutput(run.directory, run.runId)).stdout;
  });
}
