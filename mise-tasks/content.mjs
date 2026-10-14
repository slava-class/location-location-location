import { resolve } from "node:path";
import { root, luaValue } from "./lib.mjs";

const metadata = await Bun.file(resolve(root, "info.json")).json();

export const disciplines = { chemistry: "Chemistry", physics: "Physics", engineering: "Engineering", metallurgy: "Metallurgy", geology: "Geology", biology: "Biology" };
export const bases = { real: "Real principle", simplified: "Simplified", abstracted: "Game abstraction", fictional: "Fictional species; real-world analogue" };
// Budgets include the topic, rather than hiding a second heading outside the word count.
const limits = { recipe: [32, 230], material: [28, 200], machine: [30, 220], technology: [44, 320] };
const identifier = /^[a-z][a-z0-9-]*$/;
const prototypeName = /^[A-Za-z0-9_-]{1,200}$/;

async function targetTypes(apiVersion) {
  const api = await Bun.file(resolve(root, `../factorio-llm-docs/llm-docs/${apiVersion}/prototype-api.json`)).json();
  const byName = new Map(api.prototypes.map(prototype => [prototype.name, prototype]));
  const descendants = parent => api.prototypes.filter(prototype => {
    if (!prototype.typename) return false;
    for (let current = prototype; current; current = byName.get(current.parent)) {
      if (current.name === parent) return true;
    }
    return false;
  }).map(prototype => prototype.typename);
  return {
    recipe: new Set(["recipe"]),
    material: new Set([...descendants("ItemPrototype"), "fluid"]),
    machine: new Set(descendants("EntityPrototype")),
    technology: new Set(["technology"]),
  };
}

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

export async function loadContent() {
  const catalogue = await Bun.file(resolve(root, "content/catalog.json")).json();
  const sources = await Bun.file(resolve(root, "content/sources.json")).json();
  const game = await Bun.file(resolve(root, "content/game-sources.json")).json();
  const types = await targetTypes(game.apiVersion);
  insist(catalogue.schemaVersion === 3 && Array.isArray(catalogue.entries), "Unsupported catalogue schema");
  const ids = new Set();
  const targets = new Set();
  const usedSources = new Set();
  const counts = {};
  for (const [id, source] of Object.entries(sources)) {
    insist(identifier.test(id), `Invalid source ID: ${id}`);
    for (const key of ["title", "section", "url"]) insist(typeof source[key] === "string" && source[key].trim(), `${id}: missing ${key}`);
    insist(new URL(source.url).protocol === "https:", `${id}: source must use HTTPS`);
  }
  for (const entry of catalogue.entries) {
    const { id, kind, discipline, basis, topic, text } = entry;
    insist(typeof id === "string" && identifier.test(id) && id.length < 100 && !ids.has(id), `Invalid/duplicate dossier ID: ${id}`);
    ids.add(id);
    insist(Object.hasOwn(limits, kind), `${id}: unknown kind ${kind}`);
    insist(Object.hasOwn(disciplines, discipline) && Object.hasOwn(bases, basis), `${id}: invalid classification`);
    insist(typeof topic === "string" && topic === topic.trim() && topic.length > 0 && topic.length <= 32 && !/[\r\n\[\]\\]|__\d+__/.test(topic), `${id}: invalid topic`);
    insist(typeof text === "string" && text === text.trim() && !/[\r\n\[\]\\]|__\d+__/.test(text), `${id}: body must be one plain-text paragraph`);
    const rendered = `${topic}: ${text}`;
    const words = rendered.split(/\s+/).length;
    const [maxWords, maxChars] = limits[kind];
    insist(words <= maxWords && rendered.length <= maxChars, `${id}: ${words}/${maxWords} words, ${rendered.length}/${maxChars} characters including topic`);
    for (const key of ["sources", "gameSources", "targets"]) insist(Array.isArray(entry[key]) && entry[key].length > 0, `${id}: missing ${key}`);
    for (const source of entry.sources) {
      insist(Object.hasOwn(sources, source), `${id}: unknown scientific source ${source}`);
      usedSources.add(source);
    }
    for (const source of entry.gameSources) insist(Object.hasOwn(game.files, source), `${id}: unknown game source ${source}`);
    if (entry.when !== undefined) {
      insist(entry.when && typeof entry.when === "object" && !Array.isArray(entry.when) && Object.keys(entry.when).length > 0, `${id}: invalid creation conditions`);
      for (const [key, value] of Object.entries(entry.when)) {
        insist(["mod", "startup", "featureFlag"].includes(key) && typeof value === "string" && prototypeName.test(value), `${id}: invalid creation condition ${key}`);
        if (key === "mod") insist(Object.hasOwn(game.reviewedMods, value), `${id}: unreviewed conditional mod ${value}`);
      }
    }
    for (const target of entry.targets) {
      const [type, name, extra] = target.split("/");
      insist(types[kind].has(type) && prototypeName.test(name) && extra === undefined, `${id}: invalid target ${target}`);
      insist(!targets.has(target), `Duplicate target: ${target}`);
      targets.add(target);
      counts[type] = (counts[type] ?? 0) + 1;
    }
  }
  insist(usedSources.size === Object.keys(sources).length, "Unreferenced scientific source");
  return { entries: catalogue.entries, sources, game, types, counts, targetCount: targets.size };
}

export function renderContent({ entries, sources }) {
  const record = ({ id, targets }) => ({ id, targets: targets.map(target => target.split("/")) });
  const unconditional = entries.filter(entry => !entry.when).map(record);
  const conditional = entries.filter(entry => entry.when).map(entry => {
    const guards = ["mod", "featureFlag", "startup"].filter(key => Object.hasOwn(entry.when, key)).map(key => {
      const value = entry.when[key];
      if (key === "mod") return `active_mods[${luaValue(value)}]`;
      if (key === "startup") return `startup_settings[${luaValue(value)}].value`;
      return `enabled_features[${luaValue(value)}]`;
    });
    return `    if ${guards.join(" and ")} then catalogue[#catalogue + 1] = ${luaValue(record(entry))} end`;
  });
  const lua = [
    "-- Generated by mise run generate from content/catalog.json. Do not edit.",
    "return function(active_mods, startup_settings, enabled_features)",
    `    local catalogue = ${luaValue(unconditional)}`,
    ...conditional,
    "    return catalogue",
    "end", "",
  ].join("\n");
  const locale = [
    "; Generated by mise run generate. Edit info.json, content/catalog.json and content/sources.json instead.",
    "[mod-name]", `${metadata.name}=${metadata.title}`, "", "[mod-description]",
    `${metadata.name}=${metadata.description}`,
    "", "[py-research-dossier]",
    "note=[font=default]__1__: __2__[/font]", "sources=Research references",
  ];
  for (const entry of entries) {
    locale.push(`topic-${entry.id}=${entry.topic}`);
    locale.push(`text-${entry.id}=${entry.text}`);
    const references = entry.sources.map(id => {
      const source = sources[id];
      return `${source.title} — ${source.section}\\n${source.url}`;
    }).join("\\n\\n");
    locale.push(`refs-${entry.id}=${disciplines[entry.discipline]} — ${bases[entry.basis]}\\n\\n${references}`);
  }
  return new Map([["dossier/catalog.lua", lua], ["locale/en/py-research-dossier.cfg", locale.join("\n") + "\n"]]);
}

if (import.meta.main) {
  const mode = process.argv[2];
  insist(mode === "generate" || mode === "check", "Usage: bun mise-tasks/content.mjs generate|check");
  const content = await loadContent();
  for (const [path, expected] of renderContent(content)) {
    const file = Bun.file(resolve(root, path));
    if (mode === "generate") await Bun.write(file, expected);
    else insist(await file.exists() && await file.text() === expected, `Stale generated file: ${path}; run mise run generate`);
  }
  console.log(`${mode}: ${content.entries.length} dossiers; ${content.targetCount} qualified targets; ${Object.keys(content.sources).length} source locators`);
  console.log(JSON.stringify(content.counts));
}
