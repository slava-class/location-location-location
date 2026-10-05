import {test, expect} from "bun:test";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {assertEngineVersion, checkArchive, dependencyPins, findReadData, profileConfig, normalizeLocale} from "./factorio-env.mjs";
import {ownedNativePid, nativeResults} from "./native-preview.mjs";

test("minimum engine validation rejects missing versions and incompatible releases", () => {
  expect(assertEngineVersion("Version: 2.1.20 (build 1)" )).toBe("2.1.20");
  for (const output of ["Version: 2.1.19", "Version: 2.1.18", "Version: 2.0.72", "Version: 3.0.0", "Steam requires restart"])
    expect(() => assertEngineVersion(output)).toThrow();
});
test("Mac bundle and Linux binary layouts resolve core data, missing installations fail early", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lll-data-test-"));
  try {
    const mac = join(directory, "factorio.app/Contents");
    await mkdir(join(mac, "data/core"), {recursive: true});
    await writeFile(join(mac, "data/core/info.json"), "{}");
    expect(await findReadData(join(mac, "MacOS/factorio"))).toBe(join(mac, "data"));
    const linux = join(directory, "factorio");
    await mkdir(join(linux, "data/core"), {recursive: true});
    await writeFile(join(linux, "data/core/info.json"), "{}");
    expect(await findReadData(join(linux, "bin/x64/factorio"))).toBe(join(linux, "data"));
    expect(findReadData(join(directory, "missing/bin/factorio"))).rejects.toThrow("Cannot locate");
  } finally { await rm(directory, {recursive: true, force: true}); }
});
test("changed dependency archives fail closed instead of selecting a newer version", () => {
  for (const pin of dependencyPins) expect(() => checkArchive(Buffer.from("changed ZIP"), pin)).toThrow("checksum mismatch");
});
test("profiles select the right suites and explicitly disable unrelated built-ins", () => {
  const engine = {executable: "/game/factorio"};
  const base = profileConfig("base", "/cache/base", engine);
  const space = profileConfig("space-age", "/cache/space", engine);
  const native = profileConfig("native", "/cache/en", engine, "en");
  expect(base.mods.every(mod => mod.endsWith("=false"))).toBe(true);
  expect(space.mods.every(mod => mod.endsWith("=true"))).toBe(true);
  expect(base.test.tag_blacklist).toEqual(["native-ui"]);
  expect(native.test.tag_blacklist).toEqual(["portal-gallery"]);
  expect(native.test.tag_whitelist).toEqual(["native-ui"]);
  expect(base.outputFile).not.toBe(space.outputFile);
  expect(() => profileConfig("native", "/cache", engine, "unknown")).toThrow();
});
test("native cleanup ignores the normal game and other test profiles; ambiguity fails closed", () => {
  const executable = "/Applications/factorio.app/Contents/MacOS/factorio";
  const owned = `100 ${executable} --load-game test.zip --mod-directory /cache/en/mods -c /cache/en/config.ini`;
  const other = `101 ${executable} --mod-directory /normal/mods -c /normal/config.ini`;
  expect(ownedNativePid(`${other}\n${owned}`, executable, "/cache/en")).toBe(100);
  expect(ownedNativePid(other, executable, "/cache/en")).toBeUndefined();
  expect(ownedNativePid(owned.replace("/cache/en/mods", "/cache/en/mods-other"), executable, "/cache/en")).toBeUndefined();
  expect(() => ownedNativePid(`${owned}\n${owned.replace("100", "102")}`, executable, "/cache/en")).toThrow("Multiple");
});
test("native results come from real FactorioTest records and retain failures", () => {
  expect(nativeResults("Screenshot saved: 01-list.png")).toEqual([]);
  expect(nativeResults("11.0 Script @__factorio-test__:1: PASS native UI gallery > 01 list (<Profiler>)\n11.2 Script: FAIL native UI gallery > 02 editor")).toEqual([
    {path: "native UI gallery > 01 list", result: "passed"}, {path: "native UI gallery > 02 editor", result: "failed"}
  ]);
  expect(nativeResults("Script: PASS tests.native_gallery > Mod Portal gallery > 01 source-survey\nScript: FAIL Mod Portal gallery > 02 planner\nScript: PASS native UI gallery > 01 list", "Mod Portal gallery")).toEqual([
    {path: "tests.native_gallery > Mod Portal gallery > 01 source-survey", result: "passed"},
    {path: "Mod Portal gallery > 02 planner", result: "failed"}
  ]);
});

test("Spanish command alias resolves the actual Factorio locale", () => {
  expect(normalizeLocale("es")).toBe("es-ES");
  expect(normalizeLocale("es-ES")).toBe("es-ES");
});
