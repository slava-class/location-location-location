import { expect, test } from "bun:test";
import { Schema } from "effect";
import { AbsolutePath, ElapsedMs } from "./contracts.ts";
import { ModId, RelativePath, Version } from "./projects.ts";

test("mod identities preserve portable IDs and Factorio's bounded version components", () => {
  const id = Schema.decodeUnknownSync(ModId);
  for (const value of [
    "a",
    "reversed-underground-belt-detector",
    "A_0-",
    "a".repeat(100),
  ])
    expect(id(value)).toBe(value);
  for (const value of ["", "a".repeat(101), "../a", "a/b", "a\n", "mód", 1])
    expect(() => id(value)).toThrow();
  const version = Schema.decodeUnknownSync(Version);
  for (const value of ["0.0.0", "1.2.3", "65535.65535.65535"])
    expect(version(value)).toBe(value);
  for (const value of [
    "65536.0.0",
    "01.0.0",
    "1.2",
    "1.2.3\n",
    "-1.0.0",
    "1.2.3-beta",
    123,
  ])
    expect(() => version(value)).toThrow();
});

test("archive paths reject traversal and nonportable separators without rejecting Unicode names", () => {
  const relative = Schema.decodeUnknownSync(RelativePath);
  for (const value of [
    "info.json",
    "locale/日本語/example.cfg",
    "folder/with spaces.lua",
  ])
    expect(relative(value)).toBe(value);
  for (const value of [
    "",
    "/absolute",
    "../outside",
    "a/../b",
    "./a",
    "a//b",
    "a\\b",
    "a\u0000b",
    "a\nb",
  ])
    expect(() => relative(value)).toThrow();
  const absolute = Schema.decodeUnknownSync(AbsolutePath);
  expect(absolute("/a/日本語/file.zip")).toBe("/a/日本語/file.zip");
  for (const value of ["relative.zip", "/a\u0000b", "/a\nb"])
    expect(() => absolute(value)).toThrow();
});

test("elapsed-time receipts reject nonfinite and negative values", () => {
  const elapsed = Schema.decodeUnknownSync(ElapsedMs);
  for (const value of [0, 0.25, Number.MAX_VALUE])
    expect(elapsed(value)).toBe(value);
  for (const value of [-1, NaN, Infinity, -Infinity, "1", JSON.parse("1e309")])
    expect(() => elapsed(value)).toThrow();
});
