import { Effect, Schema } from "effect";
import { LogChannel, LogMetadata, LogPage, readLogPage } from "./logs.ts";
import { decode } from "./projects.ts";
import type { ExecutionContext } from "./projects.ts";
import { readRun, RunProgress } from "./run-status.ts";
export const LogFilter = Schema.Struct({
  channel: Schema.optionalKey(LogChannel),
  event: LogMetadata.fields.event,
});
export const LogRead = Schema.Struct({
  schema: Schema.Literal(1),
  event: Schema.Literal("log-page"),
  filter: LogFilter,
  page: LogPage,
  scanned: Schema.Int,
  run: RunProgress,
  complete: Schema.Boolean,
});
export function readLogView(
  context: ExecutionContext,
  cursorInput: unknown,
  filterInput: unknown,
  limit = 64,
) {
  return Effect.gen(function* () {
    const cursor = yield* decode(
      LogPage.fields.cursor,
      cursorInput,
      "log cursor",
    );
    const filter = yield* decode(LogFilter, filterInput, "log filter");
    const run = yield* readRun(context, cursor.runId);
    const page = yield* readLogPage(run.log.directory, cursor, limit);
    const terminal = [
      "passed",
      "failed",
      "cancelled",
      "interrupted",
      "inconclusive",
      "regressed",
    ].includes(run.status);
    const drained =
      page.complete ||
      (!run.log.closed &&
        page.records.length < limit &&
        page.cursor.sequence >= run.log.lastSequence);
    return yield* decode(
      LogRead,
      {
        schema: 1,
        event: "log-page",
        filter,
        page: {
          ...page,
          records: page.records.filter(
            (record) =>
              (filter.channel === undefined ||
                record.channel === filter.channel) &&
              (filter.event === undefined ||
                record.metadata.event === filter.event),
          ),
        },
        scanned: page.records.length,
        run: {
          runId: run.record.run,
          status: run.status,
          owner: run.owner,
          phase: run.phase,
          proof: run.proof,
          logsClosed: run.log.closed,
        },
        complete: terminal && drained,
      },
      "qualified log view",
    );
  });
}
export function formatLogView(view: typeof LogRead.Type) {
  const lines: string[] = [];
  for (const record of view.page.records) {
    const source = record.metadata;
    lines.push(
      `[${new Date(record.capturedAtUnixMs).toISOString()}] ${record.channel} #${record.sequence}${source.event === undefined ? "" : " event=" + source.event}${source.tick === undefined ? "" : " tick=" + source.tick}${source.file === undefined ? "" : " file=" + source.file.identity + " opened=" + source.file.openedPath}\n${record.text}`,
    );
  }
  lines.push(
    `cursor ${view.page.cursor.runId}/${view.page.cursor.sequence}; run=${view.run.status}; proof=${view.run.proof}; logs=${view.run.logsClosed ? "sealed" : "open"}; partial-record=${view.page.partialRecord}; complete=${view.complete}`,
  );
  // Preserve raw evidence; only the terminal-facing view escapes control sequences.
  return lines.join("\n").replace(
    // oxlint-disable-next-line no-control-regex -- Escape terminal controls in the display, without altering persisted diagnostics.
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
