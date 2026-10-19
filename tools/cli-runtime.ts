import { BunRuntime } from "@effect/platform-bun";
import { Cause, Console, Effect } from "effect";

// Keep stdout available for JSON/SARIF, including when a command fails.
export function runCLI<A, E>(program: Effect.Effect<A, E>) {
  BunRuntime.runMain(
    program.pipe(
      Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
    ),
    { disableErrorReporting: true },
  );
}
