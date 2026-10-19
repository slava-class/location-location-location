import { test, expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
import {
  copyFile,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AbsolutePath } from "./contracts.ts";
import { jsonSchema, runHelper } from "./helpers.ts";
import { runCommand } from "./commands.ts";
import {
  BoundaryError,
  decode,
  ModId,
  RelativePath,
  resolveProject,
  TestProfile,
  Version,
} from "./projects.ts";
const Wire = Schema.Struct({
  mod: ModId,
  version: Version,
  member: RelativePath,
  root: AbsolutePath,
  count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000000 })),
  profile: TestProfile,
});
const Request = Schema.Struct({
  schema: Schema.Literal(1),
  validator: Schema.Record(Schema.String, Schema.Unknown),
  cases: Schema.Array(
    Schema.Struct({ id: Schema.String, json: Schema.String }),
  ),
});
const Result = Schema.Struct({
  schema: Schema.Literal(1),
  results: Schema.Array(
    Schema.Struct({ id: Schema.String, accepted: Schema.Boolean }),
  ),
});
test("generated schemas agree with Effect on real Python validation, including excess keys and JSON numeric boundaries", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-wire-")));
  try {
    for (const file of [".python-version", "pyproject.toml", "uv.lock"])
      await copyFile(join(import.meta.dir, "..", file), join(root, file));
    await mkdir(join(root, "mods", "protocol"), { recursive: true });
    await mkdir(join(root, "tools", "fixtures"), { recursive: true });
    await copyFile(
      join(import.meta.dir, "helper_protocol.py"),
      join(root, "tools", "helper_protocol.py"),
    );
    await copyFile(
      join(import.meta.dir, "fixtures", "schema-parity.py"),
      join(root, "tools", "fixtures", "schema-parity.py"),
    );
    await writeFile(
      join(root, "mods", "protocol", "info.json"),
      JSON.stringify({
        name: "protocol",
        version: "1.0.0",
        title: "Protocol fixture",
        author: "test",
        description: "Cross-language boundary regression",
        factorio_version: "2.1",
        dependencies: ["base >= 2.1.20"],
      }),
    );
    const valid = {
      mod: "protocol",
      version: "2.1.21",
      member: "locale/zh-CN/名字.cfg",
      root: "/tmp/with spaces",
      count: 12,
      profile: "base",
    };
    const values: unknown[] = [
      valid,
      { ...valid, version: "65535.0.1" },
      { ...valid, mod: "m".repeat(100) },
      ...["", "m".repeat(101), "名字", "mod\n"].map((mod) => ({
        ...valid,
        mod,
      })),
      ...["65536.0.1", "01.0.0", "1.2.3\n", "１.2.3", "1.2"].map((version) => ({
        ...valid,
        version,
      })),
      ...[
        "../escape",
        "/absolute",
        "a/../b",
        "a//b",
        "a\\b",
        "a\nb",
        "a\0b",
        "a:b",
      ].map((member) => ({ ...valid, member })),
      ...[-1, 1.5, 1000001, true, "1", null].map((count) => ({
        ...valid,
        count,
      })),
      { ...valid, profile: "unreviewed" },
      { ...valid, unexpected: true },
      { ...valid, root: "relative" },
      null,
      [],
      {},
    ];
    const cases = values.map((value, index) => ({
      id: String(index),
      json: JSON.stringify(value),
    }));
    for (const count of ["NaN", "Infinity", "1e309"])
      cases.push({
        id: count,
        json: JSON.stringify(valid).replace('"count":12', '"count":' + count),
      });
    const expected = [];
    for (const entry of cases) {
      let accepted = false;
      try {
        const parsed: unknown = JSON.parse(entry.json);
        accepted = await Effect.runPromise(
          decode(Wire, parsed, "wire").pipe(
            Effect.match({ onSuccess: () => true, onFailure: () => false }),
          ),
        );
      } catch {}
      expected.push({ id: entry.id, accepted });
    }
    const project = await Effect.runPromise(
      resolveProject(root, "protocol", root).pipe(
        Effect.provide(BunServices.layer),
      ),
    );
    await Effect.runPromise(
      runCommand(project, "fixture-python-setup", [
        "uv",
        "sync",
        "--offline",
        "--locked",
        "--project",
        root,
      ]).pipe(Effect.provide(BunServices.layer)),
    );
    const observed = await Effect.runPromise(
      runHelper(project, "tools/fixtures/schema-parity.py", Request, Result, {
        schema: 1,
        validator: jsonSchema(Wire),
        cases,
      }).pipe(Effect.provide(BunServices.layer)),
    );
    expect(
      expected.filter((result) => result.accepted).map((result) => result.id),
    ).toEqual(["0", "1", "2"]);
    expect(observed.results).toEqual(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
test("lossy or opaque wire refinements fail before becoming a permissive Python contract", () => {
  for (const schema of [
    Schema.String.check(Schema.isPattern(/^supported$/)),
    Schema.String.check(Schema.isMaxLength(100)),
    Schema.String.check(Schema.makeFilter((value) => value !== "forbidden")),
    Schema.Number,
    Schema.Symbol,
    Schema.optional(Schema.String),
  ])
    expect(() => jsonSchema(schema)).toThrow(BoundaryError);
});
