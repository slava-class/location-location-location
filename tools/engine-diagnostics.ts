import { Effect, FileSystem, Option, Schema } from "effect";
import { join } from "node:path";
import { AbsolutePath, Sha256 } from "./contracts.ts";
import { assertCanonicalPath, BoundaryError, decode } from "./projects.ts";
import type { ModInfo } from "./projects.ts";

export function verifyEngineDiagnostics(
  log: string,
  termination: "clean" | "factorio-test-exit",
  mod: Pick<ModInfo, "name" | "title" | "version">,
) {
  const blocks = log
    .split(/(?=^\s*[0-9]+\.[0-9]+ \S)/m)
    .filter((block) => /^\s*[0-9]+\.[0-9]+ (?:Error|Fatal) /.test(block));
  if (termination === "clean") {
    if (blocks.length !== 0 || !/^\s*[0-9]+\.[0-9]+ Goodbye\s*$/m.test(log))
      return Effect.fail(
        new BoundaryError({
          boundary: mod.name,
          message:
            "Engine did not finish cleanly; inspect its complete raw log",
        }),
      );
  } else {
    const lines = blocks[0]?.trimEnd().split("\n");
    // FactorioTest 3.1.0 intentionally ends --benchmark with this engine error.
    // Match its exact origin and emitResult frame, never an arbitrary substring.
    const expected =
      blocks.length === 1 &&
      lines !== undefined &&
      /^\s*[0-9]+\.[0-9]+ Error Util\.cpp:[0-9]+: /.test(lines[0] ?? "") &&
      lines[0]!.endsWith(
        `The mod ${mod.title} (${mod.version}) caused a non-recoverable error.`,
      ) &&
      lines[1] === "Please report this error to the mod author." &&
      lines[2] === "" &&
      lines[3] === `Error while running event ${mod.name}::on_tick (ID 0)` &&
      /^__factorio-test__\/_factorio-test\.lua:[0-9]+: FACTORIO-TEST-EXIT$/.test(
        lines[4] ?? "",
      ) &&
      lines[5] === "stack traceback:" &&
      lines[6] === "\t[C]: in function 'error'" &&
      /^\t__factorio-test__\/_factorio-test\.lua:[0-9]+: in function 'emitResult'$/.test(
        lines[7] ?? "",
      );
    if (!expected)
      return Effect.fail(
        new BoundaryError({
          boundary: mod.name,
          message:
            "Headless engine diagnostics differ from the single intentional FactorioTest termination; inspect the complete raw log",
        }),
      );
  }
  return Effect.void;
}

const EngineErrorKind = Schema.Literals([
  "mod-load",
  "runtime-lua",
  "suspected-native-crash",
  "engine-error",
  "framework-termination",
]);
const ErrorExcerpt = Schema.Struct({
  kind: EngineErrorKind,
  text: Schema.String,
  truncated: Schema.Boolean,
});
const FileDiagnostic = Schema.Union([
  Schema.Struct({ path: AbsolutePath, state: Schema.Literal("missing") }),
  Schema.Struct({
    path: AbsolutePath,
    state: Schema.Literal("read"),
    bytes: Schema.Int,
    sha256: Sha256,
    errors: Schema.Array(ErrorExcerpt),
    omittedErrors: Schema.Int,
    tail: Schema.String,
  }),
]);
export const EngineDiagnostics = Schema.Struct({
  files: Schema.Array(FileDiagnostic),
  artifacts: Schema.Array(
    Schema.Struct({ path: AbsolutePath, bytes: Schema.Int }),
  ),
  artifactScope: Schema.Literal("owned-run-directory-only"),
});

function errorKind(text: string): typeof EngineErrorKind.Type {
  // Classification never exempts an error from the strict success qualifier above.
  if (/^\s*[0-9]+\.[0-9]+ (?:Error|Fatal) CrashHandler\.cpp:/m.test(text))
    return "suspected-native-crash";
  if (
    /^__factorio-test__\/_factorio-test\.lua:[0-9]+: FACTORIO-TEST-EXIT$/m.test(
      text,
    ) &&
    /^\t__factorio-test__\/_factorio-test\.lua:[0-9]+: in function 'emitResult'$/m.test(
      text,
    )
  )
    return "framework-termination";
  if (/^Error while running event /m.test(text)) return "runtime-lua";
  if (
    /Failed to load mods:|Error while loading (?:entity|item|recipe|technology|prototype)|Error in assignID/m.test(
      text,
    )
  )
    return "mod-load";
  return "engine-error";
}

interface Redactor {
  push(text: string, final?: boolean): string;
}

/** Bounded-memory post-exit readback; the complete raw files remain run-owned. */
export function collectEngineDiagnostics(
  directory: string,
  paths: { readonly current: string; readonly previous: string },
  makeRedactor: () => Redactor,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files: (typeof FileDiagnostic.Type)[] = [];
    for (const path of [paths.previous, paths.current]) {
      yield* assertCanonicalPath(path);
      if (!(yield* fs.exists(path))) {
        files.push({ path, state: "missing" });
        continue;
      }
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(path, { flag: "r" });
          const before = yield* file.stat;
          if (before.type !== "File" || before.size > 32n * 1024n * 1024n)
            return yield* Effect.fail(
              new BoundaryError({
                boundary: path,
                message:
                  "Engine diagnostic input is not a bounded regular file",
              }),
            );
          const errors: (typeof ErrorExcerpt.Type)[] = [];
          const hash = new Bun.CryptoHasher("sha256");
          const decoder = new TextDecoder();
          const redactor = makeRedactor();
          const buffer = new Uint8Array(8192);
          let offset = 0,
            pending = "",
            block = "",
            active = false,
            truncated = false,
            omittedErrors = 0,
            tail = "";
          const flush = () => {
            if (!active) return;
            if (errors.length < 8)
              errors.push({ kind: errorKind(block), text: block, truncated });
            else omittedErrors++;
            block = "";
            active = false;
            truncated = false;
          };
          const line = (text: string, clipped: boolean) => {
            if (/^\s*[0-9]+\.[0-9]+ \S/.test(text)) {
              flush();
              active = /^\s*[0-9]+\.[0-9]+ (?:Error|Fatal) /.test(text);
            }
            if (active) {
              const remaining = 16384 - block.length;
              block += text.slice(0, remaining);
              truncated ||= clipped || text.length > remaining;
            }
          };
          let clippedLine = false;
          const feed = (text: string, final = false) => {
            tail = (tail + text).slice(-8192);
            let start = 0;
            while (start < text.length) {
              const newline = text.indexOf("\n", start);
              const end = newline < 0 ? text.length : newline + 1;
              const remaining = 16384 - pending.length;
              pending += text.slice(start, Math.min(end, start + remaining));
              clippedLine ||= end - start > remaining;
              if (newline >= 0) {
                line(pending, clippedLine);
                pending = "";
                clippedLine = false;
              }
              start = end;
            }
            if (final && pending.length > 0) line(pending, clippedLine);
          };
          while (offset < Number(before.size)) {
            const count = yield* file.read(
              buffer.subarray(
                0,
                Math.min(buffer.length, Number(before.size) - offset),
              ),
              { position: BigInt(offset) },
            );
            if (count === 0) break;
            const bytes = buffer.subarray(0, count);
            hash.update(bytes);
            feed(redactor.push(decoder.decode(bytes, { stream: true })));
            offset += count;
          }
          feed(redactor.push(decoder.decode(), true), true);
          flush();
          const after = yield* file.stat;
          if (
            BigInt(offset) !== before.size ||
            after.size !== before.size ||
            Option.getOrUndefined(after.mtime)?.getTime() !==
              Option.getOrUndefined(before.mtime)?.getTime()
          )
            return yield* Effect.fail(
              new BoundaryError({
                boundary: path,
                message: "Engine log changed during diagnostic readback",
              }),
            );
          return {
            path,
            state: "read" as const,
            bytes: offset,
            sha256: hash.digest("hex"),
            errors,
            omittedErrors,
            tail,
          };
        }),
      );
      files.push(result);
    }
    const artifacts: { path: string; bytes: number }[] = [];
    for (const name of yield* fs.readDirectory(directory)) {
      if (
        !/(?:\.dmp|\.crash|\.ips)$/.test(name) &&
        !/^desync-report.*\.zip$/.test(name)
      )
        continue;
      const path = join(directory, name);
      yield* assertCanonicalPath(path);
      const stat = yield* fs.stat(path);
      if (stat.type !== "File")
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message: "Diagnostic artifact is not a regular file",
          }),
        );
      artifacts.push({ path, bytes: Number(stat.size) });
    }
    return yield* decode(
      EngineDiagnostics,
      { files, artifacts, artifactScope: "owned-run-directory-only" },
      "engine diagnostics",
    );
  });
}
