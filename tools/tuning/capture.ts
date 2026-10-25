import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import {
  BoundaryError,
  decode,
  Locale,
  readJSON,
  RelativePath,
} from "../projects.ts";
import { AbsolutePath, Sha256 } from "../contracts.ts";
import { evaluate } from "../engine-session.ts";
import type { EngineSession } from "../engine-session.ts";
import { readLogCursor, readLogPage, RunId } from "../logs.ts";
import { ImageEvidence, verifyPNG } from "../images.ts";
import { Revision, StudioManifest, Values } from "./contracts.ts";
import { readStudioState } from "./session.ts";
import { verifyNativeGraphics } from "../native-graphics.ts";

const CaptureId = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 2147483646 }),
);
const Ticket = Schema.Struct({
  schema: Schema.Literal(1),
  session: RunId,
  revision: Revision,
  captureId: CaptureId,
  path: RelativePath,
});
const Observation = Schema.Struct({
  schema: Schema.Literal(1),
  session: RunId,
  revision: Revision,
  captureId: CaptureId,
  phaseTick: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  scale: Schema.Number,
  locale: Locale,
});
export const CaptureEvidence = Schema.Struct({
  schema: Schema.Literal(1),
  kind: Schema.Literal("proxy-preview"),
  ticket: Ticket,
  observed: Observation,
  image: ImageEvidence,
  sourceSha256: Sha256,
  artifactSha256: Sha256,
  descriptorSha256: Sha256,
  values: Values,
  active: Schema.Boolean,
  clientRun: RunId,
  graphics: Schema.Literal("extreme"),
  path: AbsolutePath,
});
const fault = (session: string, message: string) =>
  new BoundaryError({ boundary: session, message });

export function captureStudio(
  client: EngineSession["client"],
  manifest: typeof StudioManifest.Type,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const state = yield* readStudioState(client, manifest);
    const logs = join(manifest.clientDirectory, "logs");
    let cursor = yield* readLogCursor(logs, manifest.clientRun);
    const ticket = yield* evaluate(
      client,
      `return remote.call("modkit-studio","capture",${state.revision})`,
      Ticket,
    );
    if (
      ticket.session !== manifest.session ||
      ticket.revision !== state.revision ||
      ticket.path !== `modkit-studio/captures/${ticket.captureId}.png`
    )
      return yield* Effect.fail(
        fault(manifest.session, "Foreign capture ticket or path"),
      );
    const marker = `MODKIT_STUDIO_CAPTURE:${manifest.session}:${ticket.captureId}\n`;
    const deadline = performance.now() + 30000;
    let window = "",
      flushed = false;
    while (performance.now() < deadline && !flushed) {
      const page = yield* readLogPage(logs, cursor);
      cursor = page.cursor;
      for (const event of page.records) {
        if (event.channel !== "stdout") continue;
        window = (window + event.text).slice(-4096);
        if (window.includes(marker)) {
          flushed = true;
          break;
        }
      }
      if (page.complete && !flushed)
        return yield* Effect.fail(
          fault(
            manifest.session,
            "Graphical client ended before capture flush",
          ),
        );
      if (!flushed) yield* Effect.sleep(50);
    }
    if (!flushed)
      return yield* Effect.fail(
        fault(
          manifest.session,
          "Client capture flush deadline exceeded; capture was not retried",
        ),
      );
    const path = join(manifest.clientDirectory, "script-output", ticket.path);
    const observed = yield* readJSON(Observation, path + ".json");
    if (
      observed.session !== ticket.session ||
      observed.captureId !== ticket.captureId ||
      observed.revision !== ticket.revision ||
      observed.width !== manifest.viewport.width ||
      observed.height !== manifest.viewport.height ||
      observed.scale !== manifest.viewport.scale ||
      observed.locale !== manifest.viewport.locale
    )
      return yield* Effect.fail(
        fault(
          manifest.session,
          `Capture identity or actual viewport differs: ${JSON.stringify(observed)}`,
        ),
      );
    const image = yield* verifyPNG(
      path,
      manifest.viewport.width,
      manifest.viewport.height,
    );
    const log = yield* fs.readFileString(
      join(manifest.clientDirectory, "factorio-current.log"),
    );
    yield* verifyNativeGraphics(
      log,
      {
        width: manifest.viewport.width,
        height: manifest.viewport.height,
        graphics: "extreme",
      },
      manifest.session,
    );
    const evidence = yield* decode(
      CaptureEvidence,
      {
        schema: 1,
        kind: "proxy-preview",
        ticket,
        observed,
        image,
        sourceSha256: manifest.sourceSha256,
        artifactSha256: manifest.artifactSha256,
        descriptorSha256: manifest.descriptorSha256,
        values: state.values,
        active: state.active,
        clientRun: manifest.clientRun,
        graphics: "extreme",
        path,
      },
      "studio capture evidence",
    );
    yield* fs.writeFileString(
      path + ".evidence.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
    return evidence;
  });
}
