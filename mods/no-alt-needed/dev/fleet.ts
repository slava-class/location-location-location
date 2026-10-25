import { Console, Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { Engine, resolveEngine } from "../../../tools/engine.ts";
import {
  evaluate,
  SavedGame,
  saveEngineSession,
  withEngineSession,
} from "../../../tools/engine-session.ts";
import { hashFile } from "../../../tools/files.ts";
import {
  NativeClientEvidence,
  prepareNativeClient,
  withNativeClient,
} from "../../../tools/native-client.ts";
import { packageProject } from "../../../tools/packaging.ts";
import {
  BenchmarkProof,
  PerformanceConfiguration,
  PerformanceResult,
} from "../../../tools/performance-contracts.ts";
import { prepareProfile } from "../../../tools/profiles.ts";
import {
  BoundaryError,
  decode,
  readJSON,
  resolveProject,
} from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import {
  SourceSeal,
  sourceSeal,
  verifySourceSeal,
} from "../../../tools/source.ts";
import { verifyEngineDiagnostics } from "../../../tools/engine-diagnostics.ts";
import { PackageResult } from "../../../tools/contracts.ts";
import { RunId } from "../../../tools/logs.ts";
import { isDeepStrictEqual } from "node:util";
import { luaString } from "../../../tools/lua-string.ts";

const fail = (message: string) =>
  Effect.fail(new BoundaryError({ boundary: "fleet verification", message }));

// A named scenario composition, not a second product registry. Identity and
// dependencies are always resolved from the participating products' info.json.
const companions = [
  "location-location-location",
  "recipe-name-tooltip",
  "reversed-underground-belt-detector",
];
const directory = "dev/performance";
const workload = {
  connected_players: 1,
  machines: 121,
  copper_recipes: 0,
  modules: 484,
  pumps: 121,
  mouths: 0,
  surface_belts: 0,
  recipe_errors: 0,
  tooltip_errors: 0,
  warning_errors: 0,
  planner_errors: 0,
  helper_bound_errors: 0,
  foreign_fields: 1,
  foreign_renders: 1,
  foreign_tags: 1,
};
const Preparation = Schema.Struct({
  player: Schema.Int,
  connected: Schema.Literal(1),
  machines: Schema.Literal(121),
  pumps: Schema.Literal(121),
  modules: Schema.Literal(484),
  tick: Schema.Int,
});
const Plan = Schema.Struct({
  plan: Schema.Int,
  tag: Schema.Int,
  text: Schema.String,
});
const Workload = PerformanceResult.fields.scenario.fields.expected;
const FleetFixture = Schema.Struct({
  schema: Schema.Literal(1),
  sourceBeforePreparation: SourceSeal,
  source: SourceSeal,
  engine: Engine,
  expectedMods: BenchmarkProof.fields.expectedMods,
  artifact: PackageResult,
  companions: Schema.Array(PackageResult),
  prepared: Preparation,
  plan: Plan,
  observed: Workload,
  warmupTicks: Schema.Int,
  save: SavedGame,
  native: NativeClientEvidence,
  serverRun: RunId,
  fixture: PerformanceResult.fields.scenario.fields.fixture,
});

function settle(client: Parameters<typeof evaluate>[0], ticks = 120) {
  return Effect.gen(function* () {
    const start = yield* evaluate(client, "return game.tick", Schema.Int);
    const deadline = performance.now() + 15000;
    let observed = start;
    while (observed < start + ticks && performance.now() < deadline) {
      yield* Effect.sleep(50);
      observed = yield* evaluate(client, "return game.tick", Schema.Int);
    }
    if (observed < start + ticks)
      return yield* fail("Native workload did not settle within its deadline");
    return observed - start;
  });
}

function observeFleet(
  client: Parameters<typeof evaluate>[0],
  observer: string,
  expected: typeof Workload.Type,
) {
  return Effect.gen(function* () {
    const observed = yield* evaluate(
      client,
      `local observe=(function() ${observer}\nend)(); return observe()`,
      Workload,
    );
    if (!isDeepStrictEqual(observed, expected))
      return yield* fail(
        `Workload differs: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
      );
    return observed;
  });
}

/** Rebuild the explicit connected-viewer fixture; never touches normal profiles. */
export function prepareFleet(project: ResolvedProject, executable: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const selected = yield* resolveProject(
      project.repoRoot,
      project.info.name,
      project.repoRoot,
      { companions },
    );
    const source = yield* sourceSeal(selected);
    const engine = yield* resolveEngine(project, "native", executable);
    const artifact = yield* packageProject(project);
    const packaged = yield* Effect.forEach(companions, (name) =>
      Effect.gen(function* () {
        const companion = yield* resolveProject(
          project.repoRoot,
          name,
          project.repoRoot,
        );
        return {
          project: companion,
          artifact: yield* packageProject(companion),
        };
      }),
    );
    const host = yield* prepareProfile(
      selected,
      engine,
      "base",
      "en",
      artifact,
      packaged,
      "session",
    );
    const client = yield* prepareNativeClient(selected, host, {
      profile: "fleet-fixture-client",
      playerName: "FleetVerifier",
      viewport: { width: 1600, height: 1000, scale: 0.75, locale: "en" },
      graphics: "low",
    });
    const setup = yield* fs.readFileString(
      join(project.modRoot, directory, "fleet-prepare.lua"),
    );
    const planner = yield* fs.readFileString(
      join(project.modRoot, directory, "fleet-planner.lua"),
    );
    const observer = yield* fs.readFileString(
      join(project.modRoot, directory, "fleet-observe.lua"),
    );
    const execution = yield* withEngineSession(
      host,
      engine,
      {
        purpose: "fleet-fixture",
        evidence: "session",
        expectedMods: host.expectedMods,
        deadlineMs: 180000,
      },
      (session) =>
        Effect.gen(function* () {
          const result = yield* withNativeClient(
            client,
            session,
            { evidence: "session", deadlineMs: 120000 },
            (native) =>
              Effect.gen(function* () {
                const prepared = yield* evaluate(
                  session.client,
                  setup,
                  Preparation,
                );
                const plan = yield* evaluate(
                  session.client,
                  planner,
                  Plan,
                  "location-location-location",
                );
                const warmupTicks = yield* settle(session.client);
                const observed = yield* observeFleet(
                  session.client,
                  observer,
                  workload,
                );
                const save = yield* saveEngineSession(
                  session,
                  "workshop-fleet",
                );
                return {
                  prepared,
                  plan,
                  observed,
                  warmupTicks,
                  save,
                  native: native.evidence,
                };
              }),
          );
          yield* session.process.stop;
          return result;
        }),
    );
    yield* verifyEngineDiagnostics(
      yield* fs.readFileString(join(host.directory, "factorio-current.log")),
      "clean",
      project.info,
    );
    yield* verifySourceSeal(source, yield* sourceSeal(selected));
    const result = execution;
    const configFile = project.development.performance;
    if (configFile === undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "The fleet fixture requires a declared performance configuration",
        }),
      );
    const config = yield* readJSON(
      PerformanceConfiguration,
      join(project.modRoot, configFile),
    );
    const fixture = {
      file: `${directory}/fixtures/workshop-fleet.zip`,
      sha256: result.save.sha256,
    };
    const activity = {
      file: `${directory}/fleet-activity.lua`,
      sha256: yield* hashFile(
        join(project.modRoot, directory, "fleet-activity.lua"),
      ),
      checkpoints: [0, 1800].flatMap((offset) => [
        { update: offset + 119, workload },
        {
          update: offset + 240,
          workload: { ...workload, mouths: 2000, surface_belts: 2000 },
        },
        {
          update: offset + 1319,
          workload: { ...workload, mouths: 2000, surface_belts: 2000 },
        },
        {
          update: offset + 1380,
          workload: {
            ...workload,
            mouths: 2000,
            surface_belts: 2000,
            copper_recipes: 121,
          },
        },
        {
          update: offset + 1470,
          workload: {
            ...workload,
            mouths: 2000,
            surface_belts: 2000,
            copper_recipes: 121,
          },
        },
        {
          update: offset + 1530,
          workload: { ...workload, machines: 0, modules: 0 },
        },
        { update: offset + 1600, workload },
      ]),
    };
    const scenarios = [true, false].map((productEnabled) => ({
      name: productEnabled ? "fleet-active" : "fleet-control",
      description:
        "Fixed connected-viewer fleet workload: idle, 1000-pair construction, dense recipe changes, GUI cleanup, repeated destruction/rebuild and overlapping pulse/alert periods across two 1800-update cycles. Select companions explicitly.",
      profile: "base" as const,
      language: "en" as const,
      productEnabled,
      fixture,
      correctness: `${directory}/fleet-observe.lua`,
      activity,
      expected: workload,
      preparedWarmupTicks: result.warmupTicks,
      ticks: 3600,
      processes: 3,
      budget: null,
    }));
    const updated = yield* decode(
      PerformanceConfiguration,
      {
        schema: config.schema,
        scenarios: [
          ...config.scenarios.filter(
            (scenario) =>
              !scenarios.some((value) => value.name === scenario.name),
          ),
          ...scenarios,
        ],
      },
      "prepared fleet scenarios",
    );
    yield* fs.makeDirectory(join(project.modRoot, directory, "fixtures"), {
      recursive: true,
    });
    yield* fs.copyFile(
      result.save.archive,
      join(project.modRoot, fixture.file),
    );
    if (
      (yield* hashFile(join(project.modRoot, fixture.file))) !== fixture.sha256
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: fixture.file,
          message:
            "Copied fleet fixture differs; scenario pins were not updated",
        }),
      );
    yield* fs.writeFileString(
      join(project.modRoot, configFile),
      JSON.stringify(updated, null, 2) + "\n",
    );
    const evidence = yield* decode(
      FleetFixture,
      {
        schema: 1,
        sourceBeforePreparation: source,
        source: yield* sourceSeal(selected),
        engine,
        expectedMods: host.expectedMods,
        artifact,
        companions: packaged.map((value) => value.artifact),
        ...result,
        serverRun: host.run.runId,
        fixture,
      },
      "native fleet fixture evidence",
    );
    yield* fs.writeFileString(
      join(host.directory, "fleet-fixture.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    yield* Console.log(
      JSON.stringify(
        {
          schema: 1,
          runId: host.run.runId,
          fixture,
          evidence: join(host.directory, "fleet-fixture.json"),
          verifyCommand: [
            "mise",
            "run",
            "project",
            "--",
            project.info.name,
            "--",
            "verify-fleet",
            "--engine",
            engine.executable,
            "--preparation",
            host.run.runId,
          ],
        },
        null,
        2,
      ),
    );
    return evidence;
  });
}

const LifecyclePhase = Schema.Struct({
  name: Schema.NonEmptyString,
  runId: RunId,
  mods: BenchmarkProof.fields.expectedMods,
  input: SavedGame,
  save: SavedGame,
  native: NativeClientEvidence,
  active: Workload,
  cleared: Workload,
  plannerRecreated: Schema.Boolean,
});
const FleetLifecycle = Schema.Struct({
  schema: Schema.Literal(1),
  source: SourceSeal,
  preparation: RunId,
  engine: Engine,
  phases: Schema.Array(LifecyclePhase),
  physicalInput: Schema.Literal("not-exercised"),
});

/** Fresh disk processes, then each product removed/saved/re-added independently. */
export function verifyFleet(
  project: ResolvedProject,
  executable: string,
  preparation: typeof RunId.Type,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const id = yield* decode(RunId, preparation, "fleet preparation run");
    const prepared = yield* readJSON(
      FleetFixture,
      join(project.outputRoot, "runs", id, "fleet-fixture.json"),
    );
    const selected = yield* resolveProject(
      project.repoRoot,
      project.info.name,
      project.repoRoot,
      { companions },
    );
    const source = yield* sourceSeal(selected);
    yield* verifySourceSeal(prepared.source, source);
    if (prepared.serverRun !== id)
      return yield* fail("Preparation receipt belongs to another run");
    const engine = yield* resolveEngine(project, "native", executable);
    if (engine.sha256 !== prepared.engine.sha256)
      return yield* fail("Lifecycle engine differs from fixture preparation");
    const projects = yield* Effect.forEach(
      [project.info.name, ...companions],
      (name) => resolveProject(project.repoRoot, name, project.repoRoot),
    );
    const artifacts = new Map(
      [prepared.artifact, ...prepared.companions].map((artifact) => [
        artifact.mod.name,
        artifact,
      ]),
    );
    const observer = yield* fs.readFileString(
      join(project.modRoot, directory, "fleet-observe.lua"),
    );
    const activity = yield* fs.readFileString(
      join(project.modRoot, directory, "fleet-activity.lua"),
    );
    const planner = yield* fs.readFileString(
      join(project.modRoot, directory, "fleet-planner.lua"),
    );
    const phases: (typeof LifecyclePhase.Type)[] = [];
    const active = { ...workload, mouths: 2000, surface_belts: 2000 };
    const phase = (
      name: string,
      input: typeof SavedGame.Type,
      disabled: string | null,
      first: boolean,
      recreatePlanner: boolean,
    ) =>
      Effect.gen(function* () {
        const owner = projects.find(
          (value) => value.info.name === (disabled ?? project.info.name),
        )!;
        const artifact = artifacts.get(owner.info.name);
        if (artifact === undefined)
          return yield* fail("Prepared package is missing");
        const rest = projects
          .filter((value) => value.info.name !== owner.info.name)
          .map((value) => ({
            project: value,
            artifact: artifacts.get(value.info.name)!,
          }));
        const host = yield* prepareProfile(
          owner,
          engine,
          "base",
          "en",
          artifact,
          rest,
          "session",
          { productEnabled: disabled === null },
        );
        if ((yield* hashFile(input.archive)) !== input.sha256)
          return yield* fail("Lifecycle input save changed");
        yield* fs.copyFile(input.archive, join(host.directory, "input.zip"));
        if (
          (yield* hashFile(join(host.directory, "input.zip"))) !== input.sha256
        )
          return yield* fail("Copied lifecycle input differs");
        const client = yield* prepareNativeClient(owner, host, {
          profile: `fleet-${name}-client`,
          playerName: "FleetVerifier",
          viewport: prepared.native.requested,
          graphics: "low",
        });
        const result = yield* withEngineSession(
          host,
          engine,
          {
            purpose: `fleet-${name}`,
            evidence: "session",
            expectedMods: host.expectedMods,
            deadlineMs: 180000,
          },
          (session) =>
            Effect.gen(function* () {
              const values = yield* withNativeClient(
                client,
                session,
                { evidence: "session", deadlineMs: 120000 },
                (native) =>
                  Effect.gen(function* () {
                    if (recreatePlanner) {
                      // Saving with a mod disabled removes its private storage. Re-addition
                      // proves a new plan works; it does not pretend the old plan survived.
                      yield* evaluate(
                        session.client,
                        `local expected=helpers.json_to_table(${luaString(JSON.stringify(prepared.plan))}); local p=game.get_player("FleetVerifier"); for _,tag in pairs(p.force.find_chart_tags(p.surface)) do if tag.tag_number==expected.tag then assert(tag.text==expected.text); tag.destroy() end end; return true`,
                        Schema.Literal(true),
                      );
                      yield* evaluate(
                        session.client,
                        planner,
                        Plan,
                        "location-location-location",
                      );
                    }
                    // A slow client startup can outlast the save's transient chart visibility.
                    // Chart once, allow native updates, then require visibility before selection.
                    yield* evaluate(
                      session.client,
                      'local p=game.get_player("FleetVerifier"); local s=game.surfaces["workshop-fleet-machines"]; p.opened=nil; assert(p.teleport({0,0},s)); p.force.chart(s,{{-32,-32},{32,32}}); return true',
                      Schema.Literal(true),
                    );
                    yield* settle(session.client, 30);
                    yield* evaluate(
                      session.client,
                      'local p=game.get_player("FleetVerifier"); return p.force.is_chunk_visible(p.surface,{0,0})',
                      Schema.Literal(true),
                    );
                    if (first) {
                      yield* evaluate(
                        session.client,
                        `local act=(function() ${activity}\nend)(); act(1); act(120); return true`,
                        Schema.Literal(true),
                      );
                    } else {
                      yield* evaluate(
                        session.client,
                        'local p=game.get_player("FleetVerifier"); local machines=p.surface.find_entities_filtered{name="assembling-machine-3",position={0,0},radius=1}; assert(#machines==1); p.selected=machines[1]; return true',
                        Schema.Literal(true),
                      );
                    }
                    yield* settle(session.client);
                    const observed = yield* observeFleet(
                      session.client,
                      observer,
                      active,
                    );
                    // Native recipe fields can outlive removal. Exercise the documented
                    // clear-selection precondition, without deleting any foreign fields.
                    yield* evaluate(
                      session.client,
                      'local p=game.get_player("FleetVerifier"); p.selected=nil; p.opened=defines.gui_type.controller; assert(p.opened_self and p.opened_gui_type==defines.gui_type.controller); return true',
                      Schema.Literal(true),
                    );
                    yield* settle(session.client, 30);
                    const cleared = yield* observeFleet(
                      session.client,
                      observer,
                      active,
                    );
                    const save = yield* saveEngineSession(
                      session,
                      "fleet-lifecycle",
                    );
                    return {
                      active: observed,
                      cleared,
                      save,
                      native: native.evidence,
                    };
                  }),
              );
              yield* session.process.stop;
              return values;
            }),
        );
        yield* verifyEngineDiagnostics(
          yield* fs.readFileString(
            join(host.directory, "factorio-current.log"),
          ),
          "clean",
          owner.info,
        );
        const evidence = yield* decode(
          LifecyclePhase,
          {
            name,
            runId: host.run.runId,
            mods: host.expectedMods,
            input,
            ...result,
            plannerRecreated: recreatePlanner,
          },
          "native fleet lifecycle phase",
        );
        phases.push(evidence);
        yield* fs.writeFileString(
          join(host.directory, "fleet-phase.json"),
          JSON.stringify(evidence, null, 2) + "\n",
        );
        return result.save;
      });
    const baseline = yield* phase(
      "fresh-reload",
      prepared.save,
      null,
      true,
      false,
    );
    for (const target of projects) {
      const name = target.info.name;
      const removed = yield* phase(
        `remove-${name}`,
        baseline,
        name,
        false,
        false,
      );
      yield* phase(
        `readd-${name}`,
        removed,
        null,
        false,
        name === "location-location-location",
      );
    }
    yield* verifySourceSeal(source, yield* sourceSeal(selected));
    const result = yield* decode(
      FleetLifecycle,
      {
        schema: 1,
        source,
        preparation: id,
        engine,
        phases,
        physicalInput: "not-exercised",
      },
      "native fleet lifecycle",
    );
    const output = join(
      project.outputRoot,
      "runs",
      phases.at(-1)!.runId,
      "fleet-lifecycle.json",
    );
    yield* fs.writeFileString(output, JSON.stringify(result, null, 2) + "\n");
    yield* Console.log(
      JSON.stringify(
        {
          status: "passed",
          output,
          phases: phases.map((value) => ({
            name: value.name,
            runId: value.runId,
          })),
        },
        null,
        2,
      ),
    );
    return result;
  });
}
