import { Effect } from "effect";
import { join } from "node:path";
import { BoundaryError } from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";
import { newRun } from "./runs.ts";
import { readLogPage } from "./logs.ts";
import { withProcess } from "./process.ts";
import type { Request } from "./process.ts";

export function readCommandOutput(
  directory: string,
  runId: string,
  maxBytes = 8 * 1024 * 1024,
) {
  return Effect.gen(function* () {
    let cursor = { runId, sequence: 0 },
      bytes = 0;
    const stdout: string[] = [],
      stderr: string[] = [];
    while (true) {
      const page = yield* readLogPage(join(directory, "logs"), cursor);
      cursor = page.cursor;
      for (const record of page.records) {
        if (record.channel !== "stdout" && record.channel !== "stderr")
          continue;
        bytes += Buffer.byteLength(record.text);
        if (bytes > maxBytes)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: runId,
              message:
                "Command output exceeds the consumer limit; complete bounded logs remain on disk",
            }),
          );
        (record.channel === "stdout" ? stdout : stderr).push(record.text);
      }
      if (page.complete)
        return { stdout: stdout.join(""), stderr: stderr.join("") };
      if (page.records.length === 0)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: runId,
            message: "Command logs are not sealed",
          }),
        );
    }
  });
}
export function runCommand(
  project: ExecutionContext,
  profile: string,
  command: readonly string[],
  options: Partial<
    Pick<
      Request,
      | "cwd"
      | "env"
      | "deadlineMs"
      | "shutdownMs"
      | "allowedExitCodes"
      | "docker"
    >
  > = {},
) {
  return Effect.gen(function* () {
    const base = yield* newRun(project, profile);
    const run = {
      ...base,
      ...options,
      env: { ...base.env, ...options.env },
      command,
    };
    const exit = yield* withProcess(run, (child) => child.waitForExit);
    const output = yield* readCommandOutput(run.directory, run.runId);
    return { ...output, exit, run };
  });
}
