import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { ChildProcess } from "effect/process";
import { join } from "node:path";
import { runCLI } from "./cli-runtime.ts";
import { BoundaryError, readJSON } from "./projects.ts";
import { SourceSelection } from "./source.ts";

const command = Command.make(
  "oxlint",
  { selection: Argument.String("selection") },
  ({ selection }) =>
    Effect.gen(function* () {
      const files = (yield* readJSON(SourceSelection, selection)).filter(
        (path) => /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(path),
      );
      if (files.length === 0)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "Oxlint selection",
            message: "No JavaScript or TypeScript files selected",
          }),
        );
      // Trunk owns this checker and captures its streams; do not allocate a second run.
      const child = yield* ChildProcess.make(
        process.execPath,
        [
          join(
            import.meta.dir,
            "..",
            "node_modules",
            "oxlint",
            "bin",
            "oxlint",
          ),
          "--type-aware",
          "--type-check",
          "--deny-warnings",
          "--format",
          "sarif",
          "--",
          ...files,
        ],
        { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
      );
      const code = yield* child.exitCode;
      if (code !== 0)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "Oxlint",
            message: `Checker exited with code ${code}`,
          }),
        );
    }).pipe(Effect.scoped),
);

runCLI(
  Command.runWith(command, { version: "workspace" })(
    process.argv.slice(2),
  ).pipe(Effect.provide(BunServices.layer)),
);
