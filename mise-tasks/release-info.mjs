import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

export function parseVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Version must be three canonical numbers, e.g. 1.0.1");
  const parts = version.split(".").map(Number);
  if (parts.some(part => part > 65535)) throw new Error("Factorio version components must be 0–65535");
  return parts;
}
export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}
export async function readInfo(root) {
  const info = JSON.parse(await readFile(join(root, "info.json"), "utf8"));
  if (info.name !== "location-location-location") throw new Error("Unexpected mod ID in info.json");
  parseVersion(info.version);
  return info;
}
export async function readListing(root, info) {
  const text = (await readFile(join(root, "MOD_PORTAL.md"), "utf8")).replace(/\r\n/g, "\n");
  const description = text.split("\n## Description\n\n")[1]?.trim();
  const category = text.match(/^\- \*\*Category:\*\* (.+)$/m)?.[1].toLowerCase();
  const source = text.match(/^\- \*\*Source:\*\* \[[^\]]+\]\((https:\/\/[^\s)]+)\)$/m)?.[1];
  if (!description || !source || !["no-category", "content", "overhaul", "tweaks", "utilities", "scenarios", "mod-packs", "localizations", "internal"].includes(category)) throw new Error("MOD_PORTAL.md needs Description, Category, and Source fields");
  if (!text.includes("- **License:** MIT")) throw new Error("The release listing must preserve the MIT license");
  if (!info.title?.trim() || !info.description?.trim() || info.description.length > 500 || !info.homepage) throw new Error("info.json needs a title, summary (max 500 characters), and homepage");
  return {title: info.title, summary: info.description, description, category, license: "default_mit", homepage: info.homepage, source_url: source};
}
export async function setVersion(root, version, note) {
  const info = await readInfo(root);
  if (compareVersions(version, info.version) <= 0) throw new Error(`New version must be greater than ${info.version}`);
  if (typeof note !== "string" || !note.trim() || /[\r\n]/.test(note)) throw new Error("Supply a non-empty, single-line changelog note");
  const changelog = await readFile(join(root, "changelog.txt"), "utf8");
  if (changelog.match(/^Version: (.+)$/m)?.[1] !== info.version) throw new Error("Changelog version differs from info.json; resolve it before changing versions");
  const updated = `${"-".repeat(99)}\nVersion: ${version}\n  Changes:\n    - ${note.trim()}\n${changelog}`;
  await writeFile(join(root, "changelog.txt"), updated);
  await writeFile(join(root, "info.json"), JSON.stringify({...info, version}, null, 4) + "\n");
  return version;
}
