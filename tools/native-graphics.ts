import { Effect, Schema } from "effect";
import { GraphicsPreset } from "./engine.ts";
import type { OwnedProcess } from "./process.ts";
import { BoundaryError, decode } from "./projects.ts";

const Size = Schema.Struct({
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
});
const Expected = Schema.Struct({ ...Size.fields, graphics: GraphicsPreset });
const Observed = Schema.Struct({
  window: Size,
  drawable: Size,
  graphics: GraphicsPreset,
});
const windowLine =
  "\\[Size\\] Window: ([0-9]+)x([0-9]+), Drawable: ([0-9]+)x([0-9]+)";
const presetLine = "Forced graphics settings preset: ([^\\r\\n]+)";

function lastLine(text: string, pattern: string) {
  let last: RegExpExecArray | undefined;
  for (const match of text.matchAll(new RegExp(pattern + "(?:\\r?\\n|$)", "g")))
    last = match;
  return last;
}

/** Startup is a prerequisite, not a replacement for player and capture evidence. */
export function verifyNativeGraphics(
  text: string,
  input: typeof Expected.Type,
  boundary: string,
) {
  return Effect.gen(function* () {
    const expected = yield* decode(Expected, input, "native graphics request");
    const window = lastLine(text, windowLine);
    const preset = lastLine(text, presetLine);
    if (window === undefined || preset === undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary,
          message:
            "Native window, drawable or forced graphics preset evidence is absent",
        }),
      );
    const observed = yield* decode(
      Observed,
      {
        window: { width: Number(window[1]), height: Number(window[2]) },
        drawable: { width: Number(window[3]), height: Number(window[4]) },
        graphics: preset[1],
      },
      boundary,
    );
    if (
      observed.window.width !== expected.width ||
      observed.window.height !== expected.height ||
      observed.drawable.width !== expected.width ||
      observed.drawable.height !== expected.height ||
      observed.graphics !== expected.graphics
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary,
          message: `Native graphics mismatch: expected window and drawable ${expected.width}x${expected.height}, preset=${expected.graphics}; observed window=${observed.window.width}x${observed.window.height}, drawable=${observed.drawable.width}x${observed.drawable.height}, preset=${observed.graphics}. The viewport must fit the display's usable desktop area; capture requirements are not relaxed.`,
        }),
      );
    return observed;
  });
}

/** Factorio reports these dimensions before sprite loading or player readiness. */
export function waitForNativeGraphics(
  process: OwnedProcess,
  expected: typeof Expected.Type,
  timeoutMs: number,
) {
  return Effect.gen(function* () {
    // Require a complete line: a partial height must not look like a clamped window.
    const window = yield* process.waitForText(
      new RegExp(windowLine + "\\r?\\n"),
      "native window geometry",
      timeoutMs,
    );
    const preset = yield* process.waitForText(
      new RegExp(presetLine + "\\r?\\n"),
      "native graphics preset",
      timeoutMs,
    );
    return yield* verifyNativeGraphics(
      window + preset,
      expected,
      process.directory,
    );
  });
}
