export function luaString(value: string) {
  let literal = '"';
  for (const byte of Buffer.from(value, "utf8"))
    literal +=
      byte >= 32 && byte <= 126 && byte !== 34 && byte !== 92
        ? String.fromCharCode(byte)
        : "\\" + String(byte).padStart(3, "0");
  return literal + '"';
}
