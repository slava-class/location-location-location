import { BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import { dirname, resolve } from "node:path";
import { BoundaryError, contains, decode, RelativePath } from "./projects.ts";
import { sarif, SourceIssue } from "./quality-report.ts";
import { runCLI } from "./cli-runtime.ts";

function destinations(markdown: string) {
  const targets: string[] = [];
  // The same native-parser approach as Shivai: normalize destination tokens,
  // never reinterpret escaped filename punctuation as new Markdown syntax.
  const collect = (target: string) =>
    targets.push(
      target.replace(
        /\\([!-/:-@[-`{-~])|&(?:#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi,
        (token, escaped: string | undefined) =>
          escaped ?? Bun.markdown.render(token),
      ),
    );
  Bun.markdown.render(markdown, {
    link: (_children, { href }) => {
      collect(href);
      return "";
    },
    image: (_children, { src }) => {
      collect(src);
      return "";
    },
  });
  return targets;
}

export function checkSources(directory: string, inputs: readonly string[]) {
  return Effect.gen(function* () {
    const paths = yield* decode(
      Schema.Array(RelativePath).check(Schema.isMinLength(1)),
      inputs,
      "source check selection",
    );
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(directory);
    const issues: (typeof SourceIssue.Type)[] = [];
    for (const path of paths) {
      const absolute = resolve(root, path);
      if (!contains(root, yield* fs.realPath(absolute))) {
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message: "Source input resolves outside the repository",
          }),
        );
      }
      const stat = yield* fs.stat(absolute);
      if (stat.type !== "File" || Number(stat.size) > 16 * 1024 * 1024) {
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message:
              "Source check requires regular text files no larger than 16 MiB",
          }),
        );
      }
      const bytes = yield* fs.readFile(absolute);
      const issue = (rule: string, message: string, line?: number) =>
        issues.push({
          path,
          rule,
          message,
          severity: "error",
          ...(line === undefined ? {} : { line }),
        });
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        issue("invalid-utf8", "Source is not valid UTF-8");
        continue;
      }
      if (text.includes("\0")) {
        issue("nul-byte", "Text source contains a NUL byte");
        continue;
      }
      for (const [index, line] of text.split("\n").entries()) {
        if (/^(?:<{7}|>{7}|\|{7})(?: |$)/.test(line))
          issue(
            "merge-conflict",
            "Unresolved merge-conflict marker",
            index + 1,
          );
      }
      if (!path.endsWith(".md")) continue;
      for (const destination of new Set(destinations(text))) {
        if (
          /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination) &&
          !/^(?:file:|[a-z]:[\\/])/i.test(destination)
        )
          continue;
        let target: string;
        try {
          target = decodeURIComponent(destination.split(/[?#]/, 1)[0]!);
        } catch {
          issue("invalid-link", `Invalid URL encoding: ${destination}`);
          continue;
        }
        if (!target) continue;
        if (
          /^(?:file:|[a-z]:[\\/]|~\/|\/(?:Users|home|Volumes|private|tmp|workspace)\/)/i.test(
            target,
          ) ||
          target.includes("\\")
        ) {
          issue(
            "machine-local-link",
            `Non-portable local link: ${destination}`,
          );
          continue;
        }
        const linked = target.startsWith("/")
          ? resolve(root, "." + target)
          : resolve(dirname(absolute), target);
        if (!contains(root, linked)) {
          issue("escaping-link", `Link leaves the repository: ${destination}`);
          continue;
        }
        if (!(yield* fs.exists(linked))) {
          issue("missing-link", `Missing local target: ${destination}`);
          continue;
        }
        if (!contains(root, yield* fs.realPath(linked)))
          issue(
            "escaping-link",
            `Link resolves outside the repository: ${destination}`,
          );
      }
    }
    return yield* decode(
      Schema.Array(SourceIssue),
      issues,
      "source diagnostics",
    );
  });
}

if (import.meta.main) {
  const command = Command.make(
    "source-check",
    {
      paths: Argument.String("paths").pipe(Argument.variadic({ min: 1 })),
    },
    ({ paths }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const issues = yield* checkSources(
          yield* fs.realPath(process.cwd()),
          paths,
        );
        yield* Console.log(JSON.stringify(sarif("source-check", issues)));
        if (issues.length)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: "source-check",
              message: `${issues.length} source issues`,
            }),
          );
      }),
  );
  runCLI(
    Command.runWith(command, { version: "workspace" })(
      process.argv.slice(2),
    ).pipe(Effect.provide(BunServices.layer)),
  );
}
