import { Effect, Schema } from "effect";
import { AbsolutePath, ModIdentity, Sha256 } from "../contracts.ts";
import { BoundaryError, decode, RelativePath, TunerId } from "../projects.ts";
import { RunId } from "../logs.ts";
import { Engine } from "../engine.ts";
import { RconOptions } from "../rcon.ts";

const Key = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]{0,47}$(?![\s\S])/u),
);
const Finite = Schema.Number.check(Schema.isFinite());
const Numeric = {
  kind: Schema.Literal("number"),
  key: Key,
  label: Schema.NonEmptyString,
  min: Finite,
  max: Finite,
  step: Finite.check(Schema.isGreaterThan(0)),
  precision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  unit: Schema.String.check(Schema.isMaxLength(16)),
};
const SourceControl = Schema.Struct({
  ...Numeric,
  scope: Schema.Literal("source"),
  phase: Schema.Literal("restart"),
  binding: Schema.Struct({
    paths: Schema.Array(
      Schema.Array(Key).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    multiplier: Finite.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(1_000_000),
    ),
  }),
});
const PreviewNumber = Schema.Struct({
  ...Numeric,
  scope: Schema.Literal("preview"),
  phase: Schema.Literal("live"),
  default: Finite,
});
const PreviewBoolean = Schema.Struct({
  kind: Schema.Literal("boolean"),
  key: Key,
  label: Schema.NonEmptyString,
  scope: Schema.Literal("preview"),
  phase: Schema.Literal("live"),
  default: Schema.Boolean,
});
const Control = Schema.Union([SourceControl, PreviewNumber, PreviewBoolean]);
const StudioDescriptor = Schema.Struct({
  schema: Schema.Literal(1),
  id: TunerId,
  title: Schema.NonEmptyString,
  evidence: Schema.Literal("proxy"),
  source: Schema.Struct({ file: RelativePath, variable: Key }),
  scene: Schema.Struct({
    id: TunerId,
    seed: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 4294967295 }),
    ),
  }),
  controls: Schema.Array(Control).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
  ),
  promotionRules: Schema.Array(Schema.Struct({ lower: Key, upper: Key })).check(
    Schema.isMaxLength(32),
  ),
});
export type Descriptor = typeof StudioDescriptor.Type;
export const Values = Schema.Record(
  Key,
  Schema.Union([Finite, Schema.Boolean]),
);
export const Revision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 2147483646 }),
);
export const Preset = Schema.Struct({
  schema: Schema.Literal(1),
  mod: ModIdentity,
  tuner: TunerId,
  scope: Schema.Literals(["preview", "source"]),
  sourceSha256: Sha256,
  configurationSha256: Sha256,
  descriptorSha256: Sha256,
  scene: StudioDescriptor.fields.scene,
  session: RunId,
  revision: Revision,
  values: Values,
  units: Schema.Record(Key, Schema.String),
  restartRequired: Schema.Boolean,
});

export const studioViewport = {
  width: 1600,
  height: 1000,
  scale: 1,
  locale: "en",
} as const;
const Viewport = Schema.Struct({
  width: Schema.Literal(studioViewport.width),
  height: Schema.Literal(studioViewport.height),
  scale: Schema.Literal(studioViewport.scale),
  locale: Schema.Literal(studioViewport.locale),
});
export const StudioRequest = Schema.Struct({
  schema: Schema.Literal(1),
  session: RunId,
  mod: ModIdentity,
  descriptor: StudioDescriptor,
  baseline: Values,
  viewport: Viewport,
  sourceSha256: Sha256,
  configurationSha256: Sha256,
  descriptorSha256: Sha256,
});

export const StudioState = Schema.Struct({
  schema: Schema.Literal(1),
  session: RunId,
  mod: ModIdentity,
  tuner: TunerId,
  sourceSha256: Sha256,
  configurationSha256: Sha256,
  descriptorSha256: Sha256,
  revision: Revision,
  active: Schema.Boolean,
  ready: Schema.Boolean,
  discardRequested: Schema.Boolean,
  canUndo: Schema.Boolean,
  values: Values,
  baseline: Values,
  tick: Schema.Int,
  observations: Schema.Record(
    Schema.String,
    Schema.Union([Finite, Schema.Boolean]),
  ),
});
export const StudioManifest = Schema.Struct({
  schema: Schema.Literal(1),
  session: RunId,
  clientRun: RunId,
  mod: ModIdentity,
  tuner: TunerId,
  directory: AbsolutePath,
  clientDirectory: AbsolutePath,
  status: Schema.Literals(["starting", "ready", "stopped", "failed"]),
  descriptor: StudioDescriptor,
  baseline: Values,
  viewport: Viewport,
  sourceSha256: Sha256,
  configurationSha256: Sha256,
  descriptorSha256: Sha256,
  artifactSha256: Sha256,
  engine: Engine,
});
export const StudioConnection = Schema.Struct({
  schema: Schema.Literal(1),
  session: RunId,
  ...RconOptions.fields,
});

export function validateDescriptor(input: unknown) {
  return Effect.gen(function* () {
    const descriptor = yield* decode(
      StudioDescriptor,
      input,
      "tuner descriptor",
    );
    const keys = new Set<string>();
    const paths = new Set<string>();
    for (const control of descriptor.controls) {
      if (keys.has(control.key))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: descriptor.id,
            message: "Duplicate tuner control",
          }),
        );
      keys.add(control.key);
      if (
        control.kind === "number" &&
        (control.min >= control.max || control.step > control.max - control.min)
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: control.key,
            message: "Invalid tuner numeric interval",
          }),
        );
      if (
        control.kind === "number" &&
        [control.min, control.max, control.step].some(
          (value) => Number(value.toFixed(control.precision)) !== value,
        )
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: control.key,
            message:
              "Control precision cannot represent its numeric interval and increment",
          }),
        );
      if (control.scope === "source")
        for (const path of control.binding.paths) {
          const key = path.join(".");
          if (paths.has(key))
            return yield* Effect.fail(
              new BoundaryError({
                boundary: key,
                message: "Tuner source bindings overlap",
              }),
            );
          paths.add(key);
        }
    }
    for (const rule of descriptor.promotionRules) {
      const lower = descriptor.controls.find((c) => c.key === rule.lower);
      const upper = descriptor.controls.find((c) => c.key === rule.upper);
      if (
        lower?.scope !== "source" ||
        upper?.scope !== "source" ||
        lower.key === upper.key
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: descriptor.id,
            message:
              "Promotion rules require distinct source-backed numeric controls",
          }),
        );
    }
    return descriptor;
  });
}

function valuesSchema(
  descriptor: Descriptor,
  scope: "preview" | "source" = "preview",
) {
  return Schema.Struct(
    Object.fromEntries(
      descriptor.controls
        .filter((c) => scope === "preview" || c.scope === "source")
        .map((control) => [
          control.key,
          control.kind === "boolean"
            ? Schema.Boolean
            : Finite.check(
                Schema.isBetween({
                  minimum: control.min,
                  maximum: control.max,
                }),
                Schema.makeFilter(
                  (value) =>
                    Math.abs(
                      (value - control.min) / control.step -
                        Math.round((value - control.min) / control.step),
                    ) <= 1e-7,
                ),
              ),
        ]),
    ),
  );
}
export function validateValues(
  descriptor: Descriptor,
  input: unknown,
  scope: "preview" | "source" = "preview",
) {
  return Effect.gen(function* () {
    const values = yield* decode(
      valuesSchema(descriptor, scope),
      input,
      "tuner values",
    );
    if (scope === "source")
      for (const rule of descriptor.promotionRules) {
        const lower = values[rule.lower],
          upper = values[rule.upper];
        if (
          typeof lower !== "number" ||
          typeof upper !== "number" ||
          lower > upper
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: descriptor.id,
              message: `Promotion requires ${rule.lower} <= ${rule.upper}`,
            }),
          );
      }
    return values;
  });
}
