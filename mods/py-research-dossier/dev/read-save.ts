import { Effect } from "effect";
import { inflateSync } from "node:zlib";
import { AbsolutePath } from "../../../tools/contracts.ts";
import { withZip } from "../../../tools/archives.ts";
import { BoundaryError, decode } from "../../../tools/projects.ts";
import { SaveReadback } from "./contracts.ts";

const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const chunkLimit = 16 * 1024 * 1024;
const levelLimit = 144 * 1024 * 1024;
const scriptLimit = 128 * 1024 * 1024;
function requireLayout(condition: boolean, message: string): asserts condition {
  if (!condition)
    throw new BoundaryError({ boundary: "Factorio save format", message });
}
function incomplete(message: string) {
  return { _tag: "Incomplete" as const, message };
}
function requireVersion(bytes: Buffer, label: string) {
  requireLayout(
    bytes.length >= 8 &&
      bytes.readUInt16LE(0) === 2 &&
      bytes.readUInt16LE(2) === 1 &&
      bytes.readUInt16LE(4) === 21 &&
      bytes.readUInt16LE(6) === 11,
    `Unsupported ${label} layout; expected Factorio 2.1.21-11`,
  );
}
function uint(bytes: Buffer, offset: number): [number, number] {
  const value = bytes.readUInt8(offset++);
  return value === 255
    ? [bytes.readUInt32LE(offset), offset + 4]
    : [value, offset];
}
function text(
  bytes: Buffer,
  offset: number,
  maximum = bytes.length,
): [string, number] {
  const [size, start] = uint(bytes, offset);
  requireLayout(
    size <= maximum && start + size <= bytes.length,
    "Invalid or truncated saved string",
  );
  try {
    return [
      textDecoder.decode(bytes.subarray(start, start + size)),
      start + size,
    ];
  } catch {
    throw new BoundaryError({
      boundary: "Factorio save format",
      message: "Invalid UTF-8 saved string",
    });
  }
}
function prototypeTable(data: Buffer, kind: string) {
  const marker = Buffer.concat([Buffer.from([kind.length]), Buffer.from(kind)]);
  let result:
    | { offset: number; end: number; names: Map<number, string> }
    | undefined;
  for (let start = 0; ;) {
    const position = data.indexOf(marker, start);
    if (position < 0) break;
    start = position + 1;
    let candidate: typeof result;
    try {
      let offset = position + marker.length;
      const count = data.readUInt16LE(offset);
      offset += 2;
      if (count === 0 || count === 65535) continue;
      const names = new Map<number, string>(),
        seen = new Set<string>();
      for (let index = 0; index < count; index++) {
        let name: string;
        [name, offset] = text(data, offset, 499);
        const id = data.readUInt16LE(offset);
        offset += 2;
        requireLayout(
          name.length > 0 &&
            id >= 1 &&
            id <= count &&
            !names.has(id) &&
            !seen.has(name),
          "Invalid or duplicate prototype identity",
        );
        names.set(id, name);
        seen.add(name);
      }
      candidate = { offset: position, end: offset, names };
    } catch (error) {
      if (!(error instanceof BoundaryError || error instanceof RangeError))
        throw error;
      continue;
    }
    requireLayout(
      result === undefined,
      `${kind}: expected one validated prototype table, found multiple`,
    );
    result = candidate;
  }
  return result;
}
function decodeForces(data: Buffer) {
  if (data.length < 8) return incomplete("Truncated save version");
  requireVersion(data, "save");
  const technologies = prototypeTable(data, "technology"),
    recipes = prototypeTable(data, "recipe");
  if (technologies === undefined || recipes === undefined)
    return incomplete("Missing complete recipe/technology prototype tables");
  const headers: { offset: number; name: string }[] = [];
  for (const [id, name] of [
    [1, "player"],
    [2, "enemy"],
    [3, "neutral"],
  ] as const) {
    const marker = Buffer.concat([
      Buffer.from([id, name.length]),
      Buffer.from(name),
    ]);
    const offset = data.indexOf(
      marker,
      Math.max(technologies.end, recipes.end),
    );
    if (offset < 0) return incomplete(`Missing normal force ${name}`);
    requireLayout(
      data.indexOf(marker, offset + 1) < 0,
      `Ambiguous normal force ${name}`,
    );
    headers.push({ offset, name });
  }
  headers.sort((a, b) => a.offset - b.offset);
  type Force = (typeof SaveReadback.Type)["forces"][string];
  const forces = new Map<string, Force>(),
    marker = Buffer.allocUnsafe(2);
  marker.writeUInt16LE(recipes.names.size + 1);
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index]!,
      end = headers[index + 1]?.offset ?? data.length;
    let result: Force | undefined;
    for (let start = header.offset; ;) {
      const position = data.indexOf(marker, start);
      if (position < 0 || position + 2 > end) break;
      start = position + 1;
      const after = position + 2 + 8 * recipes.names.size;
      if (
        after + 2 >= end ||
        data.readUInt16LE(after) !== technologies.names.size + 1
      )
        continue;
      const enabledRecipes: string[] = [];
      let valid = true;
      for (let id = 1; id <= recipes.names.size; id++) {
        const flag = data[position + 6 + (id - 1) * 8]!;
        if (flag !== 0 && flag !== 1) {
          valid = false;
          break;
        }
        if (flag === 1) enabledRecipes.push(recipes.names.get(id)!);
      }
      if (!valid) continue;
      let candidate: Force;
      try {
        let offset = after + 2;
        const researchedTechnologies: string[] = [],
          triggers: { technology: string; kind: 0; progress: number }[] = [];
        for (let id = 1; id <= technologies.names.size; id++) {
          const prefix = data.readUInt16LE(offset),
            research = data.readUInt8(offset + 2),
            trigger = data.readUInt8(offset + 3);
          offset += 4;
          requireLayout(
            (prefix === 0 || prefix === 1) &&
              (research === 0 || research === 1) &&
              (trigger === 0 || trigger === 1),
            "Unsupported technology record",
          );
          const technology = technologies.names.get(id)!;
          if (research === 1) researchedTechnologies.push(technology);
          if (trigger === 1) {
            const kind = data.readUInt16LE(offset),
              progress = data.readUInt32LE(offset + 2);
            offset += 6;
            requireLayout(kind === 0, "Unsupported research trigger");
            triggers.push({ technology, kind, progress });
          }
        }
        requireLayout(
          offset <= end,
          "Technology vector crosses force boundary",
        );
        candidate = {
          recipeVectorOffset: position,
          technologyVectorOffset: after,
          technologyVectorEnd: offset,
          enabledRecipes,
          researchedTechnologies,
          triggers,
        };
      } catch (error) {
        if (!(error instanceof BoundaryError || error instanceof RangeError))
          throw error;
        continue;
      }
      requireLayout(
        result === undefined,
        `${header.name}: expected one validated adjacent recipe/research vector, found multiple`,
      );
      result = candidate;
    }
    if (result === undefined && index === headers.length - 1)
      return incomplete(
        `${header.name}: missing complete adjacent recipe/research vector`,
      );
    requireLayout(
      result !== undefined,
      `${header.name}: expected one validated adjacent recipe/research vector, found 0`,
    );
    forces.set(header.name, result);
  }
  return {
    _tag: "Complete" as const,
    value: {
      factorioVersion: "2.1.21-11",
      decompressedBytes: data.length,
      forces: Object.fromEntries(forces),
      prototypeMappings: {
        recipe: {
          offset: recipes.offset,
          end: recipes.end,
          count: recipes.names.size,
        },
        technology: {
          offset: technologies.offset,
          end: technologies.end,
          count: technologies.names.size,
        },
      },
      recipePrototypeNames: [...recipes.names.values()],
      technologyPrototypeNames: [...technologies.names.values()],
    },
  };
}
function savedModVersions(data: Buffer) {
  requireVersion(data, "script.dat");
  const count = data.readUInt32LE(9);
  let offset = 13,
    planner: Buffer | undefined;
  for (let index = 0; index < count; index++) {
    let name: string, size: number;
    [name, offset] = text(data, offset);
    [size, offset] = uint(data, offset);
    requireLayout(offset + size < data.length, "Truncated saved mod state");
    if (name === "mod-factoryplanner") {
      requireLayout(planner === undefined, "Duplicate Factory Planner state");
      planner = data.subarray(offset, offset + size);
    }
    offset += size + 1;
  }
  requireLayout(
    offset === data.length && planner !== undefined,
    "Expected complete Factory Planner framing",
  );
  requireVersion(planner, "Factory Planner state");
  const marker = Buffer.concat([
    Buffer.from([4, 14]),
    Buffer.from("installed_mods"),
    Buffer.from([5]),
  ]);
  const position = planner.indexOf(marker);
  requireLayout(
    position >= 0 && planner.indexOf(marker, position + 1) < 0,
    "Missing/ambiguous saved installed_mods",
  );
  let modCount: number;
  [modCount, offset] = uint(planner, position + marker.length);
  const mods = new Map<string, string>();
  for (let index = 0; index < modCount; index++) {
    requireLayout(
      planner.readUInt8(offset) === 4,
      "Expected saved mod-name string",
    );
    let name: string, version: string;
    [name, offset] = text(planner, offset + 1);
    requireLayout(
      planner.readUInt8(offset) === 4,
      "Expected saved mod-version string",
    );
    [version, offset] = text(planner, offset + 1);
    requireLayout(!mods.has(name), "Duplicate saved mod");
    mods.set(name, version);
  }
  return Object.fromEntries(mods);
}
function saveTimestamp(nanoseconds: bigint) {
  // Preserve the stored readback's floating-second, half-even microsecond format.
  const timestamp =
    Number(nanoseconds / 1_000_000_000n) +
    Number(nanoseconds % 1_000_000_000n) * 1e-9;
  let seconds = Math.floor(timestamp);
  const fraction = (timestamp - seconds) * 1_000_000,
    lower = Math.floor(fraction),
    remainder = fraction - lower;
  let micros =
    lower + (remainder > 0.5 || (remainder === 0.5 && lower % 2 !== 0) ? 1 : 0);
  if (micros === 1_000_000) {
    seconds++;
    micros = 0;
  }
  return (
    new Date(seconds * 1000).toISOString().slice(0, -5) +
    (micros === 0 ? "" : "." + String(micros).padStart(6, "0")) +
    "+00:00"
  );
}
/** Only the validated 2.1.21-11 / bounded force prefix / Factory Planner subset. */
export function readSavedProgress(input: string) {
  return Effect.gen(function* () {
    const save = yield* decode(AbsolutePath, input, "save path");
    return yield* withZip({ archive: save }, (zip) =>
      Effect.gen(function* () {
        const chunks: { name: string; index: number }[] = [];
        for (const member of zip.members) {
          const match = /(?:^|\/)level\.dat([0-9]+)$/.exec(member.name);
          if (!member.directory && match !== null)
            chunks.push({ name: member.name, index: Number(match[1]) });
        }
        chunks.sort((a, b) => a.index - b.index);
        if (
          chunks.length === 0 ||
          chunks.some((entry, index) => entry.index !== index)
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: save,
              message: "Missing or ambiguous level.dat chunks",
            }),
          );
        const forces = yield* Effect.gen(function* () {
          let data: Buffer = Buffer.alloc(0),
            length = 0,
            encodedBytes = 0,
            pending = "Missing saved force data";
          for (const chunk of chunks) {
            const bytes = yield* zip.read(chunk.name, chunkLimit);
            const result = yield* Effect.try({
              try: () => {
                encodedBytes += bytes.length;
                requireLayout(
                  encodedBytes <= levelLimit,
                  "Saved force prefix exceeds the 144 MiB encoded limit",
                );
                const part = inflateSync(bytes, {
                  maxOutputLength: chunkLimit,
                });
                const required = length + part.length;
                requireLayout(
                  required <= levelLimit,
                  "Saved force prefix exceeds the 144 MiB inflated limit",
                );
                if (required > data.length) {
                  const grown = Buffer.allocUnsafe(
                    Math.min(levelLimit, Math.max(required, data.length * 2)),
                  );
                  data.copy(grown, 0, 0, length);
                  data = grown;
                }
                part.copy(data, length);
                length = required;
                return decodeForces(data.subarray(0, length));
              },
              catch: (error) =>
                error instanceof BoundaryError
                  ? error
                  : new BoundaryError({
                      boundary: chunk.name,
                      message: String(error),
                    }),
            });
            if (result._tag === "Complete") return result.value;
            pending = result.message;
          }
          return yield* Effect.fail(
            new BoundaryError({
              boundary: save,
              message: `Incomplete saved force prefix after ${length} bytes: ${pending}`,
            }),
          );
        });
        const scripts = zip.members.filter(
          (member) => !member.directory && member.name.endsWith("/script.dat"),
        );
        if (scripts.length !== 1)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: save,
              message: "Expected one saved script.dat",
            }),
          );
        const script = yield* zip.read(scripts[0]!.name, scriptLimit);
        const modVersions = yield* Effect.try({
          try: () => savedModVersions(script),
          catch: (error) =>
            error instanceof BoundaryError
              ? error
              : new BoundaryError({ boundary: save, message: String(error) }),
        });
        return yield* decode(
          SaveReadback,
          {
            ...forces,
            modVersions,
            kind: "version-scoped offline saved-force readback, not live engine state",
            save,
            saveBytes: Number(zip.stat.size),
            saveMtimeUtc: saveTimestamp(zip.stat.mtimeNs),
            saveSha256: zip.sha256,
          },
          "saved force readback",
        );
      }),
    );
  });
}
