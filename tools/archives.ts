import { Effect, Schema } from "effect";
import { once } from "node:events";
import {
  close,
  createReadStream,
  createWriteStream,
  fstatSync,
  open,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, unlink } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";
import { fromFdPromise } from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { ZipFile as ZipWriter } from "yazl";
import { ArchiveIdentity } from "./contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  RelativePath,
} from "./projects.ts";

const Limit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
export const ArchiveLimits = Schema.Struct({
  compressedBytes: Limit,
  expandedBytes: Limit,
  entryBytes: Limit,
  entries: Limit,
  nameBytes: Limit,
});
export const archiveLimits: typeof ArchiveLimits.Type = {
  compressedBytes: 256 * 1024 * 1024,
  expandedBytes: 512 * 1024 * 1024,
  entryBytes: 512 * 1024 * 1024,
  entries: 10000,
  nameBytes: 1024,
};
const ZipInput = Schema.Struct({
  archive: ArchiveIdentity.fields.archive,
  sha256: Schema.optionalKey(ArchiveIdentity.fields.sha256),
  limits: Schema.optionalKey(ArchiveLimits),
});
export const ArchiveMember = Schema.Struct({
  name: RelativePath,
  directory: Schema.Boolean,
  size: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ),
});
const openFd = promisify(open);
const closeFd = promisify(close);
function failure(boundary: string, error: unknown) {
  return error instanceof BoundaryError
    ? error
    : new BoundaryError({ boundary, message: String(error) });
}
/** Interruption aborts native I/O and waits for its cleanup before releasing scope. */
export function archiveIO<A>(
  boundary: string,
  run: (signal: AbortSignal) => Promise<A>,
) {
  return Effect.suspend(() => {
    let completion: Promise<A> | undefined;
    return Effect.tryPromise({
      try: (signal) => {
        completion = run(signal);
        return completion;
      },
      catch: (error) => failure(boundary, error),
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          // The Effect already owns the result/error; the finalizer only joins cleanup.
          await completion?.then(
            () => undefined,
            () => undefined,
          );
        }),
      ),
    );
  });
}
function unchanged(before: BigIntStats, after: BigIntStats) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}
/** Reject aliases in the archive namespace, including file/directory collisions. */
export function archiveNames() {
  const names = new Map<string, boolean>(),
    parents = new Set<string>();
  return (name: string, directory: boolean) => {
    Schema.decodeUnknownSync(RelativePath)(name);
    if (names.has(name) || (!directory && parents.has(name)))
      throw new Error(`Duplicate or conflicting archive member: ${name}`);
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      if (names.get(parent) === false)
        throw new Error(`Archive member is beneath a file: ${name}`);
      parents.add(parent);
    }
    names.set(name, directory);
  };
}
interface OpenZip {
  fd: number;
  zip: ZipFile;
  before: BigIntStats;
}
interface ZipReader {
  readonly members: readonly (typeof ArchiveMember.Type)[];
  readonly sha256: string;
  readonly stat: BigIntStats;
  read(name: string, maxBytes: number): Effect.Effect<Buffer, BoundaryError>;
  hash(name: string): Effect.Effect<string, BoundaryError>;
  readonly verifyAll: Effect.Effect<void, BoundaryError>;
}
async function inventory(
  resource: OpenZip,
  limits: typeof ArchiveLimits.Type,
  signal: AbortSignal,
) {
  const entries = new Map<string, Entry>(),
    members: (typeof ArchiveMember.Type)[] = [],
    admit = archiveNames();
  let expanded = 0;
  if (resource.zip.entryCount > limits.entries)
    throw new Error("Archive exceeds entry limit");
  for await (const entry of resource.zip.eachEntry()) {
    signal.throwIfAborted();
    const directory = entry.fileName.endsWith("/");
    const member = Schema.decodeUnknownSync(ArchiveMember)({
      name: directory ? entry.fileName.slice(0, -1) : entry.fileName,
      directory,
      size: entry.uncompressedSize,
    });
    if (
      entry.fileNameRaw.length > limits.nameBytes ||
      Buffer.byteLength(entry.fileName) > limits.nameBytes ||
      members.length >= limits.entries
    )
      throw new Error("Archive exceeds name or entry limits");
    admit(member.name, directory);
    const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
    if (kind !== 0 && kind !== (directory ? 0o040000 : 0o100000))
      throw new Error(`Unsupported archive member type: ${member.name}`);
    if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod))
      throw new Error(
        `Unsupported archive encryption/compression: ${member.name}`,
      );
    if (directory && member.size !== 0)
      throw new Error(`Directory contains payload: ${member.name}`);
    expanded += member.size;
    if (member.size > limits.entryBytes || expanded > limits.expandedBytes)
      throw new Error("Archive exceeds expanded-size limits");
    if ((entry.generalPurposeBitFlag & 0x800) !== 0)
      new TextDecoder("utf-8", { fatal: true }).decode(entry.fileNameRaw);
    const local = await resource.zip.readLocalFileHeaderPromise(entry);
    if (
      !local.fileName.equals(entry.fileNameRaw) ||
      local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
      local.compressionMethod !== entry.compressionMethod
    )
      throw new Error(`Local and central ZIP headers disagree: ${member.name}`);
    if (
      (entry.generalPurposeBitFlag & 8) === 0 &&
      (local.crc32 !== entry.crc32 ||
        (local.compressedSize !== 0xffffffff &&
          local.compressedSize !== entry.compressedSize) ||
        (local.uncompressedSize !== 0xffffffff &&
          local.uncompressedSize !== entry.uncompressedSize))
    )
      throw new Error(`Local ZIP sizes/checksum disagree: ${member.name}`);
    entries.set(member.name, entry);
    members.push(member);
  }
  return { entries, members };
}
/** One descriptor owns hashing, inventory and reads; scoped release waits for close. */
export function withZip<A, E, R>(
  input: typeof ZipInput.Type,
  use: (archive: ZipReader) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const request = yield* decode(ZipInput, input, "ZIP input"),
      limits = request.limits ?? archiveLimits;
    yield* assertCanonicalPath(request.archive);
    return yield* Effect.acquireUseRelease(
      archiveIO(request.archive, async () => {
        const fd = await openFd(request.archive, "r");
        try {
          const before = fstatSync(fd, { bigint: true });
          if (
            !before.isFile() ||
            before.size < 22n ||
            before.size > BigInt(limits.compressedBytes)
          )
            throw new Error(
              "Archive exceeds compressed-size limit or is not a ZIP file",
            );
          const zip = await fromFdPromise(fd, {
            autoClose: false,
            strictFileNames: true,
            validateEntrySizes: true,
          });
          return { fd, zip, before };
        } catch (error) {
          await closeFd(fd);
          throw error;
        }
      }),
      (resource) =>
        Effect.gen(function* () {
          const sha256 = yield* archiveIO(request.archive, async (signal) => {
            const hash = new Bun.CryptoHasher("sha256");
            let bytes = 0;
            await pipeline(
              createReadStream(request.archive, {
                fd: resource.fd,
                autoClose: false,
                start: 0,
                end: Number(resource.before.size) - 1,
              }),
              new Writable({
                write(chunk: Buffer, _encoding, done) {
                  bytes += chunk.length;
                  hash.update(chunk);
                  done();
                },
              }),
              { signal },
            );
            if (BigInt(bytes) !== resource.before.size)
              throw new Error("Archive changed while hashing");
            const digest = hash.digest("hex");
            if (request.sha256 !== undefined && digest !== request.sha256)
              throw new Error("Archive differs from the requested checksum");
            return digest;
          });
          const { entries, members } = yield* archiveIO(
            request.archive,
            (signal) => inventory(resource, limits, signal),
          );
          const verified = new Set<string>();
          function consume(
            name: string,
            mode: "read" | "hash" | "verify",
            maxBytes: number,
          ) {
            return archiveIO(name, async (signal) => {
              const entry = entries.get(name);
              if (entry === undefined)
                throw new Error(`Missing archive member: ${name}`);
              if (
                !Number.isSafeInteger(maxBytes) ||
                maxBytes < 0 ||
                entry.uncompressedSize > maxBytes
              )
                throw new Error(`Archive member exceeds read limit: ${name}`);
              const data =
                mode === "read"
                  ? Buffer.allocUnsafe(entry.uncompressedSize)
                  : undefined;
              const hash =
                mode === "hash" ? new Bun.CryptoHasher("sha256") : undefined;
              let bytes = 0,
                crc = 0;
              const source = await resource.zip.openReadStreamPromise(entry);
              await pipeline(
                source,
                new Writable({
                  write(chunk: Buffer, _encoding, done) {
                    if (
                      bytes + chunk.length > entry.uncompressedSize ||
                      bytes + chunk.length > maxBytes
                    ) {
                      done(new Error("Archive expanded-byte limit exceeded"));
                      return;
                    }
                    data?.set(chunk, bytes);
                    hash?.update(chunk);
                    crc = crc32(chunk, crc);
                    bytes += chunk.length;
                    done();
                  },
                }),
                { signal },
              );
              if (bytes !== entry.uncompressedSize || crc !== entry.crc32)
                throw new Error(`Archive CRC or size mismatch: ${name}`);
              verified.add(name);
              return { data, digest: hash?.digest("hex") };
            });
          }
          const reader: ZipReader = {
            members,
            sha256,
            stat: resource.before,
            read: (name, maxBytes) =>
              consume(name, "read", maxBytes).pipe(
                Effect.map((result) => result.data!),
              ),
            hash: (name) =>
              consume(name, "hash", limits.entryBytes).pipe(
                Effect.map((result) => result.digest!),
              ),
            verifyAll: Effect.forEach(
              members,
              (member) =>
                verified.has(member.name)
                  ? Effect.void
                  : consume(member.name, "verify", limits.entryBytes),
              { discard: true },
            ),
          };
          const result = yield* use(reader);
          yield* archiveIO(request.archive, async () => {
            if (
              !unchanged(
                resource.before,
                fstatSync(resource.fd, { bigint: true }),
              ) ||
              !unchanged(
                resource.before,
                await lstat(request.archive, { bigint: true }),
              )
            )
              throw new Error("Archive changed during reading");
          });
          return result;
        }),
      ({ zip }) =>
        archiveIO(request.archive, async () => {
          const closed = once(zip, "close");
          zip.close();
          await closed;
        }).pipe(Effect.orDie),
    );
  });
}
const WriteMember = Schema.Union([
  Schema.Struct({ name: RelativePath, path: ArchiveIdentity.fields.archive }),
  Schema.Struct({ name: RelativePath, bytes: Schema.instanceOf(Uint8Array) }),
]);
const WriteRequest = Schema.Struct({
  output: ArchiveIdentity.fields.archive,
  members: Schema.Array(WriteMember).check(Schema.isMinLength(1)),
});
/** Write an exclusive destination; callers publish their verified stage atomically. */
export function writeZip(
  output: string,
  members: readonly (typeof WriteMember.Type)[],
) {
  return Effect.gen(function* () {
    const request = yield* decode(
        WriteRequest,
        { output, members },
        "ZIP output",
      ),
      admit = archiveNames();
    const sizes = new Map<string, number>(),
      snapshots: { path: string; stat: BigIntStats }[] = [];
    let total = 0;
    if (request.members.length > archiveLimits.entries)
      return yield* Effect.fail(
        failure(output, "ZIP output exceeds entry limit"),
      );
    yield* assertCanonicalPath(request.output);
    for (const member of request.members) {
      yield* Effect.try({
        try: () => admit(member.name, false),
        catch: (error) => failure(member.name, error),
      });
      let size: number;
      if ("path" in member) {
        yield* assertCanonicalPath(member.path);
        const stat = yield* archiveIO(member.path, () =>
          lstat(member.path, { bigint: true }),
        );
        if (!stat.isFile())
          return yield* Effect.fail(
            failure(member.path, "ZIP source is not a regular file"),
          );
        size = Number(stat.size);
        snapshots.push({ path: member.path, stat });
      } else size = member.bytes.byteLength;
      total += size;
      if (
        Buffer.byteLength(member.name) > archiveLimits.nameBytes ||
        size > archiveLimits.entryBytes ||
        total > archiveLimits.expandedBytes
      )
        return yield* Effect.fail(
          failure(output, "ZIP output exceeds member/name/expanded limits"),
        );
      sizes.set(member.name, size);
    }
    yield* Effect.acquireUseRelease(
      archiveIO(request.output, async () => {
        const destination = createWriteStream(request.output, { flags: "wx" });
        const closed = new Promise<void>((resolve) =>
          destination.once("close", resolve),
        );
        try {
          const [fd] = await once(destination, "open");
          if (typeof fd !== "number")
            throw new Error("ZIP output did not open a file descriptor");
          return {
            destination,
            closed,
            stat: fstatSync(fd, { bigint: true }),
            complete: false,
          };
        } catch (error) {
          destination.destroy();
          await closed;
          throw error;
        }
      }),
      (output) =>
        archiveIO(request.output, async (signal) => {
          const writer = new ZipWriter(),
            source = writer.outputStream,
            active = new Set<Readable>();
          try {
            if (!(source instanceof Readable))
              throw new Error(
                "ZIP writer does not expose a Node-readable stream",
              );
            writer.on("error", (error: Error) => source.destroy(error));
            const transfer = pipeline(source, output.destination, { signal });
            try {
              const options = {
                mtime: new Date(1980, 0, 1),
                mode: 0o100644,
                forceDosTimestamp: true,
                compressionLevel: 9,
              };
              for (const member of [...request.members].sort((a, b) =>
                a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
              )) {
                if ("bytes" in member)
                  writer.addBuffer(
                    Buffer.from(
                      member.bytes.buffer,
                      member.bytes.byteOffset,
                      member.bytes.byteLength,
                    ),
                    member.name,
                    options,
                  );
                else
                  writer.addReadStreamLazy(
                    member.name,
                    { ...options, size: sizes.get(member.name)! },
                    (ready) => {
                      const stream = createReadStream(member.path, {
                        signal,
                        start: 0,
                        end: Math.max(0, sizes.get(member.name)! - 1),
                      });
                      active.add(stream);
                      stream.once("close", () => active.delete(stream));
                      stream.on("error", (error) => source.destroy(error));
                      ready(null, stream);
                    },
                  );
              }
              writer.end();
            } catch (error) {
              source.destroy(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
            await transfer;
            for (const snapshot of snapshots)
              if (
                !unchanged(
                  snapshot.stat,
                  await lstat(snapshot.path, { bigint: true }),
                )
              )
                throw new Error(
                  `ZIP source changed during writing: ${snapshot.path}`,
                );
            if (
              (await lstat(request.output)).size > archiveLimits.compressedBytes
            )
              throw new Error("ZIP output exceeds compressed-size limit");
            output.complete = true;
          } finally {
            for (const stream of active) stream.destroy();
            if (source instanceof Readable) source.destroy();
          }
        }),
      (output) =>
        archiveIO(request.output, async () => {
          output.destination.destroy();
          await output.closed;
          const current = await lstat(request.output, { bigint: true });
          if (
            current.dev !== output.stat.dev ||
            current.ino !== output.stat.ino
          )
            throw new Error("ZIP output was replaced during writing");
          if (!output.complete) await unlink(request.output);
        }).pipe(Effect.orDie),
    );
  });
}
