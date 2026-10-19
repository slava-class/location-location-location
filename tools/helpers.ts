import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  readJSON,
  RelativePath,
} from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";
import { withProcess } from "./process.ts";
import { newRun } from "./runs.ts";
import { assertWireSchema } from "./wire.ts";

const PythonHelper = RelativePath.check(
  Schema.isPattern(/^(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.py$/),
);

export function jsonSchema(schema: Schema.Constraint) {
  assertWireSchema(schema);
  const value = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });
  return { ...value.schema, $defs: value.definitions };
}
export function runHelper<
  Q extends Schema.ConstraintDecoder<unknown>,
  S extends Schema.ConstraintDecoder<unknown>,
>(
  project: ExecutionContext,
  helper: string,
  requestSchema: Q,
  resultSchema: S,
  input: unknown,
) {
  return Effect.gen(function* () {
    const path = yield* decode(PythonHelper, helper, "Python helper module");
    const request = yield* decode(requestSchema, input, `${helper} request`);
    yield* decode(Schema.Json, request, `${helper} JSON request`);
    const contract = yield* Effect.try({
      try: () => ({
        request: jsonSchema(requestSchema),
        result: jsonSchema(resultSchema),
      }),
      catch: (error) =>
        error instanceof BoundaryError
          ? error
          : new BoundaryError({
              boundary: helper,
              message: "Wire schema export failed",
            }),
    });
    const fs = yield* FileSystem.FileSystem;
    const environment = join(project.repoRoot, ".venv");
    yield* assertCanonicalPath(environment);
    if (!(yield* fs.exists(join(environment, "bin", "python"))))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: environment,
          message:
            "Locked Python environment is missing; run mise run setup before verification",
        }),
      );
    yield* assertCanonicalPath(join(project.repoRoot, path));
    if ((yield* fs.stat(join(project.repoRoot, path))).type !== "File")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message: "Python helper must be a regular repository file",
        }),
      );
    const run = yield* newRun(project, helper);
    const schemaFile = join(run.directory, "contract.json"),
      requestFile = join(run.directory, "request.json"),
      resultFile = join(run.directory, "result.json");
    yield* fs.writeFileString(schemaFile, JSON.stringify(contract));
    yield* fs.writeFileString(requestFile, JSON.stringify(request));
    yield* withProcess(
      {
        ...run,
        cwd: project.repoRoot,
        command: [
          "uv",
          "run",
          "--locked",
          "--no-sync",
          "--offline",
          "--no-python-downloads",
          "--project",
          project.repoRoot,
          "python",
          "-B",
          "-m",
          path.slice(0, -3).replaceAll("/", "."),
          schemaFile,
          requestFile,
          resultFile,
        ],
      },
      (child) => child.waitForExit,
    );
    return yield* readJSON(resultSchema, resultFile);
  });
}
