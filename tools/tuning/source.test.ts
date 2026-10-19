import { beforeAll, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { BunServices } from "@effect/platform-bun";
import { resolve } from "node:path";
import { resolveProject } from "../projects.ts";
import {
  makePreset,
  readBaseline,
  resolveStudio,
  rewriteConfiguration,
  validatePreset,
} from "./source.ts";
import type { Studio } from "./source.ts";
import { validateDescriptor, validateValues } from "./contracts.ts";

let studio: Studio;
const session = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  const root = resolve(import.meta.dir, "../..");
  studio = await Effect.runPromise(
    Effect.gen(function* () {
      const project = yield* resolveProject(
        root,
        "reversed-underground-belt-detector",
        root,
      );
      return yield* resolveStudio(project, "warnings");
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
async function sourcePreset() {
  return await Effect.runPromise(
    makePreset(studio, session, 0, studio.baseline, "source"),
  );
}

test("baseline export and source promotion are byte-preserving when unchanged", async () => {
  const preset = await sourcePreset();
  expect(
    await Effect.runPromise(validatePreset(studio, preset, "source")),
  ).toEqual(preset);
  const result = await Effect.runPromise(
    rewriteConfiguration(studio.text, studio.descriptor, preset.values),
  );
  expect(result).toEqual({ text: studio.text, edits: 0 });
});

test("source promotion converts units, updates coupled fields, and preserves unrelated Lua", async () => {
  const preset = await sourcePreset();
  const values = {
    ...preset.values,
    period: 4.1,
    red: 23,
    green: 57,
    blue: 81,
  };
  const decorated =
    "-- A comment mentioning pulse_period=999 must survive.\n" + studio.text;
  const result = await Effect.runPromise(
    rewriteConfiguration(decorated, studio.descriptor, values),
  );
  const roundTrip = await Effect.runPromise(
    readBaseline(result.text, studio.descriptor),
  );
  expect({
    period: roundTrip.period,
    red: roundTrip.red,
    green: roundTrip.green,
    blue: roundTrip.blue,
  }).toEqual({ period: 4.1, red: 23, green: 57, blue: 81 });
  expect(
    result.text.slice(result.text.indexOf("function appearance.register")),
  ).toBe(decorated.slice(decorated.indexOf("function appearance.register")));
  expect(
    result.text.startsWith(
      "-- A comment mentioning pulse_period=999 must survive.\n",
    ),
  ).toBe(true);
  // Reading the coupled bindings also rejects any disagreement between mouth/span channels.
  const repeat = await Effect.runPromise(
    rewriteConfiguration(result.text, studio.descriptor, values),
  );
  expect(repeat).toEqual({ text: result.text, edits: 0 });
});

test("invalid candidates reject unknown keys, fractional steps, non-finite values and wrong scalar types", async () => {
  for (const patch of [
    { period: 0.7 + 0.05 },
    { period: Number.NaN },
    { period: Infinity },
    { span_limit: 33 },
    { show: 1 },
    { unknown: true },
  ]) {
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          validateValues(studio.descriptor, { ...studio.baseline, ...patch }),
        ),
      ),
    ).toBe(true);
  }
});

test("preview may explore larger spans but source promotion enforces hierarchy", async () => {
  const candidate = { ...studio.baseline, mouth_scale: 1, span_scale: 2 };
  expect(
    await Effect.runPromise(validateValues(studio.descriptor, candidate)),
  ).toEqual(candidate);
  expect(
    Exit.isFailure(
      await Effect.runPromiseExit(
        makePreset(studio, session, 1, candidate, "source"),
      ),
    ),
  ).toBe(true);
});

test("preview-only experiments cannot be silently discarded by source export", async () => {
  for (const patch of [
    { show: false },
    { pulse: false },
    { span: false },
    { span_limit: 2 },
  ]) {
    const candidate = { ...studio.baseline, ...patch };
    const preview = await Effect.runPromise(
      makePreset(studio, session, 1, candidate, "preview"),
    );
    expect(preview.values).toEqual(candidate);
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          makePreset(studio, session, 1, candidate, "source"),
        ),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(validatePreset(studio, preview, "source")),
      ),
    ).toBe(true);
  }
});

test("wrong-target, stale-source and incompatible metadata presets are rejected", async () => {
  const preset = await sourcePreset();
  for (const patch of [
    { mod: { ...preset.mod, name: "location-location-location" } },
    { mod: { ...preset.mod, version: "99.0.0" } },
    { sourceSha256: "0".repeat(64) },
    { configurationSha256: "0".repeat(64) },
    { descriptorSha256: "0".repeat(64) },
    { tuner: "other" },
    { scene: { ...preset.scene, seed: preset.scene.seed + 1 } },
    { restartRequired: false },
    { units: { ...preset.units, period: "ticks" } },
    { units: { ...preset.units, undeclared: "unit" } },
    { path: "../../other.lua" },
    { values: { ...preset.values, show: true } },
  ])
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          validatePreset(studio, { ...preset, ...patch }, "source"),
        ),
      ),
    ).toBe(true);
});

test("computed, missing, duplicate and nonliteral source bindings fail closed", async () => {
  const descriptor = {
    ...studio.descriptor,
    source: { file: "appearance.lua", variable: "appearance" },
    controls: [studio.descriptor.controls[0]!],
    promotionRules: [],
  };
  for (const source of [
    "local appearance={pulse_period=120,pulse_period=180}; return appearance",
    "local appearance={pulse_period=60*3}; return appearance",
    "local appearance={other=120}; return appearance",
    'local appearance={["pulse_period"]=180}; return appearance',
    "local appearance={pulse_period=180}; local appearance={pulse_period=240}; return appearance",
  ])
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(readBaseline(source, descriptor)),
      ),
    ).toBe(true);
});

test("descriptor controls reject duplicate ownership and invalid numeric intervals", async () => {
  const first = studio.descriptor.controls[0]!;
  for (const descriptor of [
    { ...studio.descriptor, id: "warnings\n" },
    { ...studio.descriptor, controls: [...studio.descriptor.controls, first] },
    {
      ...studio.descriptor,
      controls: [{ ...first, key: "new_key" }, ...studio.descriptor.controls],
    },
    { ...studio.descriptor, controls: [{ ...first, min: 5, max: 4 }] },
    {
      ...studio.descriptor,
      promotionRules: [{ lower: "show", upper: "period" }],
    },
  ])
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(validateDescriptor(descriptor)),
      ),
    ).toBe(true);
});

test("source defaults reject module-level mutation or replacement after initialization", async () => {
  for (const statement of [
    "appearance.pulse_period = 240",
    "local alias = appearance; alias.pulse_period = 240",
    "setmetatable(appearance, {})",
    "function appearance.pulse_period() return 240 end",
  ]) {
    const mutated = studio.text.replace(
      "return appearance",
      `${statement}\nreturn appearance`,
    );
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(readBaseline(mutated, studio.descriptor)),
      ),
    ).toBe(true);
  }
});
