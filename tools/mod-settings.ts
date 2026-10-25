import { Effect } from "effect";
import { decode, Version } from "./projects.ts";

const scopes = ["startup", "runtime-global", "runtime-per-user"] as const;
const byteLength =
  15 + scopes.reduce((size, scope) => size + 8 + scope.length, 0);

/** Only empty scopes: Factorio still evaluates prototypes and supplies every default.
 * Format: https://wiki.factorio.com/Mod_settings_file_format
 * Dictionaries: https://wiki.factorio.com/Property_tree
 */
export function emptyModSettings(engineVersion: string) {
  return Effect.gen(function* () {
    const version = yield* decode(
      Version,
      engineVersion,
      "mod settings engine version",
    );
    const bytes = Buffer.alloc(byteLength);
    for (const [index, component] of version.split(".").entries())
      bytes.writeUInt16LE(Number(component), index * 2);
    // The fourth uint16 is the developer version, not the executable's build number.
    bytes[9] = 5;
    bytes.writeUInt32LE(scopes.length, 11);
    let offset = 15;
    for (const scope of scopes) {
      // Nonempty ASCII key with a one-byte compact length, followed by an empty dictionary.
      bytes[offset + 1] = scope.length;
      bytes.write(scope, offset + 2, "utf8");
      offset += scope.length + 2;
      bytes[offset] = 5;
      offset += 6;
    }
    return bytes;
  });
}
