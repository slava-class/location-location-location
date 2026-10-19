import { createHash } from "node:crypto";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
function luaQuote(value) {
  return (
    '"' +
    value.replace(/[\\"\p{Cc}]/gu, (char) => {
      const code = char.charCodeAt(0);
      // Decimal Lua escapes encode bytes; preserve non-ASCII Unicode as UTF-8.
      return code > 127 ? char : `\\${code.toString().padStart(3, "0")}`;
    }) +
    '"'
  );
}
export function luaValue(value) {
  if (value === null) return "nil";
  if (typeof value === "string") return luaQuote(value);
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return "{" + value.map(luaValue).join(",") + "}";
  return (
    "{" +
    Object.entries(value)
      .map(([key, entry]) => `[${luaQuote(key)}]=${luaValue(entry)}`)
      .join(",") +
    "}"
  );
}
