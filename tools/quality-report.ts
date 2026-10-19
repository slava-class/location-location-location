import { Schema } from "effect";
import { RelativePath } from "./projects.ts";

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
