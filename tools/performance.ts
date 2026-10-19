import { Cause, Effect, Exit, FileSystem } from "effect";
import { cpus, loadavg, release, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { BenchmarkWindow, parseBenchmark } from "./benchmark.ts";
import { Backend } from "./backend.ts";
import { readCommandOutput } from "./commands.ts";
import { ContainerReceipt, verifyContainerExit } from "./container.ts";
import { resolveEngine } from "./engine.ts";
import { verifyEngineDiagnostics } from "./engine-diagnostics.ts";
import { hashFile } from "./files.ts";
import { createLog, readLogState, RunId } from "./logs.ts";
import { packageProject } from "./packaging.ts";
import { comparePerformance, distribution } from "./performance-analysis.ts";
import {
  BenchmarkObservation,
  BenchmarkProof,
  BenchmarkRequest,
  BenchmarkState,
  PerformanceBudget,
  PerformanceConfiguration,
  PerformanceEnvironment,
  PerformanceResult,
  PerformanceState,
} from "./performance-contracts.ts";
import { ProcessReceipt, withProcess } from "./process.ts";
import { prepareProfile } from "./profiles.ts";
import type { Companion } from "./profiles.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  readJSON,
  resolveProject,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { announceRun, newRun, ParentRun, RunRecord } from "./runs.ts";
import { sourceSeal, verifySourceSeal } from "./source.ts";

const failure = (boundary: string, message: string) =>
  Effect.fail(new BoundaryError({ boundary, message }));
function persist(path: string, value: unknown) {
  return Effect.gen(function* () {
    yield* assertCanonicalPath(path);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(
      path + ".part",
      JSON.stringify(value, null, 2) + "\n",
    );
    yield* fs.rename(path + ".part", path);
  });
}

export function qualifyBenchmark(
  request: typeof BenchmarkRequest.Type,
  proof: typeof BenchmarkProof.Type,
) {
  return Effect.gen(function* () {
    const {
      status: _status,
      result,
      observation,
      processWallMs,
      ...identity
    } = proof;
    if (
      !isDeepStrictEqual({ ...request, elapsedMs: proof.elapsedMs }, identity)
    )
      return yield* failure(
        request.runId,
        "Benchmark proof disagrees with its exact request",
      );
    const fs = yield* FileSystem.FileSystem;
    const needsHarness =
      request.mode === "correctness" || request.scenario.activity !== null;
    if (needsHarness !== (request.harness !== null))
      return yield* failure(
        request.runId,
        "Benchmark harness presence disagrees with its workload and mode",
      );
    if (request.harness !== null) {
      const expectedFiles = [
        "control.lua",
        "info.json",
        "request.lua",
        "window.lua",
        ...(request.mode === "correctness" ? ["case.lua"] : []),
        ...(request.scenario.activity !== null ? ["activity.lua"] : []),
      ].sort();
      const actualFiles = (yield* fs.readDirectory(
        join(request.directory, request.harness.directory),
      )).sort();
      if (
        !isDeepStrictEqual(
          Object.keys(request.harness.files).sort(),
          expectedFiles,
        ) ||
        !isDeepStrictEqual(actualFiles, expectedFiles) ||
        request.harness.files["control.lua"] !==
          request.source.files["tools/fixtures/benchmark/control.lua"] ||
        (request.mode === "correctness" &&
          request.harness.files["case.lua"] !== request.correctnessSha256) ||
        (request.scenario.activity !== null &&
          request.harness.files["activity.lua"] !==
            request.scenario.activity.sha256)
      )
        return yield* failure(
          request.runId,
          "Benchmark harness inventory or sealed source differs",
        );
    }
    const pinned = [
      {
        path: join(request.directory, "input.zip"),
        sha256: request.scenario.fixture.sha256,
      },
      ...Object.entries(request.archives).map(([name, input]) => ({
        path: join(request.directory, "mods", `${name}_${input.version}.zip`),
        sha256: input.sha256,
      })),
      ...Object.entries(request.harness?.files ?? {}).map(([name, sha256]) => ({
        path: join(request.directory, request.harness!.directory, name),
        sha256,
      })),
    ];
    for (const input of pinned) {
      yield* assertCanonicalPath(input.path);
      if ((yield* hashFile(input.path)) !== input.sha256)
        return yield* failure(
          request.runId,
          "Retained benchmark input differs from its checksum",
        );
    }
    const actualArchives = (yield* fs.readDirectory(
      join(request.directory, "mods"),
    ))
      .filter((name) => name.endsWith(".zip"))
      .sort();
    const expectedArchives = Object.entries(request.archives)
      .map(([name, input]) => `${name}_${input.version}.zip`)
      .sort();
    if (!isDeepStrictEqual(actualArchives, expectedArchives))
      return yield* failure(
        request.runId,
        "Retained benchmark archive inventory differs",
      );
    for (const [name, input] of Object.entries(request.archives))
      if (request.expectedMods[name] !== input.version)
        return yield* failure(
          request.runId,
          "Archive version differs from the loaded closure",
        );
    const packaged = [request.artifact, ...request.companions];
    for (const artifact of packaged)
      if (
        !isDeepStrictEqual(request.archives[artifact.mod.name], {
          version: artifact.mod.version,
          sha256: artifact.sha256,
        })
      )
        return yield* failure(
          request.runId,
          "Packaged artifact differs from the staged closure",
        );
    if (
      request.fixtureSha256 !== request.scenario.fixture.sha256 ||
      request.source.files[
        `mods/${request.mod.name}/${request.scenario.correctness}`
      ] !== request.correctnessSha256 ||
      request.source.files[
        `mods/${request.mod.name}/${request.scenario.fixture.file}`
      ] !== request.fixtureSha256 ||
      (request.scenario.activity !== null &&
        request.source.files[
          `mods/${request.mod.name}/${request.scenario.activity.file}`
        ] !== request.scenario.activity.sha256)
    )
      return yield* failure(
        request.runId,
        "Benchmark fixture or observer differs from its sealed source",
      );
    const processPath = join(request.directory, "process.json");
    yield* assertCanonicalPath(processPath);
    const processResult = yield* readJSON(ProcessReceipt, processPath);
    if (
      processResult.runId !== request.runId ||
      processResult.modId !== request.mod.name ||
      processResult.status !== "passed" ||
      processResult.exit?.code !== 0 ||
      processResult.exit.signal !== null ||
      processResult.termination !== "natural" ||
      processResult.deadline !== null ||
      processResult.interrupted ||
      processResult.finalizationErrors.length !== 0 ||
      processResult.elapsedMs !== processWallMs
    )
      return yield* failure(
        request.runId,
        "Benchmark process did not finish cleanly or its measured duration differs",
      );
    if (request.engine.docker !== undefined) {
      const path = join(request.directory, "container.json");
      yield* assertCanonicalPath(path);
      const container = yield* readJSON(ContainerReceipt, path);
      if (
        container.runId !== request.runId ||
        container.modId !== request.mod.name ||
        container.repository !== processResult.repository ||
        container.directory !== request.directory ||
        container.name !== "modkit-" + request.runId ||
        !isDeepStrictEqual(container.runtime, request.engine.docker)
      )
        return yield* failure(
          request.runId,
          "Benchmark container belongs to another run or backend",
        );
      yield* verifyContainerExit(processResult, container);
    }
    const output = yield* readCommandOutput(
      request.directory,
      request.runId,
      16 * 1024 * 1024,
    );
    const parsed = yield* parseBenchmark(output.stdout, request.window);
    if (!isDeepStrictEqual(parsed, result))
      return yield* failure(
        request.runId,
        "Benchmark samples differ from sealed native output",
      );
    yield* verifyEngineDiagnostics(
      output.stdout + "\n" + output.stderr,
      "clean",
      { ...request.mod, title: request.mod.name },
    );
    const loaded = new Set(
      [
        ...output.stdout.matchAll(
          /^\s*[0-9]+\.[0-9]+ Checksum (?:of ([A-Za-z0-9_-]+)|for (core)): [0-9]+\r?$/gm,
        ),
      ].map((match) => match[1] ?? match[2]!),
    );
    loaded.delete("core");
    if (
      !isDeepStrictEqual(
        [...loaded].sort((a, b) => a.localeCompare(b)),
        Object.keys(request.expectedMods).sort((a, b) => a.localeCompare(b)),
      )
    )
      return yield* failure(
        request.runId,
        "Loaded engine checksum names disagree with the staged exact mod closure",
      );
    if (request.mode === "correctness") {
      if (
        observation === null ||
        observation.runId !== request.runId ||
        observation.updates !== request.window.ticks ||
        !isDeepStrictEqual(observation.activeMods, request.expectedMods) ||
        !isDeepStrictEqual(observation.before, request.scenario.expected) ||
        !isDeepStrictEqual(observation.after, request.scenario.expected) ||
        !isDeepStrictEqual(
          observation.checkpoints,
          request.scenario.activity?.checkpoints,
        )
      )
        return yield* failure(
          request.runId,
          "Workload checkpoint, before/after state, dependency or correctness observation differs",
        );
      const path = join(
        request.directory,
        "script-output",
        "benchmark-observation.json",
      );
      yield* assertCanonicalPath(path);
      if (
        !isDeepStrictEqual(
          observation,
          yield* readJSON(BenchmarkObservation, path),
        )
      )
        return yield* failure(
          request.runId,
          "Stored correctness observation differs from the engine output",
        );
    } else if (observation !== null)
      return yield* failure(
        request.runId,
        "Primary timings must not claim an in-process correctness observer",
      );
  });
}

function runBenchmark(
  project: ResolvedProject,
  parent: typeof PerformanceState.Type,
  artifact: typeof BenchmarkProof.Type.artifact,
  companions: readonly Companion[],
  mode: "primary" | "correctness",
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { scenario, engine, source } = parent;
    const context = yield* prepareProfile(
      project,
      engine,
      scenario.profile,
      scenario.language,
      artifact,
      companions,
      mode === "correctness"
        ? "benchmark-proof"
        : scenario.activity === null
          ? "benchmark"
          : "benchmark-activity",
    );
    const { run, directory } = context;
    const save = join(directory, "input.zip");
    const original = join(project.modRoot, scenario.fixture.file);
    yield* assertCanonicalPath(original);
    if ((yield* hashFile(original)) !== scenario.fixture.sha256)
      return yield* failure(
        scenario.name,
        "Performance fixture checksum differs",
      );
    yield* fs.copyFile(original, save);
    if ((yield* hashFile(save)) !== scenario.fixture.sha256)
      return yield* failure(
        scenario.name,
        "Staged performance fixture checksum differs",
      );
    const correctnessPath = join(project.modRoot, scenario.correctness);
    yield* assertCanonicalPath(correctnessPath);
    const correctnessSha256 = yield* hashFile(correctnessPath);
    if (mode === "correctness") {
      yield* fs.copyFile(
        correctnessPath,
        join(context.observerDirectory, "case.lua"),
      );
    }
    const harnessFiles: Record<string, string> = {};
    const needsHarness = mode === "correctness" || scenario.activity !== null;
    if (needsHarness) {
      if (scenario.activity !== null) {
        yield* fs.copyFile(
          join(project.modRoot, scenario.activity.file),
          join(context.observerDirectory, "activity.lua"),
        );
      }
      yield* fs.writeFileString(
        join(context.observerDirectory, "window.lua"),
        `return { ticks = ${scenario.ticks}, activity = ${scenario.activity !== null}, checkpoints = { ${scenario.activity?.checkpoints.map((checkpoint) => checkpoint.update).join(", ") ?? ""} } }\n`,
      );
      for (const name of yield* fs.readDirectory(context.observerDirectory)) {
        harnessFiles[name] = yield* hashFile(
          join(context.observerDirectory, name),
        );
      }
    }
    const start = performance.now();
    const request = yield* decode(
      BenchmarkRequest,
      {
        schema: 3,
        runId: run.runId,
        mod: artifact.mod,
        directory,
        source,
        scenario,
        engine,
        artifact,
        companions: companions.map((entry) => entry.artifact),
        expectedMods: context.expectedMods,
        archives: context.archives,
        mode,
        window: {
          ticks: scenario.ticks,
          reloads: 1,
          detail: mode === "primary" ? parent.detail : "none",
        },
        fixtureSha256: scenario.fixture.sha256,
        correctnessSha256,
        harness: needsHarness
          ? {
              directory: relative(directory, context.observerDirectory),
              files: harnessFiles,
            }
          : null,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
      },
      "benchmark request",
    );
    yield* persist(join(directory, "benchmark-request.json"), request);
    const operation = Effect.gen(function* () {
      yield* withProcess(
        {
          ...run,
          evidence: "benchmark",
          ...(engine.docker === undefined ? {} : { docker: engine.docker }),
          command: [
            engine.executable,
            "--config",
            join(directory, "config.ini"),
            "--mod-directory",
            join(directory, "mods"),
            "--benchmark",
            save,
            "--benchmark-ticks",
            String(scenario.ticks),
            "--benchmark-runs",
            "1",
            "--benchmark-consistency",
            ...(request.window.detail === "ticks"
              ? ["--benchmark-verbose", "all"]
              : []),
          ],
          gameLog: {
            current: join(directory, "factorio-current.log"),
            previous: join(directory, "factorio-previous.log"),
          },
        },
        (child) => child.waitForExit,
      );
      const output = yield* readCommandOutput(
        directory,
        run.runId,
        16 * 1024 * 1024,
      );
      const proof = yield* decode(
        BenchmarkProof,
        {
          ...request,
          elapsedMs: performance.now() - start,
          status: "passed",
          processWallMs: (yield* readJSON(
            ProcessReceipt,
            join(directory, "process.json"),
          )).elapsedMs,
          result: yield* parseBenchmark(output.stdout, request.window),
          observation:
            mode === "correctness"
              ? yield* readJSON(
                  BenchmarkObservation,
                  join(
                    directory,
                    "script-output",
                    "benchmark-observation.json",
                  ),
                )
              : null,
        },
        "benchmark proof",
      );
      yield* qualifyBenchmark(request, proof);
      return proof;
    });
    return yield* operation.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const value = Exit.isSuccess(exit)
            ? exit.value
            : yield* decode(
                BenchmarkState,
                {
                  ...request,
                  elapsedMs: performance.now() - start,
                  status: Cause.hasInterruptsOnly(exit.cause)
                    ? "cancelled"
                    : "failed",
                  error: Cause.pretty(exit.cause),
                },
                "failed benchmark",
              );
          yield* persist(join(directory, "benchmark.json"), value);
        }),
      ),
    );
  });
}

export function runPerformance(
  project: ResolvedProject,
  scenarioName: string,
  options: {
    backend?: typeof Backend.Type;
    engine?: string;
    detail?: "none" | "ticks";
    budget?: string;
  } = {},
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const configPath = project.development.performance;
    if (configPath === undefined)
      return yield* failure(
        project.info.name,
        "No performance scenarios are declared by this product",
      );
    yield* assertCanonicalPath(join(project.modRoot, configPath));
    const config = yield* readJSON(
      PerformanceConfiguration,
      join(project.modRoot, configPath),
    );
    const declared = config.scenarios.find(
      (entry) => entry.name === scenarioName,
    );
    if (declared === undefined)
      return yield* failure(scenarioName, "Unknown performance scenario");
    const scenario =
      options.budget === undefined
        ? declared
        : {
            ...declared,
            budget: yield* readJSON(PerformanceBudget, resolve(options.budget)),
          };
    const baseline =
      scenario.budget === null
        ? null
        : yield* readPerformance(project, scenario.budget.baseline);
    if (!project.capabilities.profiles.includes(scenario.profile))
      return yield* failure(
        scenarioName,
        "Performance profile is not declared by this product",
      );
    yield* decode(
      BenchmarkWindow,
      { ticks: scenario.ticks, reloads: 1, detail: options.detail ?? "none" },
      "performance measurement window",
    );
    const fixturePath = join(project.modRoot, scenario.fixture.file);
    const correctnessPath = join(project.modRoot, scenario.correctness);
    yield* assertCanonicalPath(fixturePath);
    yield* assertCanonicalPath(correctnessPath);
    if ((yield* hashFile(fixturePath)) !== scenario.fixture.sha256)
      return yield* failure(
        scenario.name,
        "Performance fixture checksum differs",
      );
    const correctnessSha256 = yield* hashFile(correctnessPath);
    if (scenario.activity !== null) {
      const activityPath = join(project.modRoot, scenario.activity.file);
      yield* assertCanonicalPath(activityPath);
      if ((yield* hashFile(activityPath)) !== scenario.activity.sha256)
        return yield* failure(
          scenario.name,
          "Performance activity checksum differs",
        );
    }
    const source = yield* sourceSeal(project);
    const engine = yield* resolveEngine(
      project,
      "headless",
      options.engine,
      options.backend,
    );
    const processor = cpus();
    if (processor.length === 0)
      return yield* failure(
        "performance environment",
        "CPU class is unavailable",
      );
    const environment = yield* decode(
      PerformanceEnvironment,
      {
        platform: process.platform,
        architecture: process.arch,
        osRelease: release(),
        cpu: processor[0]!.model,
        logicalCpus: processor.length,
        memoryBytes: totalmem(),
        bun: process.versions.bun,
        cache: "fresh-process; host caches not flushed",
        powerAndThermal: "unmeasured",
        loadBefore: loadavg(),
        loadAfter: [],
      },
      "performance environment",
    );
    const run = yield* newRun(project, `perf-${scenario.name}`);
    const logs = yield* createLog(join(run.directory, "logs"), run.runId);
    const startedAt = new Date().toISOString(),
      start = performance.now();
    let phase = "package";
    const children: string[] = [];
    const identity = () => ({
      schema: 3 as const,
      runId: run.runId,
      mod: source.mod,
      directory: run.directory,
      source,
      scenario,
      correctnessSha256,
      engine,
      environment,
      detail: options.detail ?? "none",
      ownerPid: process.pid,
      startedAt,
      elapsedMs: performance.now() - start,
      phase,
      children: [...children],
    });
    const running = () =>
      Effect.gen(function* () {
        const value = yield* decode(
          PerformanceState,
          { ...identity(), status: "running" },
          "running performance measurement",
        );
        yield* persist(join(run.directory, "performance.json"), value);
        return value;
      });
    const step = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        phase = name;
        yield* running();
        yield* logs.append(
          "lifecycle",
          JSON.stringify({ event: "performance-phase", phase }) + "\n",
          { event: "performance-phase" },
        );
        return yield* effect.pipe(
          Effect.provideService(ParentRun, {
            runId: run.runId,
            phase,
            onChild: (event) =>
              Effect.gen(function* () {
                children.push(event.child.run);
                yield* logs.append("lifecycle", JSON.stringify(event) + "\n", {
                  event: event.event,
                });
                yield* running();
              }).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
          }),
        );
      });
    yield* running();
    yield* announceRun({
      ...run,
      kind: "performance",
      backend: "native",
      startedAt,
    });
    const operation = Effect.gen(function* () {
      const artifact = yield* step("package", packageProject(project));
      const companions: Companion[] = [];
      for (const name of project.development.companions ?? []) {
        const companion = yield* resolveProject(
          project.repoRoot,
          name,
          project.repoRoot,
        );
        companions.push({
          project: companion,
          artifact: yield* step("package-companion", packageProject(companion)),
        });
      }
      const primary: (typeof BenchmarkProof.Type)[] = [],
        correctness: (typeof BenchmarkProof.Type)[] = [];
      for (let index = 0; index < scenario.processes; index++) {
        // Alternate observer/control order; these are distinct process replications, not map reloads.
        const order =
          index % 2 === 0
            ? (["correctness", "primary"] as const)
            : (["primary", "correctness"] as const);
        for (const mode of order) {
          const proof = yield* step(
            `${mode}-${index + 1}`,
            runBenchmark(project, yield* running(), artifact, companions, mode),
          );
          (mode === "primary" ? primary : correctness).push(proof);
        }
      }
      if (
        new Set(primary.map((proof) => proof.result.samples[0]!.checksum))
          .size !== 1
      )
        return yield* failure(
          run.runId,
          "Independent primary processes disagree on final simulation checksum",
        );
      yield* step("seal", verifySourceSeal(source, yield* sourceSeal(project)));
      const summary = {
        meanUpdateMs: yield* distribution(
          primary.map(
            (proof) => proof.result.samples[0]!.totalMs / scenario.ticks,
          ),
        ),
        maximumUpdateMs: yield* distribution(
          primary.map((proof) => proof.result.samples[0]!.maximumMs),
        ),
        processWallMs: yield* distribution(
          primary.map((proof) => proof.processWallMs),
        ),
        correctnessProcessWallMs: yield* distribution(
          correctness.map((proof) => proof.processWallMs),
        ),
      };
      let result = yield* decode(
        PerformanceResult,
        {
          ...identity(),
          environment: { ...environment, loadAfter: loadavg() },
          status: "inconclusive",
          summary,
          dependencies: Object.fromEntries(
            Object.entries(primary[0]!.archives).filter(
              ([name]) => name !== project.info.name,
            ),
          ),
          assessment:
            "Measurements and separate correctness controls completed; no calibrated baseline comparison has been applied",
          primary: primary.map((proof) => proof.runId),
          correctness: correctness.map((proof) => proof.runId),
        },
        "performance result",
      );
      if (baseline !== null) {
        const comparison = yield* comparePerformance(baseline, result);
        if (comparison.status === "blocked")
          return yield* failure(run.runId, comparison.reasons.join("; "));
        result = yield* decode(
          PerformanceResult,
          {
            ...result,
            status: comparison.status,
            assessment: comparison.reasons.join("; "),
          },
          "assessed performance result",
        );
      }
      return result;
    });
    return yield* operation.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const sealed = yield* logs.seal.pipe(Effect.exit);
          if (Exit.isSuccess(exit) && Exit.isSuccess(sealed)) {
            yield* persist(join(run.directory, "performance.json"), exit.value);
            return;
          }
          yield* persist(
            join(run.directory, "performance.json"),
            yield* decode(
              PerformanceState,
              {
                ...identity(),
                status:
                  Exit.isFailure(exit) &&
                  Cause.hasInterruptsOnly(exit.cause) &&
                  Exit.isSuccess(sealed)
                    ? "cancelled"
                    : "failed",
                error: [
                  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "",
                  Exit.isFailure(sealed) ? Cause.pretty(sealed.cause) : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
              "failed performance measurement",
            ),
          );
          if (Exit.isFailure(sealed))
            return yield* Effect.failCause(sealed.cause);
        }),
      ),
    );
  });
}

/** Qualify measured values independently of the claimed budget assessment. */
function readMeasuredPerformance(project: ResolvedProject, input: string) {
  return Effect.gen(function* () {
    const runId = yield* decode(RunId, input, "performance run ID");
    const directory = join(project.outputRoot, "runs", runId);
    yield* assertCanonicalPath(directory);
    const record = yield* readJSON(RunRecord, join(directory, "run.json"));
    const result = yield* readJSON(
      PerformanceResult,
      join(directory, "performance.json"),
    );
    const log = yield* readLogState(join(directory, "logs"));
    if (
      record.run !== runId ||
      record.kind !== "performance" ||
      record.mod !== project.info.name ||
      record.repository !== project.repoRoot ||
      record.directory !== directory ||
      result.runId !== runId ||
      result.mod.name !== project.info.name ||
      result.directory !== directory ||
      result.source.mod.name !== result.mod.name ||
      result.source.mod.version !== result.mod.version ||
      record.ownerPid !== result.ownerPid ||
      Date.parse(result.startedAt) !== record.startedAtUnixMs ||
      log.final === undefined ||
      log.manifest.runId !== runId
    )
      return yield* failure(
        runId,
        "Performance history is unsealed, foreign or internally inconsistent",
      );
    const primary: (typeof BenchmarkProof.Type)[] = [],
      correctness: (typeof BenchmarkProof.Type)[] = [];
    for (const [mode, ids] of [
      ["primary", result.primary],
      ["correctness", result.correctness],
    ] as const) {
      if (ids.length !== result.scenario.processes)
        return yield* failure(runId, "Missing independent benchmark processes");
      for (const id of ids) {
        if (!result.children.includes(id))
          return yield* failure(
            runId,
            "Benchmark child is absent from its parent's inventory",
          );
        const path = join(project.outputRoot, "runs", id);
        yield* assertCanonicalPath(path);
        const child = yield* readJSON(RunRecord, join(path, "run.json"));
        const request = yield* readJSON(
          BenchmarkRequest,
          join(path, "benchmark-request.json"),
        );
        const proof = yield* readJSON(
          BenchmarkProof,
          join(path, "benchmark.json"),
        );
        if (
          child.kind !== "benchmark" ||
          child.parent?.runId !== runId ||
          child.run !== id ||
          child.directory !== path ||
          child.repository !== project.repoRoot ||
          child.mod !== project.info.name ||
          request.runId !== id ||
          request.directory !== path ||
          request.source.sha256 !== result.source.sha256 ||
          request.mode !== mode ||
          request.window.ticks !== result.scenario.ticks ||
          request.window.reloads !== 1 ||
          request.window.detail !==
            (mode === "primary" ? result.detail : "none") ||
          !isDeepStrictEqual(request.scenario, result.scenario) ||
          !isDeepStrictEqual(request.engine, result.engine)
        )
          return yield* failure(
            id,
            "Benchmark child is foreign, stale or inconsistent with its parent",
          );
        yield* qualifyBenchmark(request, proof);
        yield* verifySourceSeal(result.source, request.source);
        if (
          request.correctnessSha256 !== result.correctnessSha256 ||
          !isDeepStrictEqual(
            result.dependencies,
            Object.fromEntries(
              Object.entries(request.archives).filter(
                ([name]) => name !== project.info.name,
              ),
            ),
          )
        )
          return yield* failure(
            id,
            "Benchmark dependency or correctness inputs differ from the aggregate",
          );
        (mode === "primary" ? primary : correctness).push(proof);
      }
    }
    if (
      new Set([...result.primary, ...result.correctness]).size !==
      result.primary.length + result.correctness.length
    )
      return yield* failure(runId, "Duplicate benchmark process identity");
    if (
      new Set(primary.map((proof) => proof.result.samples[0]!.checksum))
        .size !== 1
    )
      return yield* failure(
        runId,
        "Independent primary processes disagree on final simulation checksum",
      );
    const summary = {
      meanUpdateMs: yield* distribution(
        primary.map(
          (proof) => proof.result.samples[0]!.totalMs / result.scenario.ticks,
        ),
      ),
      maximumUpdateMs: yield* distribution(
        primary.map((proof) => proof.result.samples[0]!.maximumMs),
      ),
      processWallMs: yield* distribution(
        primary.map((proof) => proof.processWallMs),
      ),
      correctnessProcessWallMs: yield* distribution(
        correctness.map((proof) => proof.processWallMs),
      ),
    };
    if (!isDeepStrictEqual(result.summary, summary))
      return yield* failure(
        runId,
        "Stored performance summary differs from its process samples",
      );
    return result;
  });
}

/** Read history without requiring the active checkout to still be its historical source. */
export function readPerformance(project: ResolvedProject, input: string) {
  return Effect.gen(function* () {
    const result = yield* readMeasuredPerformance(project, input);
    const budget = result.scenario.budget;
    if (budget === null) {
      if (result.status !== "inconclusive")
        return yield* failure(
          result.runId,
          "Uncalibrated measurements cannot claim a performance pass or regression",
        );
    } else {
      const baseline = yield* readMeasuredPerformance(project, budget.baseline);
      const comparison = yield* comparePerformance(baseline, result);
      if (
        comparison.status === "blocked" ||
        comparison.status !== result.status ||
        comparison.reasons.join("; ") !== result.assessment
      )
        return yield* failure(
          result.runId,
          "Stored performance assessment differs from its qualified baseline comparison",
        );
    }
    return result;
  });
}
