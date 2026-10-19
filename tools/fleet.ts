import { Effect, Schema } from "effect";
import { isDeepStrictEqual } from "node:util";
import { AbsolutePath, ModIdentity, Sha256 } from "./contracts.ts";
import { Backend } from "./backend.ts";
import { RunId } from "./logs.ts";
import {
  BoundaryError,
  Capabilities,
  decode,
  Info,
  Profile,
  readJSON,
} from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { inspectPrepared, PreparedStatus } from "./release.ts";
import { listRuns, RunList, RunProgress } from "./run-status.ts";
import { sourceSeal, verifySourceSeal } from "./source.ts";
import { ProjectVerificationState } from "./verification.ts";

const Command = Schema.Array(Schema.NonEmptyString);
const LatestVerification = Schema.Struct({
  runId: RunId,
  receipt: AbsolutePath,
  status: RunProgress.fields.status,
  source: Sha256,
  phase: RunProgress.fields.phase,
  completed: Schema.Array(Schema.NonEmptyString),
  error: Schema.NullOr(Schema.String),
  profiles: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        profile: Profile,
        backend: Backend,
        runId: RunId,
        passed: Schema.Int,
        excluded: Schema.Int,
      }),
    ),
  ),
});
const FleetRow = Schema.Struct({
  mod: ModIdentity,
  title: Schema.NonEmptyString,
  engineTarget: Info.fields.factorio_version,
  capabilities: Capabilities,
  source: Sha256,
  verification: Schema.Struct({
    freshness: Schema.Literals(["current", "stale", "missing", "unknown"]),
    latestReadable: Schema.NullOr(LatestVerification),
    history: Schema.Struct({
      status: RunList.fields.status,
      issues: RunList.fields.issues,
      issueCount: RunList.fields.issueCount,
      unregisteredDirectories: RunList.fields.unregisteredDirectories,
    }),
  }),
  prepared: PreparedStatus,
  portal: Schema.Struct({ state: Schema.Literal("unknown"), refresh: Command }),
  blockers: Schema.Array(Schema.NonEmptyString),
  commands: Schema.Array(Command),
});
const FleetStatus = Schema.Struct({
  schema: Schema.Literal(1),
  observedAt: Schema.NonEmptyString,
  projects: Schema.Array(FleetRow),
});

export function fleetStatus(projects: readonly ResolvedProject[]) {
  return Effect.gen(function* () {
    const observedAt = new Date().toISOString();
    const rows = [];
    for (const project of projects) {
      const source = yield* sourceSeal(project);
      const history = yield* listRuns([project], {
        active: false,
        kind: "verification",
        limit: 1,
      });
      const latest = history.runs[0];
      let latestReadable: typeof LatestVerification.Type | null = null;
      if (latest !== undefined) {
        if (latest.receipt === null)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message: "Registered verification has no receipt",
            }),
          );
        const receipt = yield* readJSON(
          ProjectVerificationState,
          latest.receipt,
        );
        if (
          receipt.runId !== latest.record.run ||
          receipt.source.sha256 !== latest.source
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message: "Verification identity changed during fleet observation",
            }),
          );
        if (
          receipt.source.sha256 === source.sha256 &&
          !isDeepStrictEqual(receipt.capabilities, project.capabilities)
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message:
                "Current verification disagrees with declared capabilities",
            }),
          );
        if (
          receipt.status === "passed" &&
          !isDeepStrictEqual(
            receipt.engine.map((suite) => suite.request.profile).sort(),
            [...receipt.capabilities.profiles].sort(),
          )
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message:
                "Passed verification does not cover its declared engine profiles",
            }),
          );
        latestReadable = {
          runId: receipt.runId,
          receipt: latest.receipt,
          status: latest.status,
          source: receipt.source.sha256,
          phase: latest.phase,
          completed: receipt.completed,
          error: "error" in receipt ? receipt.error : null,
          profiles:
            receipt.status === "passed"
              ? receipt.engine.map((suite) => ({
                  profile: suite.request.profile,
                  backend:
                    suite.engine.docker === undefined ? "native" : "docker",
                  runId: suite.request.runId,
                  passed: suite.summary.passed,
                  excluded: suite.summary.skipped,
                }))
              : null,
        };
      }
      const freshness =
        history.issueCount > 0
          ? "unknown"
          : latestReadable === null
            ? history.unregisteredDirectories > 0
              ? "unknown"
              : "missing"
            : latestReadable.source === source.sha256
              ? "current"
              : "stale";
      const { status: prepared } = yield* inspectPrepared(project);
      yield* verifySourceSeal(source, yield* sourceSeal(project));
      const blockers: string[] = [];
      const commands: string[][] = [];
      if (history.issueCount > 0)
        blockers.push(
          "Run history contains unreadable records; the latest readable receipt may not be the latest attempt",
        );
      if (freshness !== "current")
        blockers.push(`Verification evidence is ${freshness}`);
      if (latestReadable !== null && latestReadable.status !== "passed")
        blockers.push(
          `Latest readable verification is ${latestReadable.status} at ${latestReadable.phase}`,
        );
      if (prepared.state !== "ready")
        blockers.push(`Prepared release is ${prepared.state}`);
      if (freshness !== "current" || latestReadable?.status !== "passed")
        commands.push(["mise", "run", "verify", "--", project.info.name]);
      if (latestReadable !== null)
        commands.push([
          "mise",
          "run",
          "logs",
          "--",
          project.info.name,
          "--run",
          latestReadable.runId,
          "--follow",
        ]);
      if (history.status === "partial")
        commands.push([
          "mise",
          "run",
          "runs",
          "--",
          project.info.name,
          "--kind",
          "verification",
        ]);
      if (prepared.state !== "ready")
        commands.push([
          "mise",
          "run",
          "release-prepare",
          "--",
          project.info.name,
        ]);
      rows.push({
        mod: { name: project.info.name, version: project.info.version },
        title: project.info.title,
        engineTarget: project.info.factorio_version,
        capabilities: project.capabilities,
        source: source.sha256,
        verification: {
          freshness,
          latestReadable,
          history: {
            status: history.status,
            issues: history.issues,
            issueCount: history.issueCount,
            unregisteredDirectories: history.unregisteredDirectories,
          },
        },
        prepared,
        portal: {
          state: "unknown",
          refresh: ["mise", "run", "release-status", "--", project.info.name],
        },
        blockers,
        commands,
      });
    }
    return yield* decode(
      FleetStatus,
      { schema: 1, observedAt, projects: rows },
      "offline fleet status",
    );
  });
}
