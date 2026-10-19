import assert from "node:assert/strict";
import { Effect, Exit, Schema } from "effect";
import {
  evaluate,
  saveEngineSession,
} from "../../../../../tools/engine-session.ts";
import { captureStudio } from "../../../../../tools/tuning/capture.ts";
import { makePreset } from "../../../../../tools/tuning/source.ts";
import { defineStudioVerification } from "../../../../../tools/tuning/verification.ts";
import {
  panelStudio,
  readStudioState,
  updateStudio,
  withStudioReload,
} from "../../../../../tools/tuning/session.ts";

export default defineStudioVerification((live) =>
  Effect.gen(function* () {
    const { client } = live.engineSession;
    const { manifest } = live;
    const baseline = yield* readStudioState(client, manifest);
    assert.equal(baseline.observations.overlays, 5);
    assert.equal(baseline.observations.foreignVisible, true);
    assert.equal(baseline.observations.foreignProductVisible, 5);
    const first = yield* captureStudio(client, manifest);
    const values = {
      ...baseline.values,
      red: 10,
      green: 35,
      blue: 95,
      mouth_scale: 1.25,
      span_scale: 0.75,
      span_limit: 2,
    };
    const candidate = yield* updateStudio(
      client,
      manifest,
      "set",
      baseline.revision,
      values,
    );
    assert.deepEqual(candidate.values, values);
    assert.ok(
      Exit.isFailure(
        yield* Effect.exit(
          updateStudio(client, manifest, "reset", baseline.revision),
        ),
      ),
    );
    assert.equal(
      (yield* readStudioState(client, manifest)).revision,
      candidate.revision,
    );
    const second = yield* captureStudio(client, manifest);
    assert.ok(
      Exit.isFailure(
        yield* Effect.exit(
          makePreset(
            live.studio,
            manifest.session,
            candidate.revision,
            candidate.values,
            "source",
          ),
        ),
      ),
    );
    for (let repeat = 0; repeat < 3; repeat++) {
      yield* panelStudio(client, manifest, "close");
      const reopened = yield* panelStudio(client, manifest, "open");
      assert.deepEqual(reopened.values, candidate.values);
      assert.equal(reopened.revision, candidate.revision);
      assert.equal(
        reopened.observations.overlays,
        baseline.observations.overlays,
      );
    }
    const undone = yield* updateStudio(
      client,
      manifest,
      "undo",
      candidate.revision,
    );
    assert.deepEqual(undone.values, baseline.values);
    const stopped = yield* updateStudio(
      client,
      manifest,
      "stop",
      undone.revision,
    );
    assert.equal(stopped.observations.overlays, 0);
    assert.equal(stopped.observations.productVisible, 5);
    assert.equal(stopped.observations.foreignProductVisible, 5);
    assert.equal(stopped.observations.foreignVisible, true);
    const reset = yield* updateStudio(
      client,
      manifest,
      "reset",
      stopped.revision,
    );
    assert.deepEqual(reset.values, baseline.values);
    const save = yield* saveEngineSession(
      live.engineSession,
      "studio-roundtrip",
    );
    assert.ok(
      Exit.isFailure(
        yield* Effect.exit(
          saveEngineSession(live.engineSession, "studio-roundtrip"),
        ),
      ),
      "Existing saves must not be overwritten",
    );
    const reload = yield* withStudioReload(live, save, (session) =>
      Effect.gen(function* () {
        const state = yield* readStudioState(session.client, manifest);
        assert.equal(state.revision, reset.revision);
        assert.deepEqual(state.values, reset.values);
        assert.equal(state.observations.overlays, 5);
        assert.equal(state.observations.foreignVisible, true);
        const cleaned = yield* updateStudio(
          session.client,
          manifest,
          "stop",
          state.revision,
        );
        assert.equal(cleaned.observations.overlays, 0);
        assert.equal(cleaned.observations.foreignVisible, true);
        return state;
      }),
    );
    yield* evaluate(
      client,
      'local s=assert(game.surfaces["modkit-warning-studio"]); local e=assert(s.find_entity("underground-belt",{-1.5,-4.5})); assert(e.destroy{raise_destroy=true}); return true',
      Schema.Literal(true),
    );
    const deadline = performance.now() + 5000;
    let invalidated = yield* readStudioState(client, manifest);
    while (
      invalidated.observations.overlays !== 0 &&
      performance.now() < deadline
    ) {
      yield* Effect.sleep(50);
      invalidated = yield* readStudioState(client, manifest);
    }
    assert.equal(
      invalidated.observations.overlays,
      0,
      "Destroyed fixture mouths must not retain proxy rendering",
    );
    assert.equal(invalidated.observations.foreignProductVisible, 5);
    assert.equal(invalidated.observations.foreignVisible, true);
    const final = yield* updateStudio(
      client,
      manifest,
      "discard",
      invalidated.revision,
    );
    assert.equal(final.discardRequested, true);
    assert.equal(final.observations.overlays, 0);
    return {
      checks: [
        "actual viewport readiness",
        "baseline and candidate captures",
        "revision conflict rejection",
        "preview-only promotion rejection",
        "repeated close/reopen",
        "undo and reset",
        "scoped restoration",
        "correlated save and overwrite refusal",
        "fresh-process state and resource restoration",
        "invalidated entity cleanup",
        "foreign rendering preservation",
        "discard",
      ],
      captures: [first, second],
      save,
      reloaded: reload.result,
      reloadRun: reload.run,
      final,
    };
  }),
);
