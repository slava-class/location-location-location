import { Effect, Schema } from "effect";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import {
  ArchiveLimits,
  ArchiveMember,
  archiveIO,
  archiveLimits,
  archiveNames,
} from "./archives.ts";
import { PinnedFile } from "./contracts.ts";
import { assertCanonicalPath, decode, RelativePath } from "./projects.ts";

const TarInput = Schema.Struct({
  pin: PinnedFile,
  root: Schema.optionalKey(RelativePath),
  limits: Schema.optionalKey(ArchiveLimits),
});
/** Inspect every original entry before returning selected bytes; never extract paths. */
export function readTar(
  input: typeof TarInput.Type,
  select: (member: typeof ArchiveMember.Type) => boolean,
) {
  return Effect.gen(function* () {
    const request = yield* decode(TarInput, input, "tar input"),
      limits = request.limits ?? archiveLimits;
    yield* assertCanonicalPath(request.pin.path);
    return yield* archiveIO(request.pin.path, async (signal) => {
      const before = await lstat(request.pin.path, { bigint: true });
      if (
        !before.isFile() ||
        before.size >
          BigInt(Math.min(request.pin.maxBytes, limits.compressedBytes))
      )
        throw new Error(
          "Tar archive exceeds compressed-size limit or is not a regular file",
        );
      const source = createReadStream(request.pin.path),
        decoder = createGunzip(),
        parser = extract();
      const hash = new Bun.CryptoHasher("sha256"),
        admit = archiveNames();
      const files = new Map<string, Buffer>();
      let compressed = 0,
        expanded = 0,
        count = 0,
        total = 0,
        rootSeen = false;
      const inputLimit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          compressed += chunk.length;
          if (
            compressed > request.pin.maxBytes ||
            compressed > limits.compressedBytes
          ) {
            done(new Error("Tar input grew beyond its limit"));
            return;
          }
          hash.update(chunk);
          done(null, chunk);
        },
      });
      const outputLimit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          expanded += chunk.length;
          if (expanded > limits.expandedBytes) {
            done(new Error("Tar decompression exceeds expanded-size limit"));
            return;
          }
          done(null, chunk);
        },
      });
      const transfer = pipeline(
        source,
        inputLimit,
        decoder,
        outputLimit,
        parser,
        { signal },
      );
      const consume = (async () => {
        for await (const stream of parser) {
          signal.throwIfAborted();
          const header = stream.header;
          if (
            ++count > limits.entries ||
            Buffer.byteLength(header.name) > limits.nameBytes
          )
            throw new Error("Tar exceeds entry/name limits");
          if (header.type !== "file" && header.type !== "directory")
            throw new Error(`Unsupported tar member type: ${header.name}`);
          // POSIX tar's explicit root directory and leading ./ are syntax, not traversal repair.
          if (header.name === "." || header.name === "./") {
            if (
              rootSeen ||
              header.type !== "directory" ||
              header.size !== 0 ||
              request.root !== undefined
            )
              throw new Error("Unexpected or duplicate tar root");
            rootSeen = true;
            for await (const bytes of stream)
              if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 0)
                throw new Error("Tar root contains payload");
            continue;
          }
          const name = header.name.startsWith("./")
            ? header.name.slice(2)
            : header.name;
          const directory = header.type === "directory";
          const member = Schema.decodeUnknownSync(ArchiveMember)({
            name: directory && name.endsWith("/") ? name.slice(0, -1) : name,
            directory,
            size: header.size,
          });
          admit(member.name, directory);
          if (
            request.root !== undefined &&
            (member.name === request.root
              ? !directory
              : !member.name.startsWith(request.root + "/"))
          )
            throw new Error(
              `Tar member is outside its declared root: ${member.name}`,
            );
          total += member.size;
          if (
            (directory && member.size !== 0) ||
            member.size > limits.entryBytes ||
            total > limits.expandedBytes
          )
            throw new Error("Tar member exceeds payload limits");
          const data =
            !directory && select(member)
              ? Buffer.allocUnsafe(member.size)
              : undefined;
          let offset = 0;
          for await (const chunk of stream) {
            if (
              !(chunk instanceof Uint8Array) ||
              offset + chunk.byteLength > member.size
            )
              throw new Error("Tar body exceeds its declaration");
            data?.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (offset !== member.size) throw new Error("Truncated tar member");
          if (data !== undefined) files.set(member.name, data);
        }
      })();
      try {
        await Promise.all([transfer, consume]);
      } finally {
        source.destroy();
        inputLimit.destroy();
        decoder.destroy();
        outputLimit.destroy();
        parser.destroy();
      }
      if (
        hash.digest("hex") !== request.pin.sha256 ||
        BigInt(compressed) !== before.size
      )
        throw new Error("Tar archive differs from its pin");
      const after = await lstat(request.pin.path, { bigint: true });
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      )
        throw new Error("Tar archive changed during reading");
      return files;
    });
  });
}
