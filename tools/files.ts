import { Effect, FileSystem, Stream } from "effect";
import type { PlatformError } from "effect";
import { join, relative } from "node:path";
import { PinnedFile } from "./contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  RelativePath,
} from "./projects.ts";
import { withOwnedLock } from "./locks.ts";
export function hashFile(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      hash = new Bun.CryptoHasher("sha256");
    yield* Stream.runForEach(fs.stream(path), (bytes) =>
      Effect.sync(() => {
        hash.update(bytes);
      }),
    );
    return hash.digest("hex");
  });
}

export function verifyPinnedFile(
  input: typeof PinnedFile.Type,
  provisioning: string,
) {
  return Effect.gen(function* () {
    const pin = yield* decode(PinnedFile, input, "pinned file");
    const fs = yield* FileSystem.FileSystem;
    yield* assertCanonicalPath(pin.path);
    if (!(yield* fs.exists(pin.path)))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: pin.path,
          message: `Missing pinned input; run ${provisioning}`,
        }),
      );
    const stat = yield* fs.stat(pin.path);
    if (
      stat.type !== "File" ||
      stat.size > BigInt(pin.maxBytes) ||
      (yield* hashFile(pin.path)) !== pin.sha256
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: pin.path,
          message:
            "Cached input differs from its size/checksum pin; refusing substitution",
        }),
      );
    return pin.path;
  });
}

/** Load only inside explicit provisioning, under one immutable-input ownership lock. */
export function provisionPinnedFile<E, R>(
  input: typeof PinnedFile.Type,
  load: Effect.Effect<Uint8Array, E, R>,
) {
  return Effect.gen(function* () {
    const pin = yield* decode(PinnedFile, input, "pinned file");
    const fs = yield* FileSystem.FileSystem;
    yield* assertCanonicalPath(pin.path);
    return yield* withOwnedLock(
      pin.path + ".lock",
      "provision:" + pin.path,
      Effect.gen(function* () {
        if (yield* fs.exists(pin.path))
          return yield* verifyPinnedFile(pin, "explicit provisioning");
        const bytes = yield* load;
        if (
          bytes.byteLength > pin.maxBytes ||
          new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
            pin.sha256
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: pin.path,
              message:
                "Supplied input differs from its size/checksum pin; nothing was installed",
            }),
          );
        const temporary = pin.path + "." + crypto.randomUUID() + ".part";
        yield* Effect.acquireUseRelease(
          fs.writeFile(temporary, bytes, { flag: "wx" }),
          () =>
            Effect.gen(function* () {
              yield* assertCanonicalPath(pin.path);
              if (yield* fs.exists(pin.path))
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: pin.path,
                    message: "Input cache changed during provisioning",
                  }),
                );
              yield* fs.rename(temporary, pin.path);
            }),
          () => fs.remove(temporary, { force: true }).pipe(Effect.orDie),
        );
        return yield* verifyPinnedFile(pin, "explicit provisioning");
      }),
    );
  });
}

export function inventoryFiles(directory: string, roots?: readonly string[]) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files: Record<string, string> = {};
    const visit = (
      path: string,
    ): Effect.Effect<
      void,
      BoundaryError | PlatformError.PlatformError,
      FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        yield* assertCanonicalPath(path);
        const info = yield* fs.stat(path);
        if (info.type === "Directory") {
          for (const name of (yield* fs.readDirectory(path)).sort())
            yield* visit(join(path, name));
        } else if (info.type === "File")
          files[relative(directory, path)] = yield* hashFile(path);
        else
          return yield* Effect.fail(
            new BoundaryError({
              boundary: path,
              message: "Immutable input contains an unsupported file type",
            }),
          );
      });
    yield* assertCanonicalPath(directory);
    if (roots === undefined) yield* visit(directory);
    else
      for (const root of roots) {
        yield* decode(RelativePath, root, "inventory member root");
        yield* visit(join(directory, root));
      }
    return files;
  });
}
