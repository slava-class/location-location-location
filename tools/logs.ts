import { Effect, FileSystem, Schema, Semaphore } from "effect";
import { join } from "node:path";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  prepareOutputDirectory,
  readJSON,
} from "./projects.ts";
import { AbsolutePath, ElapsedMs } from "./contracts.ts";

export const RunId = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/u,
  ),
);
const Sequence = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
export const LogChannel = Schema.Literals([
  "stdout",
  "stderr",
  "game",
  "lifecycle",
]);
export const LogMetadata = Schema.Struct({
  event: Schema.optionalKey(
    Schema.NonEmptyString.check(Schema.isMaxLength(128)),
  ),
  tick: Schema.optionalKey(Sequence),
  file: Schema.optionalKey(
    Schema.Struct({
      openedPath: AbsolutePath.check(Schema.isMaxLength(4096)),
      identity: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
    }),
  ),
});
const LogRecord = Schema.Struct({
  schema: Schema.Literal(2),
  runId: RunId,
  sequence: Sequence,
  elapsedMs: ElapsedMs,
  capturedAtUnixMs: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 8640000000000000 }),
  ),
  channel: LogChannel,
  metadata: LogMetadata,
  text: Schema.String,
});
export type LogEvent = typeof LogRecord.Type;
const LogCursor = Schema.Struct({ runId: RunId, sequence: Sequence });
const LogManifest = Schema.Struct({
  schema: Schema.Literal(2),
  runId: RunId,
  recordsPerSegment: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 1024 }),
  ),
  maxTextBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 65536 }),
  ),
  maxBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 1073741824 }),
  ),
});
const LogWatermark = Schema.Struct({
  schema: Schema.Literal(2),
  runId: RunId,
  lastSequence: Sequence,
  bytes: Sequence,
});
export const LogPage = Schema.Struct({
  records: Schema.Array(LogRecord),
  cursor: LogCursor,
  complete: Schema.Boolean,
  partialRecord: Schema.Boolean,
});
const encode = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"],
) =>
  JSON.stringify(
    Schema.encodeSync(schema, { onExcessProperty: "error" })(value),
  ) + "\n";
const segmentName = (index: number) =>
  `events-${String(index).padStart(8, "0")}.jsonl`;

export function createLog(
  directory: string,
  runId: string,
  options = {
    recordsPerSegment: 128,
    maxTextBytes: 16384,
    maxBytes: 268435456,
  },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const manifest = yield* decode(
      LogManifest,
      { schema: 2, runId, ...options },
      "log manifest",
    );
    yield* prepareOutputDirectory(directory);
    yield* fs.writeFileString(join(directory, "writer.lock"), runId, {
      flag: "wx",
    });
    yield* fs.writeFileString(
      join(directory, "log.json.part"),
      encode(LogManifest, manifest),
      { flag: "wx" },
    );
    yield* fs.writeFileString(
      join(directory, "log-progress.json"),
      encode(LogWatermark, { schema: 2, runId, lastSequence: 0, bytes: 0 }),
      { flag: "wx" },
    );
    yield* fs.rename(
      join(directory, "log.json.part"),
      join(directory, "log.json"),
    );
    const semaphore = yield* Semaphore.make(1);
    const start = performance.now();
    let sequence = 0,
      bytes = 0,
      sealed = false;
    const append = (
      channel: LogEvent["channel"],
      text: string,
      metadata: typeof LogMetadata.Type = {},
    ) =>
      Effect.suspend(() => {
        const capturedAtUnixMs = Date.now();
        const elapsedMs = performance.now() - start;
        return Semaphore.withPermits(
          semaphore,
          1,
        )(
          Effect.gen(function* () {
            if (sealed)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: runId,
                  message: "Cannot append to sealed log",
                }),
              );
            if (Buffer.byteLength(text) > manifest.maxTextBytes)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: runId,
                  message: "Log chunk exceeds bounded record size",
                }),
              );
            const record = yield* decode(
              LogRecord,
              {
                schema: 2,
                runId,
                sequence: sequence + 1,
                elapsedMs,
                capturedAtUnixMs,
                metadata,
                channel,
                text,
              },
              "log record",
            );
            const serialized = encode(LogRecord, record),
              size = Buffer.byteLength(serialized);
            if (bytes + size > manifest.maxBytes)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: runId,
                  message:
                    "Run log capacity exhausted; evidence recording failed",
                }),
              );
            const path = join(
              directory,
              segmentName(Math.floor(sequence / manifest.recordsPerSegment)),
            );
            yield* fs.writeFileString(path, serialized, { flag: "a" });
            sequence++;
            bytes += size;
            if ((sequence - 1) % manifest.recordsPerSegment === 0) {
              yield* fs.writeFileString(
                join(directory, "log-progress.json.part"),
                encode(LogWatermark, {
                  schema: 2,
                  runId,
                  lastSequence: sequence,
                  bytes,
                }),
                { flag: "wx" },
              );
              yield* fs.rename(
                join(directory, "log-progress.json.part"),
                join(directory, "log-progress.json"),
              );
            }
            return record;
          }),
        );
      });
    const seal = Semaphore.withPermits(
      semaphore,
      1,
    )(
      Effect.gen(function* () {
        if (sealed)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: runId,
              message: "Run log is already sealed",
            }),
          );
        yield* fs.writeFileString(
          join(directory, "log-final.json.part"),
          encode(LogWatermark, {
            schema: 2,
            runId,
            lastSequence: sequence,
            bytes,
          }),
          { flag: "wx" },
        );
        yield* fs.rename(
          join(directory, "log-final.json.part"),
          join(directory, "log-final.json"),
        );
        sealed = true;
      }),
    );
    return { append, seal, manifest };
  });
}

export function readLogState(directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const manifestPath = join(directory, "log.json");
    const finalPath = join(directory, "log-final.json");
    const progressPath = join(directory, "log-progress.json");
    for (const path of [manifestPath, finalPath, progressPath])
      yield* assertCanonicalPath(path);
    const manifest = yield* readJSON(LogManifest, manifestPath);
    const final = (yield* fs.exists(finalPath))
      ? yield* readJSON(LogWatermark, finalPath)
      : undefined;
    const watermark = final ?? (yield* readJSON(LogWatermark, progressPath));
    if (
      watermark.runId !== manifest.runId ||
      watermark.bytes > manifest.maxBytes
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: directory,
          message: "Log watermark has a foreign identity or exceeds capacity",
        }),
      );
    return { manifest, watermark, final };
  });
}
/** The progress watermark is segment-granular, not the current live cursor. */
export function readLogCursor(directory: string, runId: string) {
  return Effect.gen(function* () {
    const { watermark } = yield* readLogState(directory);
    let cursor = { runId, sequence: watermark.lastSequence };
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const page = yield* readLogPage(directory, cursor, 256);
      cursor = page.cursor;
      if (page.records.length < 256 || page.complete) return cursor;
    }
    return yield* Effect.fail(
      new BoundaryError({
        boundary: directory,
        message: "Live log cursor did not settle within its read deadline",
      }),
    );
  });
}

export function readLogPage(directory: string, input: unknown, limit = 128) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cursor = yield* decode(LogCursor, input, "log cursor");
    const count = yield* decode(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 })),
      limit,
      "log page size",
    );
    const { manifest, watermark, final } = yield* readLogState(directory);
    if (cursor.runId !== manifest.runId)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: directory,
          message: "Cursor belongs to a different run",
        }),
      );
    if (
      final &&
      (final.runId !== manifest.runId || cursor.sequence > final.lastSequence)
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: directory,
          message: "Cursor is beyond the sealed run or final identity differs",
        }),
      );
    let partialRecord = false;
    const readRows = (path: string) =>
      Effect.gen(function* () {
        yield* assertCanonicalPath(path);
        const info = yield* fs.stat(path);
        if (
          Number(info.size) >
          manifest.recordsPerSegment * (manifest.maxTextBytes * 6 + 32768)
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Log segment exceeds its bounded format",
            }),
          );
        const rows = (yield* fs.readFileString(path)).split("\n");
        const partial = rows.pop();
        if (partial) partialRecord = true;
        if (final && partial)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Sealed log has an incomplete record",
            }),
          );
        if (rows.length > manifest.recordsPerSegment)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Log segment contains excess records",
            }),
          );
        return rows;
      });
    const readRecord = (row: string, path: string, sequence: number) =>
      Effect.gen(function* () {
        const value = yield* Effect.try({
          try: (): unknown => JSON.parse(row),
          catch: () =>
            new BoundaryError({
              boundary: path,
              message: "Malformed completed log record",
            }),
        });
        const record = yield* decode(LogRecord, value, path);
        if (record.runId !== manifest.runId || record.sequence !== sequence)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Log identity or sequence gap",
            }),
          );
        if (Buffer.byteLength(record.text) > manifest.maxTextBytes)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Log record exceeds declared text limit",
            }),
          );
        return record;
      });
    if (cursor.sequence > 0) {
      const previous = join(
        directory,
        segmentName(
          Math.floor((cursor.sequence - 1) / manifest.recordsPerSegment),
        ),
      );
      if (!(yield* fs.exists(previous)))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: previous,
            message: "Cursor refers to an unwritten or missing segment",
          }),
        );
      const row = (yield* readRows(previous))[
        (cursor.sequence - 1) % manifest.recordsPerSegment
      ];
      if (row === undefined)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: previous,
            message: "Cursor skips unwritten records",
          }),
        );
      yield* readRecord(row, previous, cursor.sequence);
    }
    const records: LogEvent[] = [];
    let next = cursor.sequence;
    while (records.length < count) {
      const index = Math.floor(next / manifest.recordsPerSegment);
      const path = join(directory, segmentName(index));
      if (!(yield* fs.exists(path))) {
        if (next < watermark.lastSequence)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message:
                "Missing committed log segment; cursor continuity cannot be proved",
            }),
          );
        break;
      }
      const rows = yield* readRows(path);
      const offset = next % manifest.recordsPerSegment;
      if (offset > rows.length)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message: "Cursor skips unwritten records",
          }),
        );
      for (const row of rows.slice(offset)) {
        const record = yield* readRecord(row, path, next + 1);
        records.push(record);
        next++;
        if (records.length === count) break;
      }
      if (rows.length < manifest.recordsPerSegment) {
        if (records.length < count && next < watermark.lastSequence)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message:
                "Truncated committed log segment; cursor continuity cannot be proved",
            }),
          );
        break;
      }
    }
    return yield* decode(
      LogPage,
      {
        records,
        cursor: { runId: manifest.runId, sequence: next },
        complete: final !== undefined && next === final.lastSequence,
        partialRecord,
      },
      "log page",
    );
  });
}
