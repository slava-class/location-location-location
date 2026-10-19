import { expect, test } from "bun:test";
import { Effect } from "effect";
import { crc32, deflateSync } from "node:zlib";
import { decodePNG } from "./images.ts";
import { BoundaryError } from "./projects.ts";

function chunk(type: string, data: Uint8Array) {
  const output = Buffer.alloc(data.byteLength + 12);
  output.writeUInt32BE(data.byteLength, 0);
  output.write(type, 4, "ascii");
  output.set(data, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
  return output;
}
function redPixel() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
test("a complete PNG is fully decoded at its declared capture dimensions", async () => {
  const result = await Effect.runPromise(decodePNG(redPixel(), 1, 1));
  expect({
    width: result.width,
    height: result.height,
    format: result.format,
  }).toEqual({ width: 1, height: 1, format: "png" });
  expect(Effect.runPromise(decodePNG(redPixel(), 2, 1))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});
test("missing end chunks, partial writes and CRC damage never become capture evidence", async () => {
  const valid = redPixel(),
    damaged = Buffer.from(valid);
  damaged[45] = damaged[45]! ^ 1;
  for (const bytes of [
    valid.subarray(0, -12),
    valid.subarray(0, 33),
    valid.subarray(0, -1),
    damaged,
    Buffer.concat([valid, Buffer.from([0])]),
  ])
    expect(Effect.runPromise(decodePNG(bytes, 1, 1))).rejects.toBeInstanceOf(
      BoundaryError,
    );
});
test("valid PNG framing cannot disguise an invalid compressed pixel stream", async () => {
  const valid = redPixel();
  const broken = Buffer.concat([
    valid.subarray(0, 33),
    chunk("IDAT", Buffer.from([1, 2, 3, 4])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  expect(Effect.runPromise(decodePNG(broken, 1, 1))).rejects.toBeInstanceOf(
    BoundaryError,
  );
});
