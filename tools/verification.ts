import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  FileSystem,
  Option,
  Schema,
} from "effect";
import { join } from "node:path";
import { auditProject, AuditResult } from "./audit.ts";
import {
  BunTestResult,
  checkToolchain,
  CommandCheck,
  ModelResult,
  runBunTests,
  testModels,
  Toolchain,
} from "./checks.ts";
import { runCommand } from "./commands.ts";
import {
  AbsolutePath,
  ElapsedMs,
  ModIdentity,
  PackageResult,
} from "./contracts.ts";
import { createLog, RunId } from "./logs.ts";
import {
  lintProject,
  LuaCheckResult,
  LuaTypecheckResult,
  typecheckProject,
} from "./lua.ts";
import { packageProject } from "./packaging.ts";
import {
  BoundaryError,
  Capabilities,
  decode,
  resolveWorkspace,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { announceRun, newRun, ParentRun } from "./runs.ts";
import { sourceSeal, SourceSeal, verifySourceSeal } from "./source.ts";
import { runEngineSuite, VerificationResult } from "./testing.ts";
import { withWorkspaceSnapshot } from "./workspace.ts";
import { QualityResult, runQuality } from "./quality.ts";
import { Backend } from "./backend.ts";

export const Phase = Schema.Literals([
  "toolchain",
  "whitespace",
  "audit",
  "lint",
  "models",
  "types",
  "quality",
  "tool-tests",
  "package",
  "engine",
  "seal",
]);

const VerificationPlan = Schema.Struct({
  schema: Schema.Literal(1),
  status: Schema.Literal("planned"),
  command: Schema.Literals(["verify", "checkpoint", "vac"]),
  phases: Schema.Array(Phase),
  projects: Schema.Array(
    Schema.Struct({
      mod: ModIdentity,
      capabilities: Capabilities,
      backend: Schema.NullOr(Backend),
    }),
  ).check(Schema.isMinLength(1)),
  commit: Schema.Literals(["none", "local", "push"]),
});

/** Metadata only: no source seal, prerequisite checks, processes, or run allocation. */
export function planVerification(
  projects: readonly ResolvedProject[],
  backend: typeof Backend.Type,
  command: typeof VerificationPlan.Type.command,
) {
  return decode(
    VerificationPlan,
    {
      schema: 1,
      status: "planned",
      command,
      phases: Phase.literals,
      projects: projects.map((project) => ({
        mod: { name: project.info.name, version: project.info.version },
        capabilities: project.capabilities,
        backend: project.capabilities.profiles.length > 0 ? backend : null,
      })),
      commit:
        command === "vac"
          ? "push"
          : command === "checkpoint"
            ? "local"
            : "none",
    },
    "verification plan",
  );
}
const PhaseTiming = Schema.Struct({
  phase: Phase,
  status: Schema.Literals(["passed", "failed", "cancelled"]),
  elapsedMs: ElapsedMs,
  execution: Schema.Literals(["project", "workspace", "shared"]),
  runs: Schema.Array(RunId),
});
const Identity = Schema.Struct({
  schema: Schema.Literal(2),
  runId: RunId,
  mod: ModIdentity,
  directory: AbsolutePath,
  ownerPid: Schema.Int,
  source: SourceSeal,
  capabilities: Capabilities,
  startedAt: Schema.NonEmptyString,
  elapsedMs: ElapsedMs,
  phase: Phase,
  completed: Schema.Array(Phase),
  timings: Schema.Array(PhaseTiming),
});
const Checks = Schema.Struct({
  toolchain: Toolchain,
  whitespace: CommandCheck,
  quality: QualityResult,
  audit: AuditResult,
  lint: LuaCheckResult,
  types: LuaTypecheckResult,
  toolTests: BunTestResult,
  models: ModelResult,
});
export const ProjectVerification = Schema.Struct({
  ...Identity.fields,
  status: Schema.Literal("passed"),
  phase: Schema.Literal("seal"),
  completed: Schema.Tuple(Phase.literals.map((phase) => Schema.Literal(phase))),
  timings: Schema.Tuple(
    Phase.literals.map((phase) =>
      Schema.Struct({
        ...PhaseTiming.fields,
        phase: Schema.Literal(phase),
        status: Schema.Literal("passed"),
      }),
    ),
  ),
  checks: Checks,
  artifact: PackageResult,
  engine: Schema.Array(VerificationResult),
});
const ProjectVerificationFailure = Schema.Struct({
  ...Identity.fields,
  status: Schema.Literals(["failed", "cancelled"]),
  error: Schema.String,
});
const ProjectVerificationRunning = Schema.Struct({
  ...Identity.fields,
  status: Schema.Literal("running"),
});
export const ProjectVerificationState = Schema.Union([
  ProjectVerification,
  ProjectVerificationFailure,
  ProjectVerificationRunning,
]);
export const VerificationProgress = Context.Service<{
  readonly update: (
    state: typeof ProjectVerificationState.Type,
  ) => Effect.Effect<void, BoundaryError>;
  readonly complete: (
    summary: typeof ProjectSummary.Type,
  ) => Effect.Effect<void, BoundaryError>;
}>("modkit/VerificationProgress");
const PhaseEvent = Schema.Struct({
  event: Schema.Literal("verification-phase"),
  phase: Phase,
  status: Schema.Literals(["started", "completed", "failed", "cancelled"]),
  runs: Schema.Array(RunId),
  timing: Schema.NullOr(PhaseTiming),
});
class ProjectVerificationError extends Data.TaggedError(
  "ProjectVerificationError",
)<{
  readonly runId: string;
  readonly directory: string;
  readonly mod: string;
  readonly phase: string;
  readonly message: string;
  readonly elapsedMs: number;
  readonly timings: readonly (typeof PhaseTiming.Type)[];
}> {}
const SummaryIdentity = Schema.Struct({
  mod: ModIdentity,
  capabilities: Capabilities,
  elapsedMs: Schema.NullOr(ElapsedMs),
  timings: Schema.Array(PhaseTiming),
});
const ProjectSummary = Schema.Union([
  Schema.Struct({
    ...SummaryIdentity.fields,
    status: Schema.Literal("passed"),
    runId: RunId,
    directory: AbsolutePath,
    engineProfiles: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ...SummaryIdentity.fields,
    status: Schema.Literal("failed"),
    runId: RunId,
    directory: AbsolutePath,
    error: Schema.String,
  }),
  Schema.Struct({
    ...SummaryIdentity.fields,
    status: Schema.Literal("prerequisite-failed"),
    error: Schema.String,
  }),
]);
const VerificationReport = Schema.Struct({
  status: Schema.Literals(["passed", "failed"]),
  elapsedMs: ElapsedMs,
  projects: Schema.Array(ProjectSummary),
});
export function verifyProjects(
  projects: readonly ResolvedProject[],
  backend: typeof Backend.Type,
  workspaceQuality: boolean,
) {
  return Effect.gen(function* () {
    const started = performance.now();
    const selectedBackend = yield* decode(
      Backend,
      backend,
      "verification backend",
    );
    if (projects.length === 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "verify",
          message: "No projects selected",
        }),
      );
    const workspace = resolveWorkspace(projects[0]!.repoRoot);
    // Capture every source before the first shared check, not when a later mod starts.
    const sources = yield* Effect.forEach(projects, (project) =>
      sourceSeal(project).pipe(Effect.exit),
    );
    const shared = {
      quality: yield* Effect.cached(
        workspace.pipe(
          Effect.flatMap((context) =>
            runQuality(
              context,
              "check",
              workspaceQuality ? undefined : projects,
            ),
          ),
        ),
      ),
      toolTests: yield* Effect.cached(
        workspace.pipe(
          Effect.flatMap((context) =>
            runBunTests(
              context,
              [join(context.repoRoot, "tools")],
              "test-toolkit",
            ),
          ),
        ),
      ),
      used: new Set<typeof Phase.Type>(),
    };
    const progress = yield* Effect.serviceOption(VerificationProgress);
    const rows = yield* Effect.forEach(projects, (project, index) => {
      const identity = {
        mod: { name: project.info.name, version: project.info.version },
        capabilities: project.capabilities,
      };
      const source = sources[index]!;
      return (
        Exit.isFailure(source)
          ? Effect.failCause(source.cause)
          : verifyProject(project, selectedBackend, source.value, shared)
      ).pipe(
        Effect.flatMap((result) =>
          decode(
            ProjectSummary,
            {
              ...identity,
              status: "passed",
              elapsedMs: result.elapsedMs,
              timings: result.timings,
              runId: result.runId,
              directory: result.directory,
              engineProfiles: result.engine.map(
                (proof) => proof.request.profile,
              ),
            },
            "verification summary",
          ),
        ),
        Effect.catchTag("ProjectVerificationError", (error) =>
          decode(
            ProjectSummary,
            {
              ...identity,
              status: "failed",
              elapsedMs: error.elapsedMs,
              timings: error.timings,
              runId: error.runId,
              directory: error.directory,
              error: error.message,
            },
            "failed verification summary",
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterrupts(cause))
              return yield* Effect.failCause(cause);
            return yield* decode(
              ProjectSummary,
              {
                ...identity,
                elapsedMs: null,
                timings: [],
                status: "prerequisite-failed",
                error: Cause.pretty(cause),
              },
              "verification prerequisite failure",
            );
          }),
        ),
        Effect.tap((summary) =>
          Option.isSome(progress)
            ? progress.value.complete(summary)
            : Effect.void,
        ),
      );
    });
    return yield* decode(
      VerificationReport,
      {
        elapsedMs: performance.now() - started,
        status: rows.every((row) => row.status === "passed")
          ? "passed"
          : "failed",
        projects: rows,
      },
      "verification report",
    );
  });
}

function verifyProject(
  project: ResolvedProject,
  backend: typeof Backend.Type,
  source: typeof SourceSeal.Type,
  shared: {
    quality: ReturnType<typeof runQuality>;
    toolTests: ReturnType<typeof runBunTests>;
    used: Set<typeof Phase.Type>;
  },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      workspace = yield* resolveWorkspace(project.repoRoot);
    const run = yield* newRun(project, "verify"),
      start = performance.now(),
      startedAt = new Date().toISOString();
    const logs = yield* createLog(join(run.directory, "logs"), run.runId);
    const progress = yield* Effect.serviceOption(VerificationProgress);
    let phase: typeof Phase.Type = "toolchain";
    const completed: (typeof Phase.Type)[] = [];
    const timings: (typeof PhaseTiming.Type)[] = [];
    const identity = () => ({
      schema: 2 as const,
      runId: run.runId,
      mod: source.mod,
      directory: run.directory,
      ownerPid: process.pid,
      source,
      capabilities: project.capabilities,
      startedAt,
      elapsedMs: performance.now() - start,
      phase,
      completed: [...completed],
      timings: [...timings],
    });
    const persist = (
      value:
        | typeof ProjectVerification.Type
        | typeof ProjectVerificationFailure.Type
        | typeof ProjectVerificationRunning.Type,
    ) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(
          join(run.directory, "verify.json.part"),
          JSON.stringify(value, null, 2) + "\n",
        );
        yield* fs.rename(
          join(run.directory, "verify.json.part"),
          join(run.directory, "verify.json"),
        );
        if (Option.isSome(progress)) yield* progress.value.update(value);
      });
    const running = () =>
      Effect.gen(function* () {
        yield* persist(
          yield* decode(
            ProjectVerificationRunning,
            { ...identity(), status: "running" },
            "running verification",
          ),
        );
      });
    const event = (
      status: typeof PhaseEvent.Type.status,
      runs: readonly string[],
      timing: typeof PhaseTiming.Type | null = null,
    ) =>
      Effect.gen(function* () {
        const value = yield* decode(
          PhaseEvent,
          { event: "verification-phase", phase, status, runs, timing },
          "verification phase event",
        );
        yield* logs.append("lifecycle", JSON.stringify(value) + "\n", {
          event: value.event,
        });
      });
    const step = <A, E, R>(
      name: typeof Phase.Type,
      operation: Effect.Effect<A, E, R>,
      runs: (value: A) => readonly string[] = () => [],
      workspaceCheck = false,
    ) =>
      Effect.gen(function* () {
        phase = name;
        yield* running();
        yield* event("started", []);
        const execution = workspaceCheck
          ? shared.used.has(name)
            ? "shared"
            : "workspace"
          : "project";
        if (workspaceCheck) shared.used.add(name);
        const phaseStarted = performance.now();
        const result = yield* operation.pipe(
          Effect.provideService(ParentRun, {
            runId: run.runId,
            phase: name,
            onChild: (child) =>
              logs.append("lifecycle", JSON.stringify(child) + "\n", {
                event: child.event,
              }),
          }),
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const timing = yield* decode(
                PhaseTiming,
                {
                  phase: name,
                  status: Exit.isSuccess(exit)
                    ? "passed"
                    : Cause.hasInterruptsOnly(exit.cause)
                      ? "cancelled"
                      : "failed",
                  elapsedMs: performance.now() - phaseStarted,
                  execution,
                  runs: Exit.isSuccess(exit) ? runs(exit.value) : [],
                },
                "verification phase timing",
              );
              timings.push(timing);
              yield* event(
                timing.status === "passed" ? "completed" : timing.status,
                timing.runs,
                timing,
              );
            }),
          ),
        );
        completed.push(name);
        yield* running();
        return result;
      });
    yield* running();
    yield* announceRun({
      ...run,
      kind: "verification",
      backend: "native",
      startedAt,
    });
    const operation = Effect.gen(function* () {
      const toolchain = yield* step(
        "toolchain",
        checkToolchain(project),
        (value) => Object.values(value.native).map((proof) => proof.runId),
      );
      const whitespace = yield* step(
        "whitespace",
        withWorkspaceSnapshot(workspace, (snapshot) =>
          Effect.gen(function* () {
            const result = yield* runCommand(
              project,
              "whitespace",
              [
                "git",
                "--literal-pathspecs",
                "-c",
                "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol",
                "diff",
                "--cached",
                "--check",
                snapshot.head,
                "--",
                ...Object.keys(source.files),
              ],
              { env: snapshot.env },
            );
            return yield* decode(
              CommandCheck,
              { status: "passed", runId: result.run.runId },
              "whitespace result",
            );
          }),
        ),
        (value) => [value.runId],
      );
      const audit = yield* step("audit", auditProject(project));
      const lint = yield* step("lint", lintProject(project), (value) =>
        value.status === "passed"
          ? [
              value.runId,
              ...(value.toolFixtures === null
                ? []
                : [value.toolFixtures.runId]),
            ]
          : [],
      );
      const models = yield* step("models", testModels(project), (value) =>
        value.status === "passed" ? [value.runId] : [],
      );
      const types = yield* step("types", typecheckProject(project), (value) =>
        value.status === "passed" ? [value.runId] : [],
      );
      const quality = yield* step(
        "quality",
        shared.quality,
        (value) => [value.runId],
        true,
      );
      // Include the entire toolkit suite: migration must not hide unported legacy regressions.
      const toolTests = yield* step(
        "tool-tests",
        shared.toolTests,
        (value) => [value.runId],
        true,
      );
      const artifact = yield* step("package", packageProject(project));
      const engine = yield* step(
        "engine",
        Effect.forEach(project.capabilities.profiles, (profile) =>
          runEngineSuite(project, profile, { artifact, backend }),
        ),
        (values) => values.map((value) => value.request.runId),
      );
      yield* step(
        "seal",
        sourceSeal(project).pipe(
          Effect.flatMap((actual) => verifySourceSeal(source, actual)),
        ),
      );
      if (
        project.capabilities.verification === "engine" &&
        engine.length !== project.capabilities.profiles.length
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: run.runId,
            message: "Declared engine verification is incomplete",
          }),
        );
      const result = yield* decode(
        ProjectVerification,
        {
          ...identity(),
          status: "passed",
          checks: {
            toolchain,
            whitespace,
            quality,
            audit,
            lint,
            types,
            toolTests,
            models,
          },
          artifact,
          engine,
        },
        "project verification",
      );
      return result;
    });
    return yield* operation.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const sealed = yield* logs.seal.pipe(Effect.exit);
          if (Exit.isSuccess(exit) && Exit.isSuccess(sealed)) {
            yield* persist(exit.value);
            return;
          }
          const failure = yield* decode(
            ProjectVerificationFailure,
            {
              ...identity(),
              status:
                Exit.isSuccess(sealed) &&
                Exit.isFailure(exit) &&
                Cause.hasInterruptsOnly(exit.cause)
                  ? "cancelled"
                  : "failed",
              error: [
                Exit.isFailure(exit) ? Cause.pretty(exit.cause) : undefined,
                Exit.isFailure(sealed) ? Cause.pretty(sealed.cause) : undefined,
              ]
                .filter((value) => value !== undefined)
                .join("\n"),
            },
            "failed verification",
          );
          yield* persist(failure);
          if (Exit.isFailure(sealed))
            return yield* Effect.failCause(sealed.cause);
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (Cause.hasInterrupts(cause)) return yield* Effect.failCause(cause);
          return yield* Effect.fail(
            new ProjectVerificationError({
              runId: run.runId,
              directory: run.directory,
              mod: project.info.name,
              phase,
              message: Cause.pretty(cause),
              elapsedMs: performance.now() - start,
              timings: [...timings],
            }),
          );
        }),
      ),
    );
  });
}
