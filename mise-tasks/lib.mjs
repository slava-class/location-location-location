import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function luaQuote(value) {
  return '"' + value.replace(/[\\"\x00-\x1f\x7f]/g, char => `\\${char.charCodeAt(0).toString().padStart(3, "0")}`) + '"';
}
export function luaValue(value) {
  if (value === null) return "nil";
  if (typeof value === "string") return luaQuote(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return "{" + value.map(luaValue).join(",") + "}";
  return "{" + Object.entries(value).map(([key, entry]) => `[${luaQuote(key)}]=${luaValue(entry)}`).join(",") + "}";
}

export async function helperSource() {
  const manifest = await Bun.file(resolve(root, ".factorio-test/source-manifest.json")).json();
  const source = await Bun.file(resolve(root, ".factorio-test/py-add-to-description.lua")).text();
  if (sha256(source) !== manifest.helperSha256) throw new Error("Py helper checksum changed; run mise run setup");
  return "local py = {}\n" + source + "\n";
}

export async function runLua(source) {
  const process = Bun.spawn(["lua", "-"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  process.stdin.write(source);
  await process.stdin.end();
  const [stdout, stderr, status] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (status !== 0) throw new Error(`Lua exited ${status}\n${stderr}\n${stdout}`);
  return stdout;
}
