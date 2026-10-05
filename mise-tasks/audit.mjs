import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {languages as supportedLocales, minimumFactorioVersion} from "./factorio-env.mjs";
import {readInfo, readListing} from "./release-info.mjs";

export function parseLocale(text, name = "locale") {
  const entries = new Map();
  let section = "";
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (/^\[[^\]]+\]$/.test(line)) { section = line.slice(1, -1); continue; }
    const equals = line.indexOf("=");
    if (!section || equals < 1) throw new Error(`${name}:${index + 1}: malformed locale entry`);
    const key = `${section}.${line.slice(0, equals).trim()}`;
    const value = line.slice(equals + 1);
    if (!value.trim()) throw new Error(`${name}: empty ${key}`);
    if (entries.has(key)) throw new Error(`${name}: duplicate ${key}`);
    const stack = [];
    for (const token of value.matchAll(/\[(\/?)(font|color)(?:=[^\]]+)?\]/g)) {
      if (token[1]) { if (stack.pop() !== token[2]) throw new Error(`${name}: unbalanced rich text in ${key}`); }
      else stack.push(token[2]);
    }
    if (stack.length) throw new Error(`${name}: unbalanced rich text in ${key}`);
    if (value.includes("__plural_for_parameter__") && !/__plural_for_parameter__\d+__\{[^}]+\}__/.test(value)) throw new Error(`${name}: malformed plural in ${key}`);
    entries.set(key, value);
  }
  return entries;
}

const tokens = (text, pattern) => [...new Set([...text.matchAll(pattern)].map(match => match[0]))].sort().join("|");
export function validateParity(reference, translated, name) {
  for (const [key, english] of reference) {
    if (!translated.has(key)) throw new Error(`${name}: missing ${key}`);
    const value = translated.get(key);
    for (const pattern of [/__\d+__/g, /__CONTROL__.+?__/g]) {
      if (tokens(english, pattern) !== tokens(value, pattern)) throw new Error(`${name}: parameter/control mismatch in ${key}`);
    }
  }
  for (const key of translated.keys()) if (!reference.has(key)) throw new Error(`${name}: unexpected ${key}`);
}

async function luaFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await luaFiles(path));
    else if (entry.name.endsWith(".lua")) files.push(path);
  }
  return files;
}

export async function audit(root = resolve(".")) {
  const info = await readInfo(root);
  const changelog = await readFile(join(root, "changelog.txt"), "utf8");
  if (changelog.match(/^Version: (.+)$/m)?.[1] !== info.version) throw new Error("Changelog version differs from metadata");
  const readme = await readFile(join(root, "README.md"), "utf8");
  if (!readme.includes(`${info.name}_<version>.zip`)) throw new Error("README archive template differs from metadata");
  if (!info.dependencies.includes(`base >= ${minimumFactorioVersion}`)) throw new Error("Metadata and engine guard minimum differ");
  if (!readme.includes(minimumFactorioVersion)) throw new Error("README omits the declared minimum");
  const listing = await readFile(join(root, "MOD_PORTAL.md"), "utf8");
  if (!listing.includes(`minimum build ${minimumFactorioVersion}`)) throw new Error("Local Portal minimum differs from metadata");
  await readListing(root, info);
  const emmy = JSON.parse(await readFile(join(root, ".emmyrc.json"), "utf8"));
  if (!emmy.workspace.library.includes(`.factorio-test/types/factorio-${minimumFactorioVersion}/factorio/library`)) throw new Error("EmmyLua target differs from the declared minimum");
  const typeScript = await readFile(join(root, "mise-tasks/prepare-types.py"), "utf8");
  if (!typeScript.includes(`VERSION = '${minimumFactorioVersion}'`)) throw new Error("Generated API target differs from the declared minimum");
  const languages = (await readdir(join(root, "locale"))).sort();
  if (languages.join(",") !== [...supportedLocales].sort().join(",")) throw new Error("Locale folders must use Factorio language codes (Spanish: es-ES)");
  const english = parseLocale(await readFile(join(root, "locale/en/LocationLocationLocation.cfg"), "utf8"), "en");
  for (const language of languages) validateParity(english, parseLocale(await readFile(join(root, `locale/${language}/LocationLocationLocation.cfg`), "utf8"), language), language);
  for (const path of [join(root, "control.lua"), join(root, "data.lua"), ...await luaFiles(join(root, "location_location_location"))]) {
    const source = await readFile(path, "utf8");
    for (const pattern of [/ui\.caption\("([\w-]+)"/g, /"location-location-location\.([\w-]+)"/g]) {
      for (const match of source.matchAll(pattern)) if (!english.has(`location-location-location.${match[1]}`)) throw new Error(`${path}: unknown locale key ${match[1]}`);
    }
    if (path.endsWith("data.lua") || path.endsWith("gui/appearance.lua")) {
      if (/__location-location-location__.*\.(png|jpg)/.test(source)) throw new Error(`${path}: custom action artwork violates native-icon policy`);
    }
  }
  for (const name of ["open_planner", "highlight_sources", "focus_search"]) if (!english.has(`controls.location_location_location_${name}`)) throw new Error(`Missing control name: ${name}`);
  console.log(`Release/locale audit passed: ${info.version}; ${languages.join(", ")}; ${english.size} keys per language.`);
  return { version: info.version, languages, keys: english.size };
}
if (import.meta.main) await audit();
