import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "luaparse";
import type { Expression, TableConstructorExpression } from "luaparse";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  readJSON,
  TunerId,
} from "../projects.ts";
import type { ResolvedProject } from "../projects.ts";
import { sourceSeal } from "../source.ts";
import { withReleaseLock } from "../locks.ts";
import { Preset, validateDescriptor, validateValues } from "./contracts.ts";
import type { Descriptor } from "./contracts.ts";

const Literal = Schema.Struct({
  type: Schema.Literal("NumericLiteral"),
  value: Schema.Number.check(Schema.isFinite()),
  range: Schema.Tuple([Schema.Int, Schema.Int]),
});
const hash = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
const invalid = (boundary: string, message: string) =>
  new BoundaryError({ boundary, message });

function literals(text: string, descriptor: Descriptor) {
  return Effect.gen(function* () {
    const ast = yield* Effect.try({
      try: () => parse(text, { luaVersion: "5.2", ranges: true }),
      catch: () =>
        invalid(
          descriptor.source.file,
          "Canonical configuration is not supported Lua 5.2 syntax",
        ),
    });
    const declarations = ast.body.filter(
      (node) =>
        node.type === "LocalStatement" &&
        node.variables.some((v) => v.name === descriptor.source.variable),
    );
    if (declarations.length !== 1)
      return yield* Effect.fail(
        invalid(
          descriptor.source.file,
          "Expected one canonical local configuration table",
        ),
      );
    const declaration = declarations[0]!;
    if (
      declaration.type !== "LocalStatement" ||
      declaration.variables.length !== 1 ||
      declaration.init.length !== 1
    )
      return yield* Effect.fail(
        invalid(
          descriptor.source.file,
          "Configuration must be a directly initialized local table",
        ),
      );
    const root = declaration.init[0]!;
    if (root.type !== "TableConstructorExpression")
      return yield* Effect.fail(
        invalid(
          descriptor.source.file,
          "Configuration initializer must be a literal table",
        ),
      );
    const returned = ast.body.at(-1);
    const boundRoots = new Set(
      descriptor.controls.flatMap((control) =>
        control.scope === "source"
          ? control.binding.paths.map((path) => path[0])
          : [],
      ),
    );
    // This is a literal configuration reader, not a Lua evaluator. Deferred
    // methods may accompany the table; executable initialization cannot.
    if (
      ast.body[0] !== declaration ||
      returned?.type !== "ReturnStatement" ||
      returned.arguments.length !== 1 ||
      returned.arguments[0]?.type !== "Identifier" ||
      returned.arguments[0].name !== descriptor.source.variable ||
      ast.body
        .slice(1, -1)
        .some(
          (node) =>
            node.type !== "FunctionDeclaration" ||
            node.identifier?.type !== "MemberExpression" ||
            node.identifier.base.type !== "Identifier" ||
            node.identifier.base.name !== descriptor.source.variable ||
            boundRoots.has(node.identifier.identifier.name),
        )
    )
      return yield* Effect.fail(
        invalid(
          descriptor.source.file,
          "Supported configuration modules contain one literal table, unbound deferred methods, and return that table without executing mutations",
        ),
      );
    const result = new Map<string, typeof Literal.Type>();
    for (const control of descriptor.controls) {
      if (control.scope !== "source") continue;
      for (const path of control.binding.paths) {
        let node: Expression = root;
        for (const part of path) {
          if (node.type !== "TableConstructorExpression")
            return yield* Effect.fail(
              invalid(
                path.join("."),
                "Source binding traverses a non-literal table",
              ),
            );
          const fields: TableConstructorExpression["fields"] = node.fields;
          // Computed keys could alias a selected key at runtime. Do not guess.
          if (fields.some((field) => field.type !== "TableKeyString"))
            return yield* Effect.fail(
              invalid(
                path.join("."),
                "Configuration table contains unsupported computed or positional keys",
              ),
            );
          const matches: typeof fields = fields.filter(
            (field) =>
              field.type === "TableKeyString" && field.key.name === part,
          );
          if (matches.length !== 1)
            return yield* Effect.fail(
              invalid(path.join("."), "Source binding is missing or ambiguous"),
            );
          node = matches[0]!.value;
        }
        const literal = yield* decode(
          Literal,
          node,
          `tuner source ${path.join(".")}`,
          true,
        );
        if (
          literal.range[0] < 0 ||
          literal.range[1] <= literal.range[0] ||
          literal.range[1] > text.length
        )
          return yield* Effect.fail(
            invalid(path.join("."), "Parser returned an invalid source range"),
          );
        result.set(path.join("."), literal);
      }
    }
    return result;
  });
}

export function readBaseline(text: string, descriptor: Descriptor) {
  return Effect.gen(function* () {
    const fields = yield* literals(text, descriptor);
    const values: Record<string, number | boolean> = {};
    for (const control of descriptor.controls) {
      if (control.scope === "preview") {
        values[control.key] = control.default;
        continue;
      }
      const readings = control.binding.paths.map(
        (path) =>
          fields.get(path.join("."))!.value / control.binding.multiplier,
      );
      const first = readings[0]!;
      if (readings.some((value) => Math.abs(value - first) > 1e-7))
        return yield* Effect.fail(
          invalid(
            control.key,
            "Canonical source values disagree for a shared tuner control",
          ),
        );
      values[control.key] = first;
    }
    yield* validateValues(descriptor, values);
    // Normalize representation only after proving every source value lies on
    // the declared grid; never round an invalid source into an accepted one.
    for (const control of descriptor.controls)
      if (control.kind === "number")
        values[control.key] = Number(
          Number(values[control.key]).toFixed(control.precision),
        );
    return yield* validateValues(descriptor, values);
  });
}

export function rewriteConfiguration(
  text: string,
  descriptor: Descriptor,
  input: unknown,
) {
  return Effect.gen(function* () {
    const values = yield* validateValues(descriptor, input, "source");
    const fields = yield* literals(text, descriptor);
    const edits: { start: number; end: number; text: string }[] = [];
    for (const control of descriptor.controls) {
      if (control.scope !== "source") continue;
      const value = values[control.key];
      if (typeof value !== "number")
        return yield* Effect.fail(
          invalid(control.key, "Source control is not numeric"),
        );
      const converted = value * control.binding.multiplier;
      if (!Number.isFinite(converted))
        return yield* Effect.fail(
          invalid(control.key, "Converted source value is not finite"),
        );
      for (const path of control.binding.paths) {
        const literal = fields.get(path.join("."))!;
        if (Math.abs(literal.value - converted) <= 1e-12) continue;
        edits.push({
          start: literal.range[0],
          end: literal.range[1],
          text: String(Number(converted.toPrecision(15))),
        });
      }
    }
    edits.sort((a, b) => b.start - a.start);
    let output = text;
    for (const edit of edits)
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    const roundTrip = yield* readBaseline(output, descriptor);
    for (const control of descriptor.controls)
      if (
        control.scope === "source" &&
        Math.abs(Number(roundTrip[control.key]) - Number(values[control.key])) >
          1e-7
      )
        return yield* Effect.fail(
          invalid(
            control.key,
            "Promoted source does not round-trip to the candidate",
          ),
        );
    return { text: output, edits: edits.length };
  });
}

export function resolveStudio(project: ResolvedProject, input: string) {
  return Effect.gen(function* () {
    const id = yield* decode(TunerId, input, "tuner selector");
    if (!project.development.tuners?.includes(id))
      return yield* Effect.fail(
        invalid(project.info.name, `Undeclared tuner: ${id}`),
      );
    const fs = yield* FileSystem.FileSystem;
    const directory = join(project.modRoot, "dev/tuners", id);
    const descriptorPath = join(directory, "descriptor.ts");
    yield* assertCanonicalPath(descriptorPath);
    const imported = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(descriptorPath).href),
      catch: () =>
        invalid(descriptorPath, "Cannot import trusted tuner descriptor"),
    });
    const descriptor = yield* validateDescriptor(imported.default);
    if (descriptor.id !== id)
      return yield* Effect.fail(
        invalid(id, "Descriptor identity differs from declared tuner"),
      );
    const sourcePath = join(project.modRoot, descriptor.source.file);
    yield* assertCanonicalPath(sourcePath);
    const text = yield* fs.readFileString(sourcePath);
    const baseline = yield* readBaseline(text, descriptor);
    const seal = yield* sourceSeal(project);
    return {
      project,
      id,
      directory,
      descriptor,
      sourcePath,
      text,
      baseline,
      sourceSha256: seal.sha256,
      configurationSha256: hash(text),
      descriptorSha256: hash(JSON.stringify(descriptor)),
    };
  });
}
export type Studio = Effect.Success<ReturnType<typeof resolveStudio>>;

export function makePreset(
  studio: Studio,
  session: string,
  revision: number,
  input: unknown,
  scope: "preview" | "source",
) {
  return Effect.gen(function* () {
    const candidate = yield* validateValues(studio.descriptor, input);
    const values: Record<string, number | boolean> = {};
    const units: Record<string, string> = {};
    for (const control of studio.descriptor.controls) {
      if (scope === "source" && control.scope === "preview") {
        if (candidate[control.key] !== studio.baseline[control.key])
          return yield* Effect.fail(
            invalid(
              control.key,
              "Changed preview-only controls cannot be exported for source promotion",
            ),
          );
        continue;
      }
      values[control.key] = candidate[control.key]!;
      units[control.key] = control.kind === "number" ? control.unit : "boolean";
    }
    yield* validateValues(studio.descriptor, values, scope);
    return yield* decode(
      Preset,
      {
        schema: 1,
        mod: {
          name: studio.project.info.name,
          version: studio.project.info.version,
        },
        tuner: studio.id,
        scope,
        sourceSha256: studio.sourceSha256,
        configurationSha256: studio.configurationSha256,
        descriptorSha256: studio.descriptorSha256,
        scene: studio.descriptor.scene,
        session,
        revision,
        values,
        units,
        restartRequired: scope === "source",
      },
      "tuner preset",
    );
  });
}

export function validatePreset(
  studio: Studio,
  input: unknown,
  scope: "preview" | "source",
) {
  return Effect.gen(function* () {
    const preset = yield* decode(Preset, input, "tuner preset");
    if (
      preset.scope !== scope ||
      preset.mod.name !== studio.project.info.name ||
      preset.mod.version !== studio.project.info.version ||
      preset.tuner !== studio.id ||
      preset.sourceSha256 !== studio.sourceSha256 ||
      preset.configurationSha256 !== studio.configurationSha256 ||
      preset.descriptorSha256 !== studio.descriptorSha256 ||
      preset.scene.id !== studio.descriptor.scene.id ||
      preset.scene.seed !== studio.descriptor.scene.seed ||
      preset.restartRequired !== (scope === "source")
    )
      return yield* Effect.fail(
        invalid(
          studio.id,
          "Preset is wrong-target, stale, or has incompatible scope/scene/restart metadata",
        ),
      );
    const expectedUnits = Object.fromEntries(
      studio.descriptor.controls
        .filter((c) => scope === "preview" || c.scope === "source")
        .map((c) => [c.key, c.kind === "number" ? c.unit : "boolean"]),
    );
    if (
      Object.keys(preset.units).length !== Object.keys(expectedUnits).length ||
      Object.entries(expectedUnits).some(
        ([key, value]) => preset.units[key] !== value,
      )
    )
      return yield* Effect.fail(
        invalid(studio.id, "Preset units do not match the descriptor"),
      );
    yield* validateValues(studio.descriptor, preset.values, scope);
    return preset;
  });
}

export function promotePreset(
  project: ResolvedProject,
  tuner: string,
  presetPath: string,
  apply: boolean,
) {
  return withReleaseLock(
    project,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const studio = yield* resolveStudio(project, tuner);
      const preset = yield* validatePreset(
        studio,
        yield* readJSON(Preset, presetPath),
        "source",
      );
      const changed = yield* rewriteConfiguration(
        studio.text,
        studio.descriptor,
        preset.values,
      );
      if (apply && changed.edits > 0) {
        const temporary = join(
          project.outputRoot,
          `promotion-${crypto.randomUUID()}.lua`,
        );
        const mode = (yield* fs.stat(studio.sourcePath)).mode;
        yield* Effect.acquireUseRelease(
          fs.writeFileString(temporary, changed.text, { flag: "wx", mode }),
          () =>
            Effect.gen(function* () {
              const current = yield* sourceSeal(project);
              if (
                current.sha256 !== studio.sourceSha256 ||
                (yield* fs.readFileString(studio.sourcePath)) !== studio.text
              )
                return yield* Effect.fail(
                  invalid(
                    tuner,
                    "Source changed during promotion; nothing was written",
                  ),
                );
              yield* fs.rename(temporary, studio.sourcePath);
            }),
          () => fs.remove(temporary, { force: true }).pipe(Effect.orDie),
        );
      }
      return {
        mod: project.info.name,
        tuner,
        mode: apply ? "applied" : "preview",
        file: studio.descriptor.source.file,
        beforeSha256: studio.configurationSha256,
        afterSha256: hash(changed.text),
        changedLiterals: changed.edits,
        values: preset.values,
        restartRequired: true,
        verificationRequired: true,
      };
    }),
  );
}
