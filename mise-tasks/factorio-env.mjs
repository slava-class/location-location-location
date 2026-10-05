import {access, mkdir, readFile, writeFile, copyFile, realpath, open, unlink} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

export const minimumFactorioVersion = "2.1.20";
export const dependencyPins = [
  {name: "flib", version: "0.17.2", sha256: "0a48c15dc0fc6c13bb3fe8293ba6cb35a07f3b0f37d37acb50ab30e32e8e019d"},
  {name: "factorio-test", version: "3.1.0", sha256: "b88d99e61307ab0af82ab3d2107aaa66f280d10373c5544fdabe6db048ec21a6"},
];
export const languages = ["en", "de", "fr", "es-ES", "ru", "zh-CN"];
export function normalizeLocale(language) {
  const normalized = language === "es" ? "es-ES" : language;
  if (!languages.includes(normalized)) throw new Error("Unsupported UI locale");
  return normalized;
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function checkArchive(bytes, pin) {
  if (digest(bytes) !== pin.sha256) throw new Error(`${pin.name} ${pin.version}: checksum mismatch; refusing changed archive`);
}
export function assertEngineVersion(output) {
  const version = output.match(/Version:\s*(\d+)\.(\d+)\.(\d+)/);
  if (!version) throw new Error("Factorio --version returned no version");
  const [major, minor, patch] = version.slice(1).map(Number);
  const [requiredMajor, requiredMinor, requiredPatch] = minimumFactorioVersion.split(".").map(Number);
  if (major !== requiredMajor || minor !== requiredMinor || patch < requiredPatch) throw new Error(`Factorio ${minimumFactorioVersion} or later in ${requiredMajor}.${requiredMinor} is required; found ${version[0]}`);
  return `${major}.${minor}.${patch}`;
}
export async function findReadData(executable) {
  for (const candidate of [resolve(dirname(executable), "../data"), resolve(dirname(executable), "../../data")]) {
    try { await access(join(candidate, "core", "info.json")); return candidate; } catch {}
  }
  throw new Error(`Cannot locate Factorio core data beside ${executable}; select the installed game executable`);
}
export async function resolveEngine() {
  const {autoDetectFactorioPath} = await import("factorio-test-cli/factorio-process.js");
  let executable = process.env.FACTORIO || autoDetectFactorioPath();
  if (!executable.includes("/")) executable = Bun.which(executable) || executable;
  executable = await realpath(executable);
  const result = spawnSync(executable, ["--version"], {encoding: "utf8"});
  if (result.status !== 0) throw new Error(`Factorio --version failed: ${result.stderr || result.error?.message || result.status}`);
  return {executable, version: assertEngineVersion(result.stdout), readData: await findReadData(executable)};
}
export async function ensureDependencies() {
  const directory = resolve(".factorio-test/mods");
  await mkdir(directory, {recursive: true});
  for (const pin of dependencyPins) {
    const path = join(directory, `${pin.name}_${pin.version}.zip`);
    let bytes;
    try { bytes = await readFile(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!bytes) {
      const {getFactorioPlayerDataPath} = await import("factorio-test-cli/factorio-process.js");
      let credentials;
      try { credentials = JSON.parse(await readFile(getFactorioPlayerDataPath(), "utf8")); } catch {}
      if (!credentials?.["service-username"] || !credentials?.["service-token"]) {
        throw new Error(`Missing ${pin.name} ${pin.version}: log into the Mod Portal in Factorio once, or place its ZIP in ${directory}. Normal credentials are read only.`);
      }
      const metadata = await fetch(`https://mods.factorio.com/api/mods/${pin.name}`);
      if (!metadata.ok) throw new Error(`Mod Portal metadata failed for ${pin.name} (${metadata.status})`);
      const release = (await metadata.json()).releases.find(item => item.version === pin.version);
      if (!release) throw new Error(`Mod Portal has no pinned ${pin.name} ${pin.version}`);
      const url = new URL(release.download_url, "https://mods.factorio.com");
      url.searchParams.set("username", credentials["service-username"]);
      url.searchParams.set("token", credentials["service-token"]);
      let response;
      try { response = await fetch(url); } catch { throw new Error(`Download failed for ${pin.name}; check network access`); }
      if (!response.ok) throw new Error(`Mod Portal download failed for ${pin.name} (${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
      checkArchive(bytes, pin);
      await writeFile(path, bytes);
    }
    checkArchive(bytes, pin);
  }
  return directory;
}
export function profileConfig(profile, directory, engine, language = "en") {
  if (!["base", "space-age", "native", "gallery"].includes(profile)) throw new Error("Unknown test profile");
  normalizeLocale(language);
  const graphics = profile === "native" || profile === "gallery";
  return {
    modPath: resolve("."), factorioPath: engine.executable, dataDirectory: directory,
    outputFile: join(directory, "results.json"), forbidOnly: true, outputTimeout: 60,
    mods: ["quality", "elevated-rails", "space-age", "recycler"].map(name => `${name}=${profile === "space-age"}`),
    factorioArgs: graphics ? ["--disable-migration-window", "--disable-audio", "--window-size", profile === "gallery" ? "1920x1080" : "1600x1000", "--graphics-quality", profile === "gallery" ? "high" : "medium"] : [],
    test: {default_timeout: 120, log_passed_tests: true, tag_blacklist: profile === "native" ? ["portal-gallery"] : graphics ? [] : ["native-ui"],
      ...(graphics ? {tag_whitelist: [profile === "gallery" ? "portal-gallery" : "native-ui"], game_speed: 1} : {})},
  };
}
export async function prepareProfile(profile, language = "en") {
  language = normalizeLocale(language);
  const engine = await resolveEngine();
  await access(join(engine.readData, "base", "locale", language, "base.cfg"));
  const directory = profile === "native" || profile === "gallery" ? resolve(".factorio-test", profile, language) : resolve(".factorio-test/profiles", profile);
  await mkdir(join(directory, "mods"), {recursive: true});
  // Lock before touching this profile's settings or results. Independent profiles stay independent.
  const lock = join(directory, "runner.lock");
  try { const handle = await open(lock, "wx"); await handle.writeFile(String(process.pid)); await handle.close(); }
  catch (error) { if (error.code === "EEXIST") throw new Error(`Profile already running, or interrupted: ${lock}. Check its PID before removing a stale lock.`); throw error; }
  const release = () => unlink(lock);
  try {
    const dependencies = await ensureDependencies();
    for (const pin of dependencyPins) await copyFile(join(dependencies, `${pin.name}_${pin.version}.zip`), join(directory, "mods", `${pin.name}_${pin.version}.zip`));
    const config = profileConfig(profile, directory, engine, language);
    await writeFile(join(directory, "runner.json"), JSON.stringify(config, null, 2));
    await writeFile(join(directory, "config.ini"), `[path]\nread-data=${engine.readData}\nwrite-data=${directory}\n[general]\nlocale=${language}\n[graphics]\nfull-screen=false\n${profile === "gallery" ? "[interface]\nautomatic-ui-scale=false\ncustom-ui-scale=1.25\nshow-tips-and-tricks=false\n" : ""}[sound]\nmaster-muted=true\n[other]\ncheck-updates=false\nautosave-interval=0\n`);
    await unlink(config.outputFile).catch(error => {if (error.code !== "ENOENT") throw error;});
    return {engine, directory, config, release};
  } catch (error) { await release(); throw error; }
}
