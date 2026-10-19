import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Schema } from "effect";
import { Command } from "effect/cli";
import { BoundaryError, decode, RelativePath } from "./projects.ts";
import { runCLI } from "./cli-runtime.ts";

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export const SourceIssue = Schema.Struct({
  path: RelativePath,
  rule: Schema.NonEmptyString,
  severity: Schema.Literals(["error", "warning", "note"]),
  message: Schema.NonEmptyString,
  line: Schema.optionalKey(PositiveInt),
  column: Schema.optionalKey(PositiveInt),
});

export function sarif(
  tool: string,
  issues: readonly (typeof SourceIssue.Type)[],
) {
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: tool } },
        results: issues.map((issue) => ({
          ruleId: issue.rule,
          level: issue.severity,
          message: { text: issue.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: issue.path.split("/").map(encodeURIComponent).join("/"),
                },
                ...(issue.line === undefined
                  ? {}
                  : {
                      region: {
                        startLine: issue.line,
                        ...(issue.column === undefined
                          ? {}
                          : { startColumn: issue.column }),
                      },
                    }),
              },
            },
          ],
        })),
      },
    ],
  };
}

const TyReport = Schema.Array(
  Schema.Struct({
    check_name: Schema.NonEmptyString,
    description: Schema.NonEmptyString,
    severity: Schema.Literals([
      "blocker",
      "critical",
      "major",
      "minor",
      "info",
    ]),
    location: Schema.Struct({
      path: RelativePath,
      positions: Schema.Struct({
        begin: Schema.Struct({ line: PositiveInt, column: PositiveInt }),
      }),
    }),
  }),
);

export function tyIssues(input: unknown) {
  return Effect.gen(function* () {
    const report = yield* decode(
      TyReport,
      input,
      "ty GitLab diagnostics",
      true,
    );
    return yield* decode(
      Schema.Array(SourceIssue),
      report.map((issue) => ({
        path: issue.location.path,
        rule: issue.check_name,
        severity:
          issue.severity === "info"
            ? "note"
            : issue.severity === "minor"
              ? "warning"
              : "error",
        message: issue.description,
        line: issue.location.positions.begin.line,
        column: issue.location.positions.begin.column,
      })),
      "normalized ty diagnostics",
    );
  });
}

if (import.meta.main) {
  const command = Command.make("ty-report", {}, () =>
    Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: async () => {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          const parts: string[] = [];
          let bytes = 0;
          for await (const chunk of Bun.stdin.stream()) {
            bytes += chunk.byteLength;
            if (bytes > 4 * 1024 * 1024)
              throw new Error("Report exceeds 4 MiB");
            parts.push(decoder.decode(chunk, { stream: true }));
          }
          parts.push(decoder.decode());
          return parts.join("");
        },
        catch: () =>
          new BoundaryError({
            boundary: "ty report",
            message: "Cannot read a bounded UTF-8 report",
          }),
      });
      const input: unknown = yield* Effect.try({
        try: () => JSON.parse(text),
        catch: () =>
          new BoundaryError({
            boundary: "ty report",
            message: "Malformed JSON report",
          }),
      });
      yield* Console.log(JSON.stringify(sarif("ty", yield* tyIssues(input))));
    }),
  );
  runCLI(
    Command.runWith(command, { version: "workspace" })(
      process.argv.slice(2),
    ).pipe(Effect.provide(BunServices.layer)),
  );
}
