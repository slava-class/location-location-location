import { Console, Effect, Exit, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  BoundaryError,
  decode,
  ModId,
  TestProfile,
  Version,
  resolveProject,
} from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import {
  Engine,
  GraphicsPreset,
  resolveEngine,
} from "../../../tools/engine.ts";
import { PackageResult, Sha256 } from "../../../tools/contracts.ts";
import { packageProject } from "../../../tools/packaging.ts";
import { prepareProfile } from "../../../tools/profiles.ts";
import {
  evaluate,
  SavedGame,
  saveEngineSession,
  withEngineSession,
} from "../../../tools/engine-session.ts";
import {
  NativeClientEvidence,
  prepareNativeClient,
  withNativeClient,
} from "../../../tools/native-client.ts";
import {
  SourceSeal,
  sourceSeal,
  verifySourceSeal,
} from "../../../tools/source.ts";
import { verifyEngineDiagnostics } from "../../../tools/engine-diagnostics.ts";
import { hashFile } from "../../../tools/files.ts";
import { luaString } from "../../../tools/lua-string.ts";
import { RunId } from "../../../tools/logs.ts";
import { verifyPNG } from "../../../tools/images.ts";
import { runCommand } from "../../../tools/commands.ts";

export const FluidPolicy = Schema.Literals([
  "declutter",
  "native",
  "pump-excluded",
]);
const NativePorts = Schema.Array(Schema.Boolean).check(
  Schema.makeFilter((ports) => ports.length > 0),
);
const NativeFluids = Schema.Struct({ pump: NativePorts, boiler: NativePorts });

const Capacity = Schema.Struct({
  value: Schema.optionalKey(Schema.Number),
  approximate: Schema.optionalKey(Schema.Boolean),
  reason: Schema.optionalKey(Schema.String),
});
const OwnerPermission = Schema.Struct({
  caller: Schema.Literal("level"),
  directRejected: Schema.Literal(true),
  ownerApplied: Schema.Literal(true),
  restored: Schema.Literal(true),
  rejectedStartup: Schema.Literal(true),
});

const Player = Schema.Struct({
  index: Schema.Int,
  connected: Schema.Boolean,
  locale: Schema.String,
  surface: Schema.String,
  selected: Schema.Int,
  ghost: Schema.Boolean,
  recipeNames: Schema.Int,
  alt: Schema.Boolean,
  active: Schema.Boolean,
  exact: Schema.Int,
  nearby: Schema.Int,
  pointerCells: Schema.Int,
  pointerFocus: Schema.optionalKey(
    Schema.Struct({ x: Schema.Number, y: Schema.Number }),
  ),
  pointerPending: Schema.Int,
  pointerCellSize: Schema.optionalKey(Schema.Int),
  fluids: Schema.Int,
  recipe: Schema.String,
  radius: Schema.Int,
  nativeRadius: Schema.Int,
  nearbyEnabled: Schema.Boolean,
  nativeNearby: Schema.Boolean,
  focus: Schema.String,
  nativeFocus: Schema.String,
  warnings: Schema.Int,
  selectedWarnings: Schema.Int,
  warningMode: Schema.String,
  nativeWarningMode: Schema.String,
  capacity: Schema.optionalKey(Capacity),
});
const Observation = Schema.Struct({
  tick: Schema.Int,
  players: Schema.Array(Player),
  renderCount: Schema.Int,
  audienceErrors: Schema.Int,
});
const CaptureGeometry = Schema.Struct({
  width: Schema.Int,
  height: Schema.Int,
  scale: Schema.Number,
  locale: Schema.String,
  zoom: Schema.Number,
});
const Capture = Schema.Struct({
  ...CaptureGeometry.fields,
  path: Schema.String,
  sha256: Sha256,
  player: Schema.Int,
});
const Case = Schema.Struct({ name: Schema.String, ...Observation.fields });
const ReplacedObjects = Schema.Struct({
  "inserter-throughput-fork": Schema.Array(Schema.Int),
  "fluid-connection-indicators": Schema.Array(Schema.Int),
});
const Replacement = Schema.Struct({
  objects: ReplacedObjects,
  removed: Schema.Boolean,
});
const Phase = Schema.Struct({
  name: Schema.String,
  run: RunId,
  enabled: Schema.Boolean,
  mods: Schema.Record(ModId, Version),
  save: SavedGame,
  clients: Schema.Array(NativeClientEvidence),
  cases: Schema.Array(Case),
  captures: Schema.Array(Capture),
  factory: Schema.String,
  nativeFluids: NativeFluids,
  ownerPermission: Schema.NullOr(OwnerPermission),
  replacement: Schema.NullOr(Replacement),
});
const NativeVerification = Schema.Struct({
  schema: Schema.Literal(1),
  source: SourceSeal,
  artifact: PackageResult,
  engine: Engine,
  profile: TestProfile,
  retained: Schema.Boolean,
  layout: Schema.Boolean,
  lifecycle: Schema.Boolean,
  fluidPolicy: FluidPolicy,
  physicalInput: Schema.Literal("not-exercised-by-scripted-scenarios"),
  phases: Schema.Array(Phase),
});
const Farm = Schema.Struct({
  name: Schema.String,
  slots: Schema.Int,
  module: Schema.String,
  recipe: Schema.String,
  unit: Schema.Int,
  position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
});
const failure = (message: string) =>
  new BoundaryError({ boundary: "No ALT Needed native verification", message });

export function verifyNative(
  project: ResolvedProject,
  options: {
    readonly engine: string;
    readonly graphics: typeof GraphicsPreset.Type;
    readonly profile: typeof TestProfile.Type;
    readonly retained: boolean;
    readonly layout: boolean;
    readonly lifecycle: boolean;
    readonly fluidPolicy: typeof FluidPolicy.Type;
    readonly interactive: boolean;
  },
) {
  return Effect.gen(function* () {
    if (options.layout && options.profile !== "py-hardmode")
      return yield* Effect.fail(
        failure(
          "The optional pY layout trial requires the py-hardmode profile",
        ),
      );
    const fs = yield* FileSystem.FileSystem;
    const companion = options.retained
      ? yield* resolveProject(
          project.repoRoot,
          "recipe-name-tooltip",
          project.repoRoot,
        )
      : undefined;
    const selected =
      companion === undefined
        ? project
        : yield* resolveProject(
            project.repoRoot,
            project.info.name,
            project.repoRoot,
            { companions: [companion.info.name] },
          );
    const source = yield* sourceSeal(selected);
    const engine = yield* resolveEngine(project, "native", options.engine);
    const artifact = yield* packageProject(project);
    const companions =
      companion === undefined
        ? []
        : [{ project: companion, artifact: yield* packageProject(companion) }];
    const lua = yield* fs.readFileString(
      join(project.modRoot, "dev/native-verification.lua"),
    );
    const phases: (typeof Phase.Type)[] = [];
    let saved: typeof SavedGame.Type | undefined;
    let factory: string | undefined;
    let replacedObjects: typeof ReplacedObjects.Type | undefined;
    let startupSettings: { file: string; sha256: string } | undefined;
    if (options.fluidPolicy !== "declutter") {
      // A disabled-only base profile has no mod settings to serialize.
      // Obtain the engine's own defaults from an explicit enabled preparation.
      const preparation = yield* prepareProfile(
        project,
        engine,
        options.profile,
        "en",
        artifact,
        [],
        "session",
      );
      yield* withEngineSession(
        preparation,
        engine,
        {
          purpose: "native-startup-settings",
          evidence: "session",
          expectedMods: preparation.expectedMods,
          deadlineMs: 180000,
        },
        (session) => session.process.stop,
      );
      const directory = join(preparation.directory, "startup-settings");
      yield* fs.makeDirectory(directory);
      const file = join(directory, "mod-settings.dat");
      yield* fs.copyFile(
        join(preparation.directory, "mods/mod-settings.dat"),
        file,
      );
      yield* runCommand(project, "native-fluid-policy", [
        process.execPath,
        join(
          project.repoRoot,
          "node_modules/factoriomod-debug/dist/fmtk-cli.js",
        ),
        "settings",
        "--modsPath",
        directory,
        "set",
        "startup",
        `no-alt-needed-fluid-${options.fluidPolicy === "native" ? "declutter" : "pump"}`,
        "false",
        "--type",
        "bool",
      ]);
      startupSettings = { file, sha256: yield* hashFile(file) };
    }
    const sequence = options.lifecycle
      ? [
          { name: "existing-factory", enabled: false },
          { name: "insert", enabled: true },
          { name: "fresh-reload", enabled: true },
          { name: "remove", enabled: false },
          { name: "re-add", enabled: true },
        ]
      : [
          ...(options.fluidPolicy === "declutter"
            ? []
            : [{ name: "native-baseline", enabled: false }]),
          { name: "exact-package", enabled: true },
          { name: "fresh-reload", enabled: true },
        ];
    for (const phase of sequence) {
      const host = yield* prepareProfile(
        project,
        engine,
        options.profile,
        "en",
        artifact,
        companions,
        "session",
        {
          dependencies: (
            project.development.verificationDependencies ?? []
          ).filter((name) =>
            Object.hasOwn(ReplacedObjects.fields, name)
              ? phase.name === "existing-factory"
              : name === "pYBetterItemFluidStorageIcons"
                ? options.layout
                : options.retained,
          ),
          productEnabled: phase.enabled,
          ...(startupSettings === undefined
            ? {}
            : { settings: startupSettings }),
        },
      );
      if (saved) {
        if ((yield* hashFile(saved.archive)) !== saved.sha256)
          return yield* Effect.fail(failure("Saved input changed"));
        yield* fs.copyFile(saved.archive, join(host.directory, "input.zip"));
        if (
          (yield* hashFile(join(host.directory, "input.zip"))) !== saved.sha256
        )
          return yield* Effect.fail(failure("Copied save differs"));
      }
      const first = yield* prepareNativeClient(project, host, {
        profile: "no-alt-native-en",
        playerName: "NoAltNativeA",
        viewport: { width: 1600, height: 1000, scale: 1, locale: "en" },
        graphics: options.graphics,
      });
      const second = phase.enabled
        ? yield* prepareNativeClient(project, host, {
            profile: "no-alt-native-de",
            playerName: "NoAltNativeB",
            viewport: { width: 1600, height: 1000, scale: 0.75, locale: "de" },
            graphics: options.graphics,
          })
        : undefined;
      const cases: (typeof Case.Type)[] = [],
        captures: (typeof Capture.Type)[] = [],
        clients: (typeof NativeClientEvidence.Type)[] = [];
      let ownerPermission: typeof OwnerPermission.Type | null = null;
      let replacement: typeof Replacement.Type | null = null;
      const outcome = yield* withEngineSession(
        host,
        engine,
        {
          purpose: `no-alt-${phase.name}`,
          evidence: "session",
          // Includes both sequential Extreme-client startups and native assertions.
          deadlineMs: 1200000,
          expectedMods: host.expectedMods,
        },
        (session) =>
          Effect.gen(function* () {
            const call = <S extends Schema.ConstraintDecoder<unknown>>(
              name: string,
              value: unknown,
              schema: S,
              product = name === "setting" || (name === "alt" && phase.enabled),
            ) =>
              evaluate(
                session.client,
                `local V=(function() ${lua}\nend)(); return V.${name}(helpers.json_to_table(${luaString(JSON.stringify(value))}))`,
                schema,
                product ? project.info.name : undefined,
              );
            if (factory === undefined)
              factory = yield* call("create", null, Schema.String);
            else if ((yield* call("factory", null, Schema.String)) !== factory)
              return yield* Effect.fail(
                failure(`Factory changed across ${phase.name}`),
              );
            const nativeFluids = yield* call(
              "nativeFluids",
              null,
              NativeFluids,
            );
            const baseline = phases.find((item) => !item.enabled)?.nativeFluids;
            for (const category of ["pump", "boiler"] as const) {
              const suppressed =
                phase.enabled &&
                options.fluidPolicy !== "native" &&
                !(
                  category === "pump" && options.fluidPolicy === "pump-excluded"
                );
              if (
                suppressed
                  ? !nativeFluids[category].every(Boolean)
                  : baseline !== undefined &&
                    !isDeepStrictEqual(
                      nativeFluids[category],
                      baseline[category],
                    )
              )
                return yield* Effect.fail(
                  failure(
                    `Native ${category} connection policy differs in ${phase.name}`,
                  ),
                );
            }
            const exercise = (
              indices: readonly number[],
              connected: readonly {
                readonly profile: {
                  readonly run: { readonly directory: string };
                };
                readonly evidence: typeof NativeClientEvidence.Type;
              }[],
            ) =>
              Effect.gen(function* () {
                yield* call("prepare", indices, Schema.Int);
                yield* waitUntil(
                  () => call("visible", null, Schema.Boolean),
                  (value) => value,
                  "charted fixture",
                );
                const capture = (
                  index: number,
                  name: string,
                  position?: { x: number; y: number },
                  zoom?: number,
                ) =>
                  Effect.gen(function* () {
                    const path = `native-proof/${phase.name}-${name}.png`;
                    const framed = yield* call(
                      "frame",
                      {
                        player: index,
                        ...(position ? { position } : {}),
                        ...(zoom ? { zoom } : {}),
                      },
                      Schema.Int,
                    );
                    yield* waitUntil(
                      () =>
                        evaluate(
                          session.client,
                          "return game.tick",
                          Schema.Int,
                        ),
                      (tick) => tick >= framed + 30,
                      "native view and overlay refresh",
                    );
                    const geometry = yield* call(
                      "capture",
                      {
                        player: index,
                        path,
                        ...(position ? { position } : {}),
                        ...(zoom ? { zoom } : {}),
                      },
                      CaptureGeometry,
                    );
                    const client = connected.find(
                      (item) => item.evidence.player.index === index,
                    );
                    if (!client)
                      return yield* Effect.fail(
                        failure("Capture has no real client"),
                      );
                    const file = join(
                      client.profile.run.directory,
                      "script-output",
                      path,
                    );
                    // The engine creates the file before its asynchronous PNG writer finishes.
                    // Hold the scene and poll read-only decoding; never repeat the capture mutation.
                    const completed = yield* waitUntil(
                      () =>
                        verifyPNG(file, geometry.width, geometry.height).pipe(
                          Effect.exit,
                        ),
                      Exit.isSuccess,
                      "complete native PNG",
                    );
                    if (Exit.isFailure(completed))
                      return yield* Effect.failCause(completed.cause);
                    captures.push({
                      ...geometry,
                      player: index,
                      path: file,
                      sha256: completed.value.sha256,
                    });
                  });
                const a = indices[0]!;
                if (replacedObjects !== undefined) {
                  const removed = yield* call(
                    "replacedObjectsRemoved",
                    replacedObjects,
                    Schema.Boolean,
                  );
                  if (!removed)
                    return yield* Effect.fail(
                      failure("Replaced owners left saved rendering objects"),
                    );
                  replacement = { objects: replacedObjects, removed };
                }
                if (!phase.enabled) {
                  yield* call("alt", { player: a, value: true }, Schema.Int);
                  yield* call(
                    "select",
                    { player: a, position: [0, 7] },
                    Schema.Int,
                  );
                  yield* capture(a, "native-fluid-restored");
                  if (phase.name === "existing-factory") {
                    yield* call(
                      "select",
                      { player: a, position: [12, 8] },
                      Schema.Int,
                    );
                    yield* capture(
                      a,
                      "replacement-reference",
                      { x: 12, y: 8 },
                      3,
                    );
                    replacedObjects = yield* waitUntil(
                      () => call("replacedObjects", null, ReplacedObjects),
                      (value) =>
                        Object.values(value).every((ids) => ids.length > 0),
                      "both incumbent overlays",
                    );
                    replacement = { objects: replacedObjects, removed: false };
                  }
                  return;
                }
                const b = indices[1]!;
                yield* call("ownerProbeStart", a, Schema.Int);
                yield* waitUntil(
                  () => call("ownerProbeReady", null, Schema.Boolean),
                  (ready) => ready,
                  "owner-scoped native settings callback",
                );
                ownerPermission = yield* call(
                  "ownerProbeResult",
                  null,
                  OwnerPermission,
                );
                const observe = (
                  name: string,
                  accept: (value: typeof Observation.Type) => boolean,
                ) =>
                  Effect.gen(function* () {
                    const observed = yield* waitUntil(
                      () => call("observe", indices, Observation, true),
                      accept,
                      name,
                    );
                    if (
                      observed.audienceErrors !== 0 ||
                      observed.players.some(
                        (p) =>
                          p.radius !== p.nativeRadius ||
                          p.nearbyEnabled !== p.nativeNearby ||
                          p.focus !== p.nativeFocus ||
                          p.warningMode !== p.nativeWarningMode,
                      )
                    )
                      return yield* Effect.fail(
                        failure(
                          `Visibility or setting-cache mismatch in ${name}`,
                        ),
                      );
                    if (
                      observed.players.some(
                        (p) =>
                          p.recipe !== "" &&
                          p.recipeNames !==
                            (options.retained && !p.ghost ? 1 : 0),
                      )
                    )
                      return yield* Effect.fail(
                        failure(
                          `Recipe-name companion ownership changed in ${name}`,
                        ),
                      );
                    cases.push({ name, ...observed });
                    yield* fs.writeFileString(
                      join(host.directory, "native-cases.json"),
                      JSON.stringify(cases, null, 2),
                    );
                    return observed;
                  });
                const nativeReference = (
                  name: string,
                  position: { x: number; y: number },
                  zoom: number,
                  comparePipes = false,
                ) =>
                  Effect.gen(function* () {
                    yield* call("alt", { player: a, value: true }, Schema.Int);
                    yield* observe(
                      `${name}: native ALT reference`,
                      (v) =>
                        v.players[0]!.exact === 0 && v.players[0]!.nearby === 0,
                    );
                    if (comparePipes)
                      yield* call("pipeIcons", a, Schema.Int, true);
                    yield* capture(a, `${name}-native-alt`, position, zoom);
                    if (comparePipes) {
                      yield* call(
                        "setting",
                        { player: a, name: "fluid-context", value: false },
                        Schema.Int,
                      );
                      yield* observe(
                        `${name}: native pipe contents only`,
                        (v) => v.players[0]!.fluids === 0,
                      );
                      yield* capture(a, `${name}-native-pipes`, position, zoom);
                      yield* call(
                        "setting",
                        { player: a, name: "fluid-context", value: true },
                        Schema.Int,
                      );
                    }
                    yield* call("alt", { player: a, value: false }, Schema.Int);
                    yield* observe(
                      `${name}: custom presentation restored`,
                      (v) =>
                        v.players[0]!.exact > 0 || v.players[0]!.recipe !== "",
                    );
                    if (comparePipes)
                      yield* call("pipeIcons", a, Schema.Int, true);
                  });
                const previous = phases.at(-1);
                if (previous?.enabled) {
                  const expected = previous.cases.at(-1)!.players;
                  yield* observe("fresh-load preferences preserved", (v) =>
                    v.players.every((p) => {
                      const prior = expected.find(
                        (item) => item.index === p.index,
                      );
                      return (
                        prior !== undefined &&
                        p.nativeRadius === prior.nativeRadius &&
                        p.nativeNearby === prior.nativeNearby &&
                        p.nativeFocus === prior.nativeFocus
                      );
                    }),
                  );
                }
                // Reset only after proving saved preferences; the next cases intentionally
                // start from defaults rather than incorrectly expecting reload to erase them.
                yield* call("defaults", indices, Schema.Int, true);
                yield* call(
                  "select",
                  { player: a, position: [0, 0] },
                  Schema.Int,
                );
                yield* call(
                  "select",
                  { player: b, position: [0, 0] },
                  Schema.Int,
                );
                yield* observe("same target, separate audiences", (v) =>
                  v.players.every(
                    (p) => p.recipe === "iron-gear-wheel" && p.nearby > 0,
                  ),
                );
                yield* capture(a, "default-en");
                yield* capture(b, "default-de");
                yield* observe(
                  "bounded pointer targets for both real clients",
                  (v) =>
                    v.players.every(
                      (p) => p.pointerCells > 0 && p.pointerPending === 0,
                    ),
                );
                yield* call(
                  "pointerProbe",
                  indices,
                  Schema.Literal(true),
                  true,
                );
                yield* observe(
                  "empty-ground focus is independent with server-side selection cleared",
                  (v) =>
                    v.players.every(
                      (p) =>
                        p.selected === 0 &&
                        p.exact === 0 &&
                        p.nearby > 0 &&
                        p.pointerFocus !== undefined,
                    ),
                );
                yield* capture(a, "empty-ground-en");
                yield* capture(b, "empty-ground-de");
                yield* call(
                  "pointerZoom",
                  { player: b, zoom: 0.5 },
                  Schema.Int,
                );
                yield* observe(
                  "coarse second-viewer grid",
                  (v) =>
                    v.players[1]!.pointerPending === 0 &&
                    (v.players[1]!.pointerCellSize ?? 0) > 2,
                );
                yield* call(
                  "setting",
                  {
                    player: a,
                    name: "experiment-nearby-focus",
                    value: "retain",
                  },
                  Schema.Int,
                  true,
                );
                yield* observe(
                  "first viewer releases its grid",
                  (v) => v.players[0]!.pointerCells === 0,
                );
                yield* call(
                  "setting",
                  {
                    player: a,
                    name: "experiment-nearby-focus",
                    value: "pointer",
                  },
                  Schema.Int,
                  true,
                );
                yield* observe(
                  "fine grid added after overlapping coarse grid",
                  (v) =>
                    v.players[0]!.pointerCellSize === 2 &&
                    v.players[0]!.pointerCells > 0 &&
                    v.players[0]!.pointerPending === 0,
                );
                yield* call(
                  "pointerProbe",
                  indices,
                  Schema.Literal(true),
                  true,
                );
                yield* call(
                  "pointerZoom",
                  { player: b, zoom: 1.5 },
                  Schema.Int,
                );
                yield* observe("both viewer grids restored", (v) =>
                  v.players.every(
                    (p) => p.pointerCellSize === 2 && p.pointerPending === 0,
                  ),
                );
                for (const index of indices) {
                  yield* call(
                    "select",
                    { player: index, position: [0, 0] },
                    Schema.Int,
                  );
                }
                yield* call(
                  "select",
                  { player: a, position: [12, 8] },
                  Schema.Int,
                );
                yield* observe(
                  "compact inserter filter and configured capacity",
                  (v) =>
                    v.players[0]!.exact > 0 &&
                    v.players[0]!.recipe === "" &&
                    (v.players[0]!.capacity?.value ?? 0) > 0,
                );
                yield* capture(a, "inserter-filter", { x: 12, y: 8 }, 4);
                yield* call(
                  "setting",
                  { player: a, name: "warnings", value: "always" },
                  Schema.Int,
                );
                yield* observe(
                  "connection warnings have independent per-player visibility",
                  (v) =>
                    v.players[0]!.selectedWarnings === 2 &&
                    v.players[1]!.warnings === 0,
                );
                yield* capture(
                  a,
                  "inserter-capacity-and-warnings",
                  { x: 12, y: 8 },
                  3,
                );
                yield* call(
                  "setting",
                  { player: a, name: "warnings", value: "off" },
                  Schema.Int,
                );
                yield* observe(
                  "warning switch leaves capacity intact",
                  (v) =>
                    v.players[0]!.warnings === 0 &&
                    (v.players[0]!.capacity?.value ?? 0) > 0,
                );
                yield* call(
                  "setting",
                  { player: a, name: "warnings", value: "alt" },
                  Schema.Int,
                );
                yield* call(
                  "select",
                  { player: a, position: [16, 8] },
                  Schema.Int,
                );
                yield* observe(
                  "splitter filter on its chosen output",
                  (v) => v.players[0]!.exact > 0 && v.players[0]!.recipe === "",
                );
                yield* capture(a, "splitter-filter", { x: 16, y: 8 }, 4);
                yield* nativeReference("splitter-filter", { x: 16, y: 8 }, 4);
                yield* call(
                  "select",
                  { player: a, position: [10, 0] },
                  Schema.Int,
                );
                yield* observe(
                  "recipe ghost without duplicate tooltip",
                  (v) =>
                    v.players[0]!.ghost &&
                    v.players[0]!.recipe === "iron-gear-wheel" &&
                    v.players[0]!.recipeNames === 0 &&
                    v.players[1]!.recipe === "iron-gear-wheel",
                );
                yield* capture(a, "recipe-ghost");
                yield* call(
                  "select",
                  { player: a, position: [0, 0] },
                  Schema.Int,
                );
                yield* call("alt", { player: a, value: true }, Schema.Int);
                yield* observe(
                  "mixed native ALT",
                  (v) =>
                    v.players[0]!.exact === 0 &&
                    v.players[0]!.nearby === 0 &&
                    v.players[1]!.recipe === "iron-gear-wheel",
                );
                yield* capture(a, "native-alt");
                yield* call("alt", { player: a, value: false }, Schema.Int);
                yield* call(
                  "setting",
                  { player: a, name: "recipe-radius", value: 8 },
                  Schema.Int,
                );
                yield* call(
                  "setting",
                  { player: b, name: "nearby-recipes", value: false },
                  Schema.Int,
                );
                yield* call(
                  "select",
                  { player: b, position: [5, 0] },
                  Schema.Int,
                );
                yield* observe(
                  "different targets and settings",
                  (v) =>
                    v.players[0]!.recipe === "iron-gear-wheel" &&
                    v.players[0]!.radius === 8 &&
                    v.players[1]!.recipe === "copper-cable" &&
                    v.players[1]!.nearby === 0,
                );
                yield* call(
                  "select",
                  { player: a, position: [0, 7] },
                  Schema.Int,
                );
                yield* call("hold", { player: a, name: "pipe" }, Schema.Int);
                yield* observe("fluid construction", (v) =>
                  options.fluidPolicy === "declutter"
                    ? v.players[0]!.fluids > 0
                    : v.players[0]!.fluids === 0,
                );
                if (options.fluidPolicy === "declutter")
                  yield* call("pipeIcons", a, Schema.Int, true);
                yield* capture(a, "fluid-construction");
                yield* call("hold", { player: a }, Schema.Int);
                yield* call("select", { player: a }, Schema.Int);
                yield* observe(
                  "empty gap retains nearby recipes but clears exact and fluid details",
                  (v) =>
                    v.players[0]!.active &&
                    v.players[0]!.exact === 0 &&
                    v.players[0]!.recipe === "" &&
                    v.players[0]!.nearby > 0 &&
                    v.players[0]!.fluids === 0 &&
                    v.players[1]!.recipe === "copper-cable",
                );
                yield* call(
                  "select",
                  { player: a, position: [0, 0] },
                  Schema.Int,
                );
                yield* call("open", { player: a, value: true }, Schema.Int);
                yield* observe(
                  "panel obscures world",
                  (v) =>
                    v.players[0]!.exact === 0 &&
                    v.players[0]!.nearby === 0 &&
                    v.players[1]!.recipe === "copper-cable",
                );
                yield* call("open", { player: a, value: false }, Schema.Int);
                yield* call("remote", { player: a, enabled: true }, Schema.Int);
                yield* observe(
                  "remote surface separation",
                  (v) =>
                    v.players[0]!.surface === "no-alt-needed-remote" &&
                    v.players[0]!.exact === 0 &&
                    v.players[1]!.recipe === "copper-cable",
                );
                yield* call(
                  "remote",
                  { player: a, enabled: false },
                  Schema.Int,
                );
                if (
                  options.profile === "py-hardmode" &&
                  phase.name === sequence.find((item) => item.enabled)!.name
                ) {
                  const farms = yield* call("farms", null, Schema.Array(Farm));
                  for (const farm of farms) {
                    yield* evaluate(
                      session.client,
                      `local p=game.get_player(${a}); assert(p.teleport({${farm.position.x},${farm.position.y}},game.surfaces[${luaString("no-alt-needed-verification")}])); return game.tick`,
                      Schema.Int,
                    );
                    yield* waitUntil(
                      () => call("visible", farm.position, Schema.Boolean),
                      (value) => value,
                      "visible native farm",
                    );
                    yield* call(
                      "select",
                      { player: a, position: farm.position },
                      Schema.Int,
                    );
                    yield* observe(
                      `native pY ${farm.slots}-slot ${farm.name}`,
                      (v) =>
                        v.players[0]!.selected === farm.unit &&
                        v.players[0]!.recipe === farm.recipe &&
                        v.players[0]!.exact > 0,
                    );
                    yield* capture(a, `farm-${farm.slots}`, farm.position, 0.9);
                    yield* nativeReference(
                      `farm-${farm.slots}`,
                      farm.position,
                      0.9,
                    );
                    if (farm.slots === 40) {
                      for (const radius of [6, 10, 15]) {
                        yield* call(
                          "setting",
                          { player: a, name: "recipe-radius", value: radius },
                          Schema.Int,
                        );
                        yield* observe(
                          `dense native pY radius ${radius}`,
                          (v) =>
                            v.players[0]!.radius === radius &&
                            v.players[0]!.exact > 0,
                        );
                        yield* capture(
                          a,
                          `dense-py-radius-${radius}`,
                          farm.position,
                          0.9,
                        );
                      }
                      yield* call(
                        "setting",
                        { player: a, name: "recipe-radius", value: 8 },
                        Schema.Int,
                      );
                    }
                  }
                  for (const kind of [
                    "container",
                    "storage-tank",
                    "fluid-machine",
                  ]) {
                    const fixture = yield* call(
                      kind === "fluid-machine"
                        ? "fluidFixture"
                        : "storageFixture",
                      kind,
                      Schema.Struct({
                        name: Schema.String,
                        unit: Schema.Int,
                        position: Farm.fields.position,
                        recipe: Schema.String,
                      }),
                    );
                    yield* evaluate(
                      session.client,
                      `local p=game.get_player(${a}); assert(p.teleport({${fixture.position.x},${fixture.position.y}},game.surfaces["no-alt-needed-verification"])); return game.tick`,
                      Schema.Int,
                    );
                    yield* waitUntil(
                      () => call("visible", fixture.position, Schema.Boolean),
                      (value) => value,
                      "visible native pY fixture",
                    );
                    yield* call(
                      "select",
                      { player: a, position: fixture.position },
                      Schema.Int,
                    );
                    yield* observe(
                      `native pY ${fixture.name}`,
                      (v) =>
                        v.players[0]!.selected === fixture.unit &&
                        (kind === "fluid-machine"
                          ? v.players[0]!.recipe === fixture.recipe &&
                            v.players[0]!.fluids > 0
                          : v.players[0]!.exact > 0),
                    );
                    if (kind === "fluid-machine")
                      yield* call("pipeIcons", a, Schema.Int, true);
                    yield* capture(a, kind, fixture.position, 1.5);
                    yield* nativeReference(
                      kind,
                      fixture.position,
                      1.5,
                      kind === "fluid-machine",
                    );
                  }
                  // Adding these deliberate fixture entities changes the owned factory baseline.
                  factory = yield* call("factory", null, Schema.String);
                }
                if (
                  options.interactive &&
                  phase.name === sequence.find((item) => item.enabled)!.name
                ) {
                  yield* call(
                    "remote",
                    { player: a, enabled: false },
                    Schema.Int,
                  );
                  yield* call("physical", { player: a }, Schema.Int);
                  yield* Console.log(
                    JSON.stringify({
                      event: "NO_ALT_NATIVE_INPUT_READY",
                      host: host.run.runId,
                      clients: connected.map((client) => client.evidence),
                      instruction:
                        "Use the owned native window; press Enter here after collecting physical-input evidence.",
                    }),
                  );
                  yield* waitForInput();
                  cases.push({
                    name: "state after external input, not an input-proof claim",
                    ...(yield* call("observe", indices, Observation, true)),
                  });
                }
                for (const index of indices) {
                  yield* call(
                    "setting",
                    { player: index, name: "warnings", value: "off" },
                    Schema.Int,
                  );
                  yield* call(
                    "setting",
                    {
                      player: index,
                      name: "experiment-nearby-focus",
                      value: "selection",
                    },
                    Schema.Int,
                  );
                  yield* call("select", { player: index }, Schema.Int);
                  yield* call("hold", { player: index }, Schema.Int);
                }
                yield* observe(
                  "all viewers idle, no retained renderings",
                  (v) =>
                    v.renderCount === 0 && v.players.every((p) => !p.active),
                );
                // Serialize live helper entities and references, not merely an idle
                // product. The next fresh process must resume without orphans.
                yield* call(
                  "setting",
                  {
                    player: a,
                    name: "experiment-nearby-focus",
                    value: "pointer",
                  },
                  Schema.Int,
                );
                yield* observe(
                  "live pointer population prepared for fresh-process reload",
                  (v) =>
                    v.players[0]!.pointerCells > 0 &&
                    v.players[0]!.pointerPending === 0,
                );
              });
            const checkpoint = yield* withNativeClient(
              first,
              session,
              { evidence: "session", deadlineMs: 1140000 },
              (a) =>
                Effect.gen(function* () {
                  clients.push(a.evidence);
                  if (second) {
                    yield* withNativeClient(
                      second,
                      session,
                      { evidence: "session", deadlineMs: 900000 },
                      (b) =>
                        Effect.gen(function* () {
                          clients.push(b.evidence);
                          yield* exercise(
                            [a.evidence.player.index, b.evidence.player.index],
                            [a, b],
                          );
                        }),
                    );
                    const disconnected = yield* call(
                      "observe",
                      [a.evidence.player.index, clients[1]!.player.index],
                      Observation,
                      true,
                    );
                    if (
                      disconnected.players[1]!.connected ||
                      disconnected.players[1]!.active
                    )
                      return yield* Effect.fail(
                        failure("Departed client retains active work"),
                      );
                    cases.push({
                      name: "real client disconnect",
                      ...disconnected,
                    });
                  } else yield* exercise([a.evidence.player.index], [a]);
                  const unchanged = yield* call("factory", null, Schema.String);
                  if (unchanged !== factory)
                    return yield* Effect.fail(
                      failure("Presentation changed factory state"),
                    );
                  return yield* saveEngineSession(
                    session,
                    "native-verification",
                  );
                }),
            );
            yield* session.process.stop;
            return { checkpoint, nativeFluids };
          }),
      );
      yield* verifyEngineDiagnostics(
        yield* fs.readFileString(join(host.directory, "factorio-current.log")),
        "clean",
        project.info,
      );
      for (const capture of captures) {
        const image = yield* verifyPNG(
          capture.path,
          capture.width,
          capture.height,
        );
        if (image.sha256 !== capture.sha256)
          return yield* Effect.fail(
            failure("Capture changed after observation"),
          );
      }
      saved = outcome.checkpoint;
      const evidence = yield* decode(
        Phase,
        {
          name: phase.name,
          run: host.run.runId,
          enabled: phase.enabled,
          mods: host.expectedMods,
          save: saved,
          clients,
          cases,
          captures,
          factory,
          nativeFluids: outcome.nativeFluids,
          ownerPermission,
          replacement,
        },
        "native phase evidence",
      );
      phases.push(evidence);
      yield* fs.writeFileString(
        join(host.directory, "native-phase.json"),
        JSON.stringify(evidence, null, 2),
      );
    }
    yield* verifySourceSeal(source, yield* sourceSeal(selected));
    const report = yield* decode(
      NativeVerification,
      {
        schema: 1,
        source,
        artifact,
        engine,
        profile: options.profile,
        retained: options.retained,
        layout: options.layout,
        lifecycle: options.lifecycle,
        physicalInput: "not-exercised-by-scripted-scenarios",
        phases,
        fluidPolicy: options.fluidPolicy,
      },
      "native verification report",
    );
    const output = join(
      project.outputRoot,
      "runs",
      phases.at(-1)!.run,
      "native-verification.json",
    );
    yield* fs.writeFileString(output, JSON.stringify(report, null, 2));
    yield* Console.log(
      JSON.stringify(
        {
          status: "passed",
          output,
          artifact: artifact.sha256,
          phases: phases.map((p) => ({
            name: p.name,
            run: p.run,
            cases: p.cases.length,
          })),
        },
        null,
        2,
      ),
    );
  });
}

function waitUntil<A, E, R>(
  read: () => Effect.Effect<A, E, R>,
  accept: (value: A) => boolean,
  name: string,
) {
  return Effect.gen(function* () {
    const deadline = performance.now() + 15000;
    let value: A;
    do {
      value = yield* read();
      if (accept(value)) return value;
      yield* Effect.sleep(50);
    } while (performance.now() < deadline);
    return yield* Effect.fail(failure(`${name}: ${JSON.stringify(value)}`));
  });
}
function waitForInput() {
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          process.stdin.off("data", finish);
          process.stdin.pause();
          signal.removeEventListener("abort", abort);
        };
        const finish = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        process.stdin.once("data", finish);
        signal.addEventListener("abort", abort, { once: true });
        process.stdin.resume();
      }),
    catch: (error) => failure(String(error)),
  });
}
