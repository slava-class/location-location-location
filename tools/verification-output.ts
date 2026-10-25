import { Cause, Console, Effect, Exit } from "effect";
import type { Backend } from "./backend.ts";
import type { ResolvedProject } from "./projects.ts";
import { RunAnnouncements } from "./runs.ts";
import { Phase, VerificationProgress, verifyProjects } from "./verification.ts";
import type { ProjectVerificationState } from "./verification.ts";
import type { AffectedSelection } from "./affected.ts";

/** OMP job widgets consume stderr; stdout remains the authoritative JSON summary. */
export function runReportedVerification(
  projects: readonly ResolvedProject[],
  backend: typeof Backend.Type,
  workspaceQuality: boolean,
  selection: typeof AffectedSelection.Type | null = null,
) {
  return Effect.gen(function* () {
    const states = new Map<string, typeof ProjectVerificationState.Type>();
    const finished = new Map<
      string,
      "passed" | "failed" | "prerequisite-failed" | "blocked"
    >();
    const phaseTotal = (phase: typeof Phase.Type) => {
      let elapsedMs = 0;
      for (const state of states.values())
        for (const timing of state.timings)
          if (timing.phase === phase && timing.execution !== "shared")
            elapsedMs += timing.elapsedMs;
      return Console.error(
        `Phase ${phase}: ${(elapsedMs / 1000).toFixed(2)} s total`,
      );
    };
    let lastOverall = "";
    const overall = (status: "running" | "passed" | "failed" | "cancelled") =>
      Effect.gen(function* () {
        let phasesCompleted = 0;
        for (const state of states.values())
          phasesCompleted += state.completed.length;
        let productsPassed = 0;
        let productsBlocked = 0;
        for (const result of finished.values()) {
          if (result === "passed") productsPassed++;
          if (result === "blocked") productsBlocked++;
        }
        const identity = `${status}:${phasesCompleted}:${finished.size}:${productsPassed}:${productsBlocked}`;
        if (identity === lastOverall) return;
        lastOverall = identity;
        yield* Console.error(
          `Verification ${status} | phases ${phasesCompleted}/${projects.length * Phase.literals.length} | products ${finished.size}/${projects.length} | passed ${productsPassed} | failed ${finished.size - productsPassed - productsBlocked}${productsBlocked ? ` | blocked ${productsBlocked}` : ""}`,
        );
      });
    yield* overall("running");
    yield* Console.error(
      "Phase totals count completed executions; shared checks count once.",
    );
    for (const phase of Phase.literals) yield* phaseTotal(phase);
    return yield* verifyProjects(
      projects,
      backend,
      workspaceQuality,
      selection,
    ).pipe(
      Effect.provideService(RunAnnouncements, {
        write: (record) =>
          record.kind === "verification"
            ? Console.error(
                `Logs ${record.mod}: mise run logs -- ${record.mod} --run ${record.run} --follow`,
              )
            : Effect.void,
      }),
      Effect.provideService(VerificationProgress, {
        update: (state) =>
          Effect.gen(function* () {
            const mod = state.mod.name;
            const previous = states.get(mod);
            states.set(mod, state);
            if (
              previous?.status === state.status &&
              previous.phase === state.phase &&
              previous.completed.length === state.completed.length &&
              previous.timings.length === state.timings.length
            )
              return;
            if (
              state.status === "running" &&
              state.timings.at(-1)?.phase !== state.phase
            )
              yield* Console.error(`Checking ${state.phase}: ${mod}`);
            for (
              let index = previous?.timings.length ?? 0;
              index < state.timings.length;
              index++
            ) {
              const timing = state.timings[index]!;
              if (timing.execution === "shared") {
                yield* Console.error(
                  `Reused ${timing.phase}: ${mod} (${timing.status})`,
                );
              } else {
                yield* phaseTotal(timing.phase);
              }
              if (timing.status !== "passed")
                yield* Console.error(
                  `Phase ${timing.phase} ${timing.status}: ${mod}`,
                );
            }
            if (state.status !== "running")
              yield* Console.error(`Product ${mod}: ${state.status}`);
            yield* overall("running");
          }),
        complete: (summary) =>
          Effect.gen(function* () {
            finished.set(summary.mod.name, summary.status);
            if (summary.status === "blocked")
              yield* Console.error(
                `Blocked ${summary.mod.name}: workspace ${summary.blockedBy.phase} failed in ${summary.blockedBy.mod.name} (${summary.blockedBy.runId}); ${summary.notRun.length} phases not run`,
              );
            if (states.get(summary.mod.name)?.status !== summary.status)
              yield* Console.error(
                `Product ${summary.mod.name}: ${summary.status}`,
              );
            yield* overall("running");
          }),
      }),
      Effect.onExit((exit) =>
        overall(
          Exit.isSuccess(exit)
            ? exit.value.status
            : Cause.hasInterruptsOnly(exit.cause)
              ? "cancelled"
              : "failed",
        ),
      ),
      Effect.tap((report) => Console.log(JSON.stringify(report, null, 2))),
    );
  });
}
