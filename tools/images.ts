import { Effect, FileSystem, Schema } from "effect";
import { crc32 } from "node:zlib";
import { ElapsedMs, Sha256 } from "./contracts.ts";
import { BoundaryError, decode } from "./projects.ts";

export const ImageEvidence = Schema.Struct({
  format: Schema.Literal("png"),
  width: Schema.Int,
  height: Schema.Int,
  bytes: Schema.Int,
  sha256: Sha256,
  decodedSha256: Sha256,
  decodeMs: ElapsedMs,
  bun: Schema.NonEmptyString,
});
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function decodePNG(input: Uint8Array, width: number, height: number) {
  return Effect.gen(function* () {
    const started = performance.now();
    const result = yield* Effect.tryPromise({
      try: async () => {
        const bytes = Buffer.from(
          input.buffer,
          input.byteOffset,
          input.byteLength,
        );
        if (!bytes.subarray(0, 8).equals(signature))
          throw new Error("Not a PNG");
        let offset = 8,
          ended = false;
        // Bun's full decoder accepts a missing IEND. Require complete framing and CRCs
        // as well as a terminal pixel decode; metadata alone is not capture evidence.
        while (offset < bytes.length) {
          if (bytes.length - offset < 12)
            throw new Error("Truncated PNG chunk");
          const length = bytes.readUInt32BE(offset),
            end = offset + 12 + length;
          if (end > bytes.length)
            throw new Error("Truncated PNG chunk payload");
          const type = bytes.toString("ascii", offset + 4, offset + 8);
          if (
            crc32(bytes.subarray(offset + 4, end - 4)) !==
            bytes.readUInt32BE(end - 4)
          )
            throw new Error("PNG chunk checksum differs");
          if (type === "IEND") {
            if (length !== 0 || end !== bytes.length)
              throw new Error("Invalid PNG end or trailing data");
            ended = true;
          }
          offset = end;
        }
        if (!ended) throw new Error("Missing PNG end");
        const image = new Bun.Image(bytes, { maxPixels: width * height });
        const metadata = await image.metadata();
        if (
          metadata.format !== "png" ||
          metadata.width !== width ||
          metadata.height !== height
        )
          throw new Error("Capture format or dimensions differ");
        const pixelsEncoded = await image.png().bytes();
        return {
          format: "png",
          width,
          height,
          bytes: bytes.byteLength,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
          decodedSha256: new Bun.CryptoHasher("sha256")
            .update(pixelsEncoded)
            .digest("hex"),
          decodeMs: performance.now() - started,
          bun: Bun.version,
        };
      },
      catch: (error) =>
        new BoundaryError({
          boundary: "PNG capture",
          message:
            error instanceof Error ? error.message : "Image decode failed",
        }),
    });
    return yield* decode(ImageEvidence, result, "decoded image evidence");
  });
}
export function verifyPNG(path: string, width: number, height: number) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(path);
    if (stat.type !== "File" || Number(stat.size) > 64 * 1024 * 1024)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message: "Capture is not a regular PNG within the 64 MiB limit",
        }),
      );
    return yield* decodePNG(yield* fs.readFile(path), width, height);
  });
}
