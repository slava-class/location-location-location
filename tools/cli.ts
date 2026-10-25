import { BunHttpClient, BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { runCLI } from "./cli-runtime.ts";
import { join, resolve } from "node:path";
import {
  BoundaryError,
  decode,
  discoverProjects,
  Project,
  resolveProject,
  resolveWorkspace,
  TestProfile,
} from "./projects.ts";
import { RunId } from "./logs.ts";
import { packageProject } from "./packaging.ts";
import { PackageResult } from "./contracts.ts";
import { lintProject, typecheckProject } from "./lua.ts";
import { runEngineSuite } from "./testing.ts";
import { auditProject } from "./audit.ts";
import { setupWorkspace, testModels } from "./checks.ts";
import { smokePackage } from "./smoke.ts";
import { runQuality } from "./quality.ts";
import { setVersion } from "./release-info.ts";
import { planVerification } from "./verification.ts";
import { runReportedVerification } from "./verification-output.ts";
import { modStatus, mutateMod, restoreMod } from "./local-mod.ts";
import { checkpointWorkspace } from "./checkpoint.ts";
import { prepareRelease } from "./release.ts";
import { publishRelease, releaseStatus } from "./publication.ts";
import type { PublicationMode } from "./publication.ts";
import { listRuns, readRun } from "./run-status.ts";
import { formatLogView, LogFilter, LogRead, readLogView } from "./log-view.ts";
import { Backend } from "./backend.ts";
import { provisionDockerRuntime } from "./docker-runtime.ts";
import { provisionDependencies } from "./dependencies.ts";
import { fleetStatus } from "./fleet.ts";
import { RunAnnouncements, RunRecord } from "./runs.ts";
import { BenchmarkWindow } from "./benchmark.ts";
import { comparePerformance } from "./performance-analysis.ts";
import { readPerformance, runPerformance } from "./performance.ts";
import { studioCommand } from "./tuning/cli.ts";
import { runProjectCommand } from "./project-tooling.ts";
import { GraphicsPreset } from "./engine.ts";
import { AffectedSelection, selectAffected } from "./affected.ts";

const backendFlag = Flag.String("backend").pipe(
  Flag.withSchema(Schema.String.pipe(Schema.decodeTo(Backend))),
  Flag.withDefault("native"),
);
const companionFlag = Flag.String("companion").pipe(Flag.atLeast(0));

const releasePrepare = Command.make(
  "release-prepare",
  {
    mod: Argument.String("mod"),
    language: Flag.String("language").pipe(Flag.withDefault("en")),
    engine: Flag.String("engine").pipe(Flag.optional),
    backend: backendFlag,
  },
  ({ mod, language, engine, backend }) =>
    Effect.gen(function* () {
      const selected = Option.getOrUndefined(engine);
      const bundle = yield* prepareRelease(
        yield* resolveProject(root, mod, process.cwd()),
        {
          language,
          backend,
          ...(selected === undefined ? {} : { engine: selected }),
        },
      );
      yield* Console.log(
        JSON.stringify(
          {
            mod: bundle.manifest.mod,
            manifest: join(bundle.directory, "manifest.json"),
            source: bundle.manifest.source.sha256,
            archive: bundle.manifest.archive,
            gallery: bundle.manifest.images,
            published: false,
          },
          null,
          2,
        ),
      );
    }),
);
const releaseReadback = Command.make(
  "release-status",
  { mod: Argument.String("mod") },
  ({ mod }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* releaseStatus(yield* resolveProject(root, mod, process.cwd())),
          null,
          2,
        ),
      );
    }),
);
function publicationCommand(mode: typeof PublicationMode.Type) {
  return Command.make(
    mode === "publish" ? "release-publish" : `${mode}-publish`,
    {
      mod: Argument.String("mod"),
      version: Argument.String("version"),
    },
    ({ mod, version }) =>
      Effect.gen(function* () {
        const result = yield* publishRelease(
          yield* resolveProject(root, mod, process.cwd()),
          version,
          mode,
          {
            ...(process.env.MOD_UPLOAD_API_KEY === undefined
              ? {}
              : { uploadKey: process.env.MOD_UPLOAD_API_KEY }),
            ...(process.env.MOD_EDIT_API_KEY === undefined
              ? {}
              : { editKey: process.env.MOD_EDIT_API_KEY }),
          },
        );
        yield* Console.log(JSON.stringify(result, null, 2));
      }),
  );
}

const root = resolve(import.meta.dir, "..");
const mods = Command.make("mods", {}, () =>
  Effect.gen(function* () {
    const projects = yield* discoverProjects(root);
    yield* Console.log(JSON.stringify(yield* fleetStatus(projects), null, 2));
  }),
);
const inspect = Command.make(
  "resolve",
  { mod: Argument.String("mod"), companion: companionFlag },
  ({ mod, companion }) =>
    Effect.gen(function* () {
      const project = yield* resolveProject(root, mod, process.cwd(), {
        companions: companion,
      });
      yield* Console.log(
        JSON.stringify(Schema.encodeSync(Project)(project), null, 2),
      );
    }),
);
const projectCommand = Command.make(
  "project",
  {
    mod: Argument.String("mod"),
    args: Argument.variadic(Argument.String("args")),
  },
  ({ mod, args }) =>
    Effect.gen(function* () {
      yield* runProjectCommand(
        yield* resolveProject(root, mod, process.cwd()),
        args,
      );
    }),
).pipe(
  Command.withDescription(
    "Run product-owned Effect CLI commands; put their arguments after --",
  ),
);
const buildPackage = Command.make(
  "package",
  { mod: Argument.String("mod") },
  ({ mod }) =>
    Effect.gen(function* () {
      const project = yield* resolveProject(root, mod, process.cwd());
      const result = yield* packageProject(project);
      yield* Console.log(
        JSON.stringify(Schema.encodeSync(PackageResult)(result), null, 2),
      );
    }),
);
const smoke = Command.make(
  "package-smoke",
  { mod: Argument.String("mod"), backend: backendFlag },
  ({ mod, backend }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* smokePackage(yield* resolveProject(root, mod, process.cwd()), {
            backend,
          }),
          null,
          2,
        ),
      );
    }),
);
const version = Command.make(
  "release-version",
  {
    mod: Argument.String("mod"),
    version: Argument.String("version"),
    note: Argument.String("note"),
  },
  ({ mod, version, note }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* setVersion(
            yield* resolveProject(root, mod, process.cwd()),
            version,
            note,
          ),
          null,
          2,
        ),
      );
    }),
);
const lint = Command.make("lint", { mod: Argument.String("mod") }, ({ mod }) =>
  Effect.gen(function* () {
    yield* Console.log(
      JSON.stringify(
        yield* lintProject(yield* resolveProject(root, mod, process.cwd())),
        null,
        2,
      ),
    );
  }),
);
const typecheck = Command.make(
  "typecheck",
  { mod: Argument.String("mod") },
  ({ mod }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* typecheckProject(
            yield* resolveProject(root, mod, process.cwd()),
          ),
          null,
          2,
        ),
      );
    }),
);
function qualityCommand(name: "check" | "format-check" | "format") {
  return Command.make(
    name,
    {
      mod: Argument.String("mod").pipe(Argument.optional),
      all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
    },
    ({ mod, all }) =>
      Effect.gen(function* () {
        if (Option.isSome(mod) === all)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message: "Select exactly one mod or --all",
            }),
          );
        const context = all
          ? yield* resolveWorkspace(root)
          : yield* resolveProject(root, Option.getOrThrow(mod), process.cwd());
        yield* Console.log(
          JSON.stringify(yield* runQuality(context, name), null, 2),
        );
      }),
  );
}
const audit = Command.make(
  "audit",
  { mod: Argument.String("mod") },
  ({ mod }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* auditProject(yield* resolveProject(root, mod, process.cwd())),
          null,
          2,
        ),
      );
    }),
);
const setup = Command.make("setup", {}, () =>
  Effect.gen(function* () {
    const project = yield* resolveWorkspace(root);
    yield* Console.log(JSON.stringify(yield* setupWorkspace(project), null, 2));
  }),
);
const engineProvision = Command.make(
  "engine-provision",
  {
    factorioArchive: Flag.String("factorio-archive").pipe(Flag.optional),
    bunArchive: Flag.String("bun-archive").pipe(Flag.optional),
  },
  ({ factorioArchive, bunArchive }) =>
    Effect.gen(function* () {
      if (Option.isSome(factorioArchive) !== Option.isSome(bunArchive))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "engine provisioning",
            message: "Supply both pinned local archives or neither",
          }),
        );
      const archives =
        Option.isSome(factorioArchive) && Option.isSome(bunArchive)
          ? {
              factorio: resolve(factorioArchive.value),
              bun: resolve(bunArchive.value),
            }
          : undefined;
      const runtime = yield* provisionDockerRuntime(
        yield* resolveWorkspace(root),
        archives,
      );
      yield* Console.log(JSON.stringify(runtime, null, 2));
    }),
);
const dependenciesProvision = Command.make(
  "dependencies-provision",
  {
    mod: Argument.String("mod").pipe(Argument.optional),
    all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
    from: Flag.String("from").pipe(Flag.optional),
  },
  ({ mod, all, from }) =>
    Effect.gen(function* () {
      if (Option.isSome(mod) === all)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "dependency provisioning",
            message: "Select exactly one mod or --all",
          }),
        );
      const projects = all
        ? yield* discoverProjects(root)
        : [yield* resolveProject(root, Option.getOrThrow(mod), process.cwd())];
      const directory = Option.isSome(from) ? resolve(from.value) : undefined;
      const results = yield* Effect.forEach(projects, (project) =>
        provisionDependencies(project, directory),
      );
      yield* Console.log(JSON.stringify(results, null, 2));
    }),
);

const installedStatus = Command.make(
  "mod-status",
  {
    mod: Argument.String("mod"),
    profile: Flag.String("profile").pipe(Flag.optional),
  },
  ({ mod, profile }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* modStatus(mod, Option.getOrUndefined(profile)),
          null,
          2,
        ),
      );
    }),
);
function installationCommand(action: "load" | "unload") {
  return Command.make(
    `mod-${action}`,
    {
      target: Argument.String(action === "load" ? "archive" : "mod"),
      save: Flag.String("save"),
      profile: Flag.String("profile").pipe(Flag.optional),
      dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    },
    ({ target, save, profile, dryRun }) =>
      Effect.gen(function* () {
        const selected = Option.getOrUndefined(profile);
        const result = yield* mutateMod(
          yield* resolveWorkspace(root),
          action,
          target,
          save,
          {
            dryRun,
            ...(selected === undefined ? {} : { profile: selected }),
          },
        );
        yield* Console.log(JSON.stringify(result, null, 2));
      }),
  );
}
const installationRestore = Command.make(
  "mod-restore",
  {
    receipt: Argument.String("receipt"),
    profile: Flag.String("profile").pipe(Flag.optional),
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
  },
  ({ receipt, profile, dryRun }) =>
    Effect.gen(function* () {
      const selected = Option.getOrUndefined(profile);
      const result = yield* restoreMod(yield* resolveWorkspace(root), receipt, {
        dryRun,
        ...(selected === undefined ? {} : { profile: selected }),
      });
      yield* Console.log(JSON.stringify(result, null, 2));
    }),
);
const model = Command.make(
  "test-model",
  { mod: Argument.String("mod") },
  ({ mod }) =>
    Effect.gen(function* () {
      yield* Console.log(
        JSON.stringify(
          yield* testModels(yield* resolveProject(root, mod, process.cwd())),
          null,
          2,
        ),
      );
    }),
);
const test = Command.make(
  "test",
  {
    mod: Argument.String("mod"),
    profile: Flag.String("profile").pipe(Flag.withDefault("base")),
    engine: Flag.String("engine").pipe(Flag.optional),
    backend: backendFlag,
    companion: companionFlag,
  },
  ({ mod, profile, engine, backend, companion }) =>
    Effect.gen(function* () {
      const selected = yield* decode(TestProfile, profile, "test profile"),
        executable = Option.getOrUndefined(engine);
      yield* Console.log(
        JSON.stringify(
          yield* runEngineSuite(
            yield* resolveProject(root, mod, process.cwd(), {
              companions: companion,
            }),
            selected,
            {
              backend,
              ...(executable === undefined ? {} : { engine: executable }),
            },
          ),
          null,
          2,
        ),
      );
    }),
);
const perf = Command.make(
  "perf",
  {
    mod: Argument.String("mod"),
    scenario: Argument.String("scenario"),
    backend: backendFlag,
    engine: Flag.String("engine").pipe(Flag.optional),
    companion: companionFlag,
    budget: Flag.String("budget").pipe(Flag.optional),
    diagnostics: Flag.String("diagnostics").pipe(
      Flag.withSchema(
        Schema.String.pipe(Schema.decodeTo(BenchmarkWindow.fields.detail)),
      ),
      Flag.withDefault("none"),
    ),
  },
  ({ mod, scenario, backend, engine, diagnostics, companion, budget }) =>
    Effect.gen(function* () {
      const executable = Option.getOrUndefined(engine);
      const result = yield* runPerformance(
        yield* resolveProject(root, mod, process.cwd(), {
          companions: companion,
        }),
        scenario,
        {
          backend,
          detail: diagnostics,
          ...(executable === undefined ? {} : { engine: executable }),
          ...(Option.isNone(budget) ? {} : { budget: budget.value }),
        },
      );
      yield* Console.log(JSON.stringify(result, null, 2));
      if (result.status === "regressed")
        return yield* Effect.fail(
          new BoundaryError({
            boundary: result.runId,
            message: result.assessment,
          }),
        );
    }),
);
const perfCompare = Command.make(
  "perf-compare",
  {
    mod: Argument.String("mod"),
    baseline: Argument.String("baseline").pipe(
      Argument.withSchema(Schema.String.pipe(Schema.decodeTo(RunId))),
    ),
    candidate: Argument.String("candidate").pipe(
      Argument.withSchema(Schema.String.pipe(Schema.decodeTo(RunId))),
    ),
  },
  ({ mod, baseline, candidate }) =>
    Effect.gen(function* () {
      const project = yield* resolveProject(root, mod, process.cwd());
      const result = yield* comparePerformance(
        yield* readPerformance(project, baseline),
        yield* readPerformance(project, candidate),
      );
      yield* Console.log(JSON.stringify(result, null, 2));
      if (result.status === "regressed" || result.status === "blocked")
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "performance comparison",
            message: result.reasons.join("; "),
          }),
        );
    }),
);
function captureCommand(name: "test-ui" | "gallery") {
  return Command.make(
    name,
    {
      mod: Argument.String("mod"),
      language: Flag.String("language").pipe(Flag.withDefault("en")),
      engine: Flag.String("engine").pipe(Flag.optional),
      graphics: Flag.String("graphics").pipe(
        Flag.withSchema(Schema.String.pipe(Schema.decodeTo(GraphicsPreset))),
        Flag.optional,
      ),
      companion: companionFlag,
    },
    ({ mod, language, engine, graphics, companion }) =>
      Effect.gen(function* () {
        const executable = Option.getOrUndefined(engine);
        const preset = Option.getOrUndefined(graphics);
        yield* Console.log(
          JSON.stringify(
            yield* runEngineSuite(
              yield* resolveProject(root, mod, process.cwd(), {
                companions: companion,
              }),
              name === "gallery" ? "gallery" : "native",
              {
                language,
                ...(executable === undefined ? {} : { engine: executable }),
                ...(preset === undefined ? {} : { graphics: preset }),
              },
            ),
            null,
            2,
          ),
        );
      }),
  );
}
const runs = Command.make(
  "runs",
  {
    mod: Argument.String("mod").pipe(Argument.optional),
    workspace: Flag.Boolean("workspace").pipe(Flag.withDefault(false)),
    run: Flag.String("run").pipe(Flag.optional),
    active: Flag.Boolean("active").pipe(Flag.withDefault(false)),
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    after: Flag.String("after").pipe(Flag.optional),
    kind: Flag.String("kind").pipe(
      Flag.withSchema(
        Schema.String.pipe(Schema.decodeTo(RunRecord.fields.kind)),
      ),
      Flag.optional,
    ),
  },
  ({ mod, workspace, run, active, limit, after, kind }) =>
    Effect.gen(function* () {
      if (
        (workspace && Option.isSome(mod)) ||
        (Option.isSome(run) &&
          (active ||
            Option.isSome(after) ||
            Option.isSome(kind) ||
            limit !== 20))
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "runs",
            message:
              "Choose mod or workspace, not both; exact run lookup cannot use listing filters",
          }),
        );
      const contexts = Option.isSome(mod)
        ? [yield* resolveProject(root, mod.value, process.cwd())]
        : workspace
          ? [yield* resolveWorkspace(root)]
          : [yield* resolveWorkspace(root), ...(yield* discoverProjects(root))];
      if (Option.isSome(run)) {
        const runId = yield* decode(RunId, run.value, "run ID");
        const fs = yield* FileSystem.FileSystem;
        const matches = [];
        for (const context of contexts)
          if (
            yield* fs.exists(
              join(context.outputRoot, "runs", runId, "run.json"),
            )
          )
            matches.push(context);
        if (matches.length !== 1 || matches[0] === undefined)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: runId,
              message:
                "Exact lookup requires one registered run in the selected workspace scope",
            }),
          );
        yield* Console.log(
          JSON.stringify(yield* readRun(matches[0], runId), null, 2),
        );
      } else {
        yield* Console.log(
          JSON.stringify(
            yield* listRuns(contexts, {
              active,
              limit,
              ...(Option.isSome(after) ? { after: after.value } : {}),
              ...(Option.isSome(kind) ? { kind: kind.value } : {}),
            }),
            null,
            2,
          ),
        );
      }
    }),
);

const logs = Command.make(
  "logs",
  {
    mod: Argument.String("mod").pipe(Argument.optional),
    workspace: Flag.Boolean("workspace").pipe(Flag.withDefault(false)),
    run: Flag.String("run"),
    cursor: Flag.Int("cursor").pipe(Flag.withDefault(0)),
    limit: Flag.Int("limit").pipe(Flag.withDefault(64)),
    follow: Flag.Boolean("follow").pipe(Flag.withDefault(false)),
    channel: Flag.String("channel").pipe(Flag.optional),
    event: Flag.String("event").pipe(Flag.optional),
    format: Flag.String("format").pipe(Flag.withDefault("jsonl")),
  },
  ({ mod, workspace, run, cursor, limit, follow, channel, event, format }) =>
    Effect.gen(function* () {
      const runId = yield* decode(RunId, run, "run ID");
      const outputFormat = yield* decode(
        Schema.Literals(["jsonl", "text"]),
        format,
        "log output format",
      );
      const filter = yield* decode(
        LogFilter,
        {
          ...(Option.isSome(channel) ? { channel: channel.value } : {}),
          ...(Option.isSome(event) ? { event: event.value } : {}),
        },
        "log filter",
      );
      if (Option.isSome(mod) === workspace)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "logs",
            message: "Select exactly one mod or --workspace",
          }),
        );
      const project = yield* workspace
        ? resolveWorkspace(root)
        : resolveProject(root, Option.getOrThrow(mod), process.cwd());
      let position = { runId, sequence: cursor };
      let previous: typeof LogRead.Type.run | undefined;
      while (true) {
        const view = yield* readLogView(project, position, filter, limit);
        position = view.page.cursor;
        const changed =
          previous === undefined ||
          previous.status !== view.run.status ||
          previous.proof !== view.run.proof ||
          previous.phase !== view.run.phase ||
          previous.owner !== view.run.owner ||
          previous.logsClosed !== view.run.logsClosed;
        previous = view.run;
        if (view.scanned || changed || view.complete || !follow)
          yield* Console.log(
            outputFormat === "jsonl"
              ? JSON.stringify(Schema.encodeSync(LogRead)(view))
              : formatLogView(view),
          );
        if (!follow || view.complete) return;
        if (view.scanned === 0) yield* Effect.sleep(100);
      }
    }),
);
const verify = Command.make(
  "verify",
  {
    mod: Argument.String("mod").pipe(Argument.optional),
    all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
    backend: backendFlag,
    plan: Flag.Boolean("plan").pipe(Flag.withDefault(false)),
    affected: Flag.String("affected").pipe(Flag.optional),
  },
  ({ mod, all, backend, plan, affected }) =>
    Effect.gen(function* () {
      if (
        Number(Option.isSome(mod)) +
          Number(all) +
          Number(Option.isSome(affected)) >
        1
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "verify",
            message:
              "A mod selector, --all and --affected are mutually exclusive",
          }),
        );
      const scope = Option.isSome(affected)
        ? yield* selectAffected(root, affected.value)
        : null;
      const projects =
        scope !== null
          ? scope.projects
          : Option.isSome(mod)
            ? [yield* resolveProject(root, mod.value, process.cwd())]
            : yield* discoverProjects(root);
      if (scope !== null && projects.length === 0) {
        const empty = yield* decode(
          Schema.Struct({
            status: Schema.Literal("not-needed"),
            plan: Schema.Boolean,
            selection: AffectedSelection,
          }),
          { status: "not-needed", plan, selection: scope.selection },
          "empty affected selection",
        );
        yield* Console.log(JSON.stringify(empty, null, 2));
        return;
      }
      if (plan) {
        yield* Console.log(
          JSON.stringify(
            yield* planVerification(
              projects,
              backend,
              "verify",
              scope?.selection ?? null,
            ),
            null,
            2,
          ),
        );
        return;
      }
      const report = yield* runReportedVerification(
        projects,
        backend,
        scope === null
          ? Option.isNone(mod)
          : scope.selection.workspaceChanges.length > 0,
        scope?.selection ?? null,
      );
      if (report.status === "failed")
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "verify",
            message:
              "Selected verification failed; inspect the reported run receipts and live logs",
          }),
        );
    }).pipe(
      Effect.provideService(RunAnnouncements, { write: () => Effect.void }),
    ),
);

function checkpointCommand(name: "checkpoint" | "vac") {
  return Command.make(
    name,
    {
      message: Argument.String("message").pipe(Argument.optional),
      backend: backendFlag,
      plan: Flag.Boolean("plan").pipe(Flag.withDefault(false)),
    },
    ({ message, backend, plan }) =>
      Effect.gen(function* () {
        if (plan) {
          yield* Console.log(
            JSON.stringify(
              yield* planVerification(
                yield* discoverProjects(root),
                backend,
                name,
              ),
              null,
              2,
            ),
          );
          return;
        }
        if (Option.isNone(message))
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message:
                "An explicit commit message is required unless --plan is used",
            }),
          );
        const workspace = yield* resolveWorkspace(root);
        const result = yield* checkpointWorkspace(
          workspace,
          {
            mode: name === "vac" ? "publish" : "local",
            message: message.value,
          },
          () =>
            discoverProjects(root).pipe(
              Effect.flatMap((projects) =>
                runReportedVerification(projects, backend, true),
              ),
            ),
        );
        yield* Console.log(JSON.stringify(result, null, 2));
      }),
  );
}

const command = Command.make("modkit").pipe(
  Command.withSubcommands([
    mods,
    inspect,
    projectCommand,
    buildPackage,
    smoke,
    version,
    releasePrepare,
    releaseReadback,
    publicationCommand("publish"),
    publicationCommand("gallery"),
    publicationCommand("listing"),
    verify,
    checkpointCommand("checkpoint"),
    checkpointCommand("vac"),
    qualityCommand("check"),
    qualityCommand("format-check"),
    qualityCommand("format"),
    lint,
    typecheck,
    audit,
    setup,
    engineProvision,
    dependenciesProvision,
    installedStatus,
    installationCommand("load"),
    installationCommand("unload"),
    installationRestore,
    model,
    test,
    perf,
    perfCompare,
    captureCommand("test-ui"),
    captureCommand("gallery"),
    studioCommand(root),
    logs,
    runs,
  ]),
);
runCLI(
  Command.runWith(command, { version: "workspace" })(
    process.argv.slice(2),
  ).pipe(
    Effect.provide(BunServices.layer),
    Effect.provide(BunHttpClient.layer),
  ),
);
