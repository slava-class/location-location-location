import { Effect, Exit, FileSystem, Schema } from "effect";
import { basename, extname, join } from "node:path";
import { Sha256 } from "./contracts.ts";
import { runCommand } from "./commands.ts";
import { hashFile } from "./files.ts";
import { RunId } from "./logs.ts";
import { withOwnedLock } from "./locks.ts";
import {
  BoundaryError,
  decode,
  prepareOutputDirectory,
  RelativePath,
} from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";
import { sourceFiles } from "./source.ts";

// Mise pins the JS launcher; force Bun instead of its Node shebang.
export const trunkCommand = [
  process.execPath,
  "run",
  "--bun",
  "trunk",
] as const;

const QualityMode = Schema.Literals(["check", "format-check", "format"]);
export const QualityResult = Schema.Struct({
  status: Schema.Literal("passed"),
  mode: QualityMode,
  scope: Schema.String,
  runId: RunId,
  files: Schema.Array(RelativePath),
  changed: Schema.Array(RelativePath),
  before: Sha256,
  after: Sha256,
});

const TrunkSummary = Schema.Struct({
  files: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  existing: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export function validateTrunkCheck(stdout: string, expectedFiles: number) {
  return Effect.gen(function* () {
    // Trunk 1.25 has no public aggregate JSON output. Pin and fail closed on
    // its complete footer: exit zero alone permits existing diagnostics.
    const match = stdout
      .replace(/\r\n/g, "\n")
      .trimEnd()
      .match(
        /(?:^|\n)Checked ([1-9][0-9]*) files?\n(?:([0-9]+) existing issues?\n)?✔ No (?:new )?issues$/u,
      );
    if (!match)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Trunk check",
          message:
            "Missing or unsupported complete check summary; inspect raw logs",
        }),
      );
    const summary = yield* decode(
      TrunkSummary,
      {
        files: Number(match[1]),
        existing: match[2] === undefined ? 0 : Number(match[2]),
      },
      "Trunk check summary",
    );
    if (summary.files !== expectedFiles || summary.existing !== 0) {
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "Trunk check",
          message: `Checked ${summary.files}/${expectedFiles} selected files with ${summary.existing} existing issues; existing findings also block verification`,
        }),
      );
    }
  });
}

const formatterFilter = "oxfmt-bun,stylua-native,shfmt-native";
const formatterExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".html",
  ".lua",
  ".sh",
]);
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".zip",
  ".mp4",
  ".pdf",
]);
const formattersApply = (path: string) =>
  !path.startsWith("patches/") &&
  (formatterExtensions.has(extname(path)) || basename(path) === ".luacheckrc");
const digest = (files: Readonly<Record<string, string>>) =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify(files)).digest("hex");

function workspaceFiles(context: ExecutionContext) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const result = yield* runCommand(context, "quality-inventory", [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    const candidates = yield* decode(
      Schema.Array(RelativePath),
      result.stdout.split("\0").filter(Boolean),
      "Git source inventory",
    );
    const files: string[] = [];
    for (const path of new Set(candidates)) {
      // Deleted tracked paths are absent from the working source inventory.
      if (yield* fs.exists(join(context.repoRoot, path))) files.push(path);
    }
    return files.sort();
  });
}

export function rejectTrunkUserOverrides(context: ExecutionContext) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(context.repoRoot, ".trunk", "user.yaml");
    if (yield* fs.exists(path))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message:
            "Unsealed Trunk user overrides are not accepted; put shared quality policy in .trunk/trunk.yaml",
        }),
      );
  });
}

export function runQuality(
  context: ExecutionContext,
  mode: typeof QualityMode.Type,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* rejectTrunkUserOverrides(context);
    const selection = (
      "info" in context ? sourceFiles(context) : workspaceFiles(context)
    ).pipe(
      Effect.map((selected) =>
        selected
          .filter(
            (path) =>
              !binaryExtensions.has(extname(path)) &&
              (mode === "check" || formattersApply(path)),
          )
          .sort(),
      ),
    );
    const files = yield* selection;
    if (files.length === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: mode,
          message: "No applicable source files selected",
        }),
      );
    const snapshot = () =>
      Effect.gen(function* () {
        const hashes: Record<string, string> = {};
        for (const path of files) {
          const absolute = join(context.repoRoot, path);
          if ((yield* fs.realPath(absolute)) !== absolute)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: path,
                message: "Quality inputs cannot be symlinks or aliases",
              }),
            );
          const stat = yield* fs.stat(absolute);
          if (stat.type !== "File" || Number(stat.size) > 16 * 1024 * 1024)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: path,
                message:
                  "Quality inputs must be regular source files no larger than 16 MiB",
              }),
            );
          hashes[path] = yield* hashFile(absolute);
        }
        return hashes;
      });
    const before = yield* snapshot();
    const selectionDirectory = join(
      context.outputRoot,
      "quality",
      crypto.randomUUID(),
    );
    yield* prepareOutputDirectory(selectionDirectory);
    const selectionPath = join(selectionDirectory, "selection.json");
    yield* fs.writeFileString(selectionPath, JSON.stringify(files));
    const command =
      mode === "format"
        ? [
            ...trunkCommand,
            "fmt",
            "--show-existing",
            "--no-progress",
            "--cache=false",
            "--color=false",
            "--",
            ...files,
          ]
        : [
            ...trunkCommand,
            "check",
            "--no-fix",
            "--show-existing",
            "--cache=false",
            "--no-progress",
            "--color=false",
            ...(mode === "format-check" ? ["--filter", formatterFilter] : []),
            "--",
            ...files,
          ];
    const { result, after, changed } = yield* Effect.uninterruptibleMask(
      (restore) =>
        Effect.gen(function* () {
          const outcome = yield* Effect.exit(
            restore(
              runCommand(context, mode, command, {
                cwd: context.repoRoot,
                env: {
                  TRUNK_TELEMETRY: "off",
                  MODKIT_SOURCE_SELECTION: selectionPath,
                },
                deadlineMs: 300_000,
              }),
            ),
          );
          // Read back even failed/cancelled checks before propagating their outcome.
          yield* rejectTrunkUserOverrides(context);
          const current = yield* selection;
          if (
            current.length !== files.length ||
            current.some((path, index) => path !== files[index])
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: mode,
                message: "Source selection changed during quality checking",
              }),
            );
          const after = yield* snapshot();
          const changed = files.filter((path) => before[path] !== after[path]);
          if (mode !== "format" && changed.length)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: mode,
                message: "Read-only quality checking changed source files",
              }),
            );
          if (Exit.isFailure(outcome))
            return yield* Effect.failCause(outcome.cause);
          return { result: outcome.value, after, changed };
        }),
    );
    const count = result.stdout.match(/\bChecked ([0-9]+) files?\b/);
    if (!count || Number(count[1]) !== files.length)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: result.run.runId,
          message:
            "Trunk did not confirm the complete explicit file selection; inspect its logs",
        }),
      );
    if (mode !== "format")
      yield* validateTrunkCheck(result.stdout, files.length);
    return yield* decode(
      QualityResult,
      {
        status: "passed",
        mode,
        scope: "info" in context ? context.info.name : "workspace",
        runId: result.run.runId,
        files,
        changed,
        before: digest(before),
        after: digest(after),
      },
      "quality result",
    );
  }).pipe((operation) =>
    withOwnedLock(
      join(context.repoRoot, ".factorio-test", "quality.lock"),
      `quality:${mode}`,
      operation,
    ),
  );
}
