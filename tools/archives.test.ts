import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Fiber } from "effect";
import { createWriteStream, watch } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { ZipFile } from "yazl";
import { pack } from "tar-stream";
import type { Header } from "tar-stream";
import { archiveIO, archiveLimits, withZip, writeZip } from "./archives.ts";
import { readTar } from "./tar.ts";
import { inspectArchive, packageProject } from "./packaging.ts";
import { BoundaryError, resolveProject, resolveWorkspace } from "./projects.ts";
import { runCommand } from "./commands.ts";
import { runFiles } from "./fixtures/release.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-archive-")));
  roots.push(root);
  return root;
}
async function fixture(bytes: Uint8Array) {
  const path = join(await directory(), "input.zip");
  await writeFile(path, bytes);
  return path;
}
async function zipped(
  entries: {
    name: string;
    text?: string;
    mode?: number;
    directory?: boolean;
  }[],
  zip64 = false,
) {
  const writer = new ZipFile(),
    chunks: Buffer[] = [],
    source = writer.outputStream;
  if (!(source instanceof Readable)) throw new Error("Expected Node stream");
  writer.on("error", (error: Error) => source.destroy(error));
  const completion = pipeline(
    source,
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    }),
  );
  for (const entry of entries) {
    if (entry.directory) writer.addEmptyDirectory(entry.name);
    else
      writer.addBuffer(Buffer.from(entry.text ?? "payload"), entry.name, {
        compress: false,
        ...(entry.mode === undefined ? {} : { mode: entry.mode }),
      });
  }
  writer.end({ forceZip64Format: zip64, comment: "" });
  await completion;
  return Buffer.concat(chunks);
}
function rename(bytes: Buffer, from: string, to: string, firstOnly = false) {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to))
    throw new Error("Fixture replacement must preserve byte length");
  const result = Buffer.from(bytes);
  let start = 0,
    found = 0;
  while (true) {
    const offset = result.indexOf(from, start);
    if (offset < 0) break;
    result.write(to, offset);
    found++;
    start = offset + Buffer.byteLength(to);
    if (firstOnly) break;
  }
  if (found === 0) throw new Error("Fixture name not found");
  return result;
}
const valid = [
  {
    name: "probe_1.0.0/info.json",
    text: JSON.stringify({
      name: "probe",
      version: "1.0.0",
      factorio_version: "2.1",
    }),
  },
  { name: "probe_1.0.0/file.lua", text: "payload to corrupt" },
];

test("ZIP64 and directory records retain exact payloads; Factorio's omitted dependency field means base", async () => {
  const path = await fixture(
    await zipped([{ name: "probe_1.0.0", directory: true }, ...valid], true),
  );
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(await readFile(path))
    .digest("hex");
  const result = await runFiles(inspectArchive(path, sha256));
  expect(result.mod).toEqual({ name: "probe", version: "1.0.0" });
  expect(result.dependencies).toEqual(["base"]);
  expect(result.members).toEqual(["file.lua", "info.json"]);
  expect(
    await runFiles(
      withZip({ archive: path }, (zip) =>
        zip.read("probe_1.0.0/file.lua", 100),
      ),
    ),
  ).toEqual(Buffer.from("payload to corrupt"));
});
test("ZIP rejects corrupt payloads, truncation, local-name disagreement, encryption and dishonest sizes", async () => {
  const original = await zipped(valid);
  const corrupt = Buffer.from(original);
  corrupt[corrupt.indexOf("payload to corrupt")]! ^= 1;
  const encrypted = Buffer.from(original);
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  const dishonest = Buffer.from(original);
  dishonest.writeUInt32LE(
    dishonest.readUInt32LE(central + 24) + 1,
    central + 24,
  );
  for (const bytes of [
    corrupt,
    original.subarray(0, -1),
    rename(original, "file.lua", "else.lua", true),
    encrypted,
    dishonest,
  ]) {
    const path = await fixture(bytes);
    expect(
      await runFiles(
        Effect.flip(withZip({ archive: path }, (zip) => zip.verifyAll)),
      ),
    ).toBeInstanceOf(BoundaryError);
  }
});
test("ZIP rejects duplicate, traversal, alias and non-regular entries before consumers run", async () => {
  const originals = [
    await zipped([{ name: "same" }, { name: "same" }]),
    rename(await zipped([{ name: "aa/file" }]), "aa/file", "../file"),
    await zipped([{ name: "same" }, { name: "same", directory: true }]),
    await zipped([{ name: "parent/child" }, { name: "parent" }]),
    await zipped([{ name: "link", mode: 0o120777 }]),
    await zipped([{ name: "device", mode: 0o060644 }]),
  ];
  for (const bytes of originals) {
    const path = await fixture(bytes);
    let called = false;
    expect(
      await runFiles(
        Effect.flip(
          withZip({ archive: path }, () =>
            Effect.sync(() => {
              called = true;
            }),
          ),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
    expect(called).toBe(false);
  }
});
test("ZIP enforces input, count, name, expansion, per-entry and per-read bounds", async () => {
  const path = await fixture(
    await zipped([
      { name: "first", text: "0123456789" },
      { name: "second", text: "abcdefghij" },
    ]),
  );
  for (const change of [
    { compressedBytes: 22 },
    { entries: 1 },
    { nameBytes: 3 },
    { expandedBytes: 19 },
    { entryBytes: 9 },
  ]) {
    expect(
      await runFiles(
        Effect.flip(
          withZip(
            { archive: path, limits: { ...archiveLimits, ...change } },
            (zip) => zip.verifyAll,
          ),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
  }
  expect(
    await runFiles(
      Effect.flip(withZip({ archive: path }, (zip) => zip.read("first", 9))),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(
    await runFiles(
      Effect.flip(
        withZip(
          { archive: path, sha256: "0".repeat(64) },
          (zip) => zip.verifyAll,
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});
test("archive identity changes and filesystem aliases cannot produce successful readbacks", async () => {
  const path = await fixture(await zipped(valid)),
    alias = path + ".alias";
  await symlink(path, alias);
  expect(
    await runFiles(
      Effect.flip(withZip({ archive: alias }, (zip) => zip.verifyAll)),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(
    await runFiles(
      Effect.flip(
        withZip({ archive: path }, () =>
          Effect.promise(() => appendFile(path, "changed")),
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});
test("package metadata must agree with its one root; dependency types are validated", async () => {
  for (const entries of [
    [...valid, { name: "elsewhere/file.lua" }],
    [{ name: "wrong_1.0.0/info.json", text: valid[0]!.text }],
    [
      {
        name: "probe_1.0.0/info.json",
        text: JSON.stringify({
          name: "probe",
          version: "1.0.0",
          dependencies: [false],
        }),
      },
    ],
    [{ name: "probe_1.0.0/info.json", text: '{"name": NaN}' }],
  ]) {
    const path = await fixture(await zipped(entries));
    const hash = new Bun.CryptoHasher("sha256")
      .update(await readFile(path))
      .digest("hex");
    expect(
      await runFiles(Effect.flip(inspectArchive(path, hash))),
    ).toBeInstanceOf(BoundaryError);
  }
});
test("exclusive ZIP writes preserve existing destinations and reject aliased input", async () => {
  const root = await directory(),
    output = join(root, "preserved.zip"),
    source = join(root, "source"),
    alias = join(root, "alias");
  await writeFile(output, "do not replace");
  await writeFile(source, "source bytes");
  await symlink(source, alias);
  expect(
    await runFiles(
      Effect.flip(writeZip(output, [{ name: "file", path: source }])),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(await readFile(output, "utf8")).toBe("do not replace");
  expect(
    await runFiles(
      Effect.flip(
        writeZip(join(root, "new.zip"), [{ name: "file", path: alias }]),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(access(join(root, "new.zip"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
test("the archive native-I/O boundary joins interrupted pipelines before returning", async () => {
  const output = join(await directory(), "cancelled.bin");
  let release!: () => void,
    started!: () => void,
    stopped = false;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      started = resolve;
    });
  const operation = archiveIO(output, async (signal) => {
    const source = Readable.from(
      (async function* () {
        yield Buffer.from("first bytes");
        started();
        await gate;
        yield Buffer.from("last bytes");
      })(),
    );
    try {
      await pipeline(source, createWriteStream(output), { signal });
    } finally {
      stopped = true;
    }
  });
  const fiber = Effect.runFork(operation);
  await ready;
  const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
  release();
  await interrupted;
  expect(stopped).toBe(true);
  expect(await readFile(output, "utf8")).not.toContain("last bytes");
});
test("interrupted ZIP writing removes its partial destination before the fiber finishes", async () => {
  const root = await directory(),
    output = join(root, "cancelled.zip");
  const watcher = watch(root);
  const opened = new Promise<void>((resolve, reject) => {
    watcher.on("change", (_event, name) => {
      if (name === "cancelled.zip") resolve();
    });
    watcher.once("error", reject);
  });
  const fiber = Effect.runFork(
    writeZip(output, [
      { name: "payload", bytes: randomBytes(32 * 1024 * 1024) },
    ]).pipe(Effect.provide(BunServices.layer)),
  );
  try {
    await opened;
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber));
    watcher.close();
  }
  expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
}, 10000);
test("ZIP generation is deterministic across input ordering and process timezones", async () => {
  const root = await directory();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const workspace = await runFiles(resolveWorkspace(root)),
    script = join(root, "writer.mjs");
  await writeFile(
    script,
    `import {Effect} from ${JSON.stringify(import.meta.resolve("effect"))};\nimport {BunServices} from ${JSON.stringify(import.meta.resolve("@effect/platform-bun"))};\nimport {writeZip} from ${JSON.stringify(new URL("./archives.ts", import.meta.url).href)};\nawait Effect.runPromise(writeZip(process.argv[2],[{name:"z",bytes:Buffer.from("last")},{name:"a",bytes:Buffer.from("first")}]).pipe(Effect.provide(BunServices.layer)));\n`,
  );
  for (const timezone of ["UTC", "Pacific/Honolulu"])
    await runFiles(
      runCommand(
        workspace,
        "zip-timezone",
        [
          process.execPath,
          script,
          join(root, timezone.replace("/", "-") + ".zip"),
        ],
        { env: { TZ: timezone }, deadlineMs: 10000 },
      ),
    );
  const expected = await readFile(join(root, "UTC.zip"));
  expect(await readFile(join(root, "Pacific-Honolulu.zip"))).toEqual(expected);
  const local = join(root, "local.zip");
  await runFiles(
    writeZip(local, [
      { name: "a", bytes: Buffer.from("first") },
      { name: "z", bytes: Buffer.from("last") },
    ]),
  );
  expect(await readFile(local)).toEqual(expected);
});
test("packaging reads back source bytes and rejects metadata changed after resolution", async () => {
  const root = await directory(),
    mod = join(root, "mods/probe");
  await mkdir(mod, { recursive: true });
  const info = {
    name: "probe",
    version: "1.0.0",
    title: "Probe",
    author: "Fixture",
    description: "Archive test",
    factorio_version: "2.1",
    dependencies: ["base >= 2.1.20"],
  };
  await writeFile(join(mod, "info.json"), JSON.stringify(info));
  await writeFile(join(mod, "control.lua"), "return 42\n");
  await writeFile(join(mod, "license.txt"), "Fixture\n");
  await writeFile(join(mod, "changelog.txt"), "Fixture\n");
  const project = await runFiles(resolveProject(root, "probe", root));
  const result = await runFiles(packageProject(project));
  expect(
    await runFiles(
      withZip({ archive: result.archive, sha256: result.sha256 }, (zip) =>
        zip.read("probe_1.0.0/control.lua", 1024),
      ),
    ),
  ).toEqual(Buffer.from("return 42\n"));
  expect(result.files["control.lua"]).toBe(
    new Bun.CryptoHasher("sha256").update("return 42\n").digest("hex"),
  );
  await writeFile(
    join(mod, "info.json"),
    JSON.stringify({ ...info, version: "1.0.1" }),
  );
  expect(await runFiles(Effect.flip(packageProject(project)))).toBeInstanceOf(
    BoundaryError,
  );
});
async function tarred(
  headers: (Partial<Header> & { name: string; body?: string })[],
) {
  const stream = pack(),
    chunks: Buffer[] = [];
  const done = (async () => {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Expected tar bytes");
      chunks.push(Buffer.from(chunk));
    }
  })();
  for (const { body, ...header } of headers) stream.entry(header, body ?? "");
  stream.finalize();
  await done;
  return gzipSync(Buffer.concat(chunks));
}
test("tar validates all entries, including unselected links, duplicates and traversal", async () => {
  for (const headers of [
    [
      { name: "root/okay", body: "data" },
      { name: "root/link", type: "symlink" as const, linkname: "okay" },
    ],
    [
      { name: "root/file", body: "one" },
      { name: "root/file", body: "two" },
    ],
    [{ name: "root/../escape", body: "bad" }],
    [{ name: "elsewhere/file", body: "bad" }],
  ]) {
    const bytes = await tarred(headers),
      path = await fixture(bytes),
      pin = {
        path,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        maxBytes: 1024 * 1024,
      };
    expect(
      await runFiles(
        Effect.flip(
          readTar(
            { pin, root: "root" },
            (member) => member.name === "root/okay",
          ),
        ),
      ),
    ).toBeInstanceOf(BoundaryError);
  }
});
test("tar supports POSIX directory syntax while enforcing content and compressed-stream integrity", async () => {
  const bytes = await tarred([
    { name: "./", type: "directory" },
    { name: "./root/", type: "directory" },
    { name: "./root/file", body: "verified bytes" },
  ]);
  const path = await fixture(bytes),
    pin = {
      path,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      maxBytes: 1024 * 1024,
    };
  const files = await runFiles(readTar({ pin }, () => true));
  expect([...files.keys()]).toEqual(["root/file"]);
  expect(files.get("root/file")).toEqual(Buffer.from("verified bytes"));
  expect(
    await runFiles(
      Effect.flip(
        readTar(
          { pin, limits: { ...archiveLimits, expandedBytes: 1024 } },
          () => true,
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect(
    await runFiles(
      Effect.flip(
        readTar({ pin: { ...pin, sha256: "0".repeat(64) } }, () => true),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
  await writeFile(path, bytes.subarray(0, -8));
  expect(
    await runFiles(
      Effect.flip(
        readTar(
          {
            pin: {
              ...pin,
              sha256: new Bun.CryptoHasher("sha256")
                .update(bytes.subarray(0, -8))
                .digest("hex"),
            },
          },
          () => true,
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});
