import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { ModIdentity } from "./contracts.ts";
import { BoundaryError, decode } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { packageInventory } from "./packaging.ts";
import { invokeProjectTool, projectTooling } from "./project-tooling.ts";

function invalid(boundary: string, message: string): never {
  throw new BoundaryError({ boundary, message });
}
export function parseLocale(text: string, name = "locale") {
  const entries = new Map<string, string>();
  let section = "";
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      section = line.slice(1, -1);
      continue;
    }
    const equals = line.indexOf("=");
    if (!section || equals < 1)
      invalid(name, `Line ${index + 1}: malformed locale entry`);
    const key = section + "." + line.slice(0, equals).trim(),
      value = line.slice(equals + 1);
    if (!value.trim()) invalid(name, `Empty ${key}`);
    if (entries.has(key)) invalid(name, `Duplicate ${key}`);
    const stack: string[] = [];
    for (const token of value.matchAll(/\[(\/?)(font|color)(?:=[^\]]+)?\]/g)) {
      if (token[1]) {
        if (stack.pop() !== token[2])
          invalid(name, `Unbalanced rich text in ${key}`);
      } else stack.push(token[2]!);
    }
    if (stack.length) invalid(name, `Unbalanced rich text in ${key}`);
    if (
      value.includes("__plural_for_parameter__") &&
      !/__plural_for_parameter__[0-9]+__\{[^}]+\}__/.test(value)
    )
      invalid(name, `Malformed plural in ${key}`);
    entries.set(key, value);
  }
  return entries;
}
const tokens = (text: string, pattern: RegExp) =>
  [...new Set([...text.matchAll(pattern)].map((match) => match[0]))]
    .sort()
    .join("|");
export function validateParity(
  reference: ReadonlyMap<string, string>,
  translated: ReadonlyMap<string, string>,
  name: string,
) {
  for (const [key, english] of reference) {
    const value = translated.get(key);
    if (value === undefined) invalid(name, `Missing ${key}`);
    for (const pattern of [/__[0-9]+__/g, /__CONTROL__.+?__/g])
      if (tokens(english, pattern) !== tokens(value, pattern))
        invalid(name, `Parameter/control mismatch in ${key}`);
  }
  for (const key of translated.keys())
    if (!reference.has(key)) invalid(name, `Unexpected ${key}`);
}
export const AuditResult = Schema.Struct({
  mod: ModIdentity,
  languages: Schema.Array(Schema.String),
  localeKeys: Schema.Int,
  projectAudit: Schema.Boolean,
});
export function auditProject(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      members = yield* packageInventory(project);
    const changelog = yield* fs.readFileString(
      join(project.modRoot, "changelog.txt"),
    );
    if (changelog.match(/^Version: (.+)$/m)?.[1] !== project.info.version)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Changelog version differs from canonical metadata",
        }),
      );
    const locales = new Map<string, Map<string, string>>();
    for (const language of project.locales) {
      const merged = new Map<string, string>();
      for (const member of members.filter(
        (name) =>
          name.startsWith("locale/" + language + "/") && name.endsWith(".cfg"),
      )) {
        const text = yield* fs.readFileString(join(project.modRoot, member));
        const entries = yield* Effect.try({
          try: () => parseLocale(text, member),
          catch: (error) =>
            error instanceof BoundaryError
              ? error
              : new BoundaryError({
                  boundary: member,
                  message: "Locale parser failed",
                }),
        });
        for (const [key, value] of entries) {
          if (merged.has(key))
            return yield* Effect.fail(
              new BoundaryError({
                boundary: language,
                message: `Duplicate locale key across files: ${key}`,
              }),
            );
          merged.set(key, value);
        }
      }
      locales.set(language, merged);
    }
    const english = locales.get("en") ?? new Map<string, string>();
    if (locales.size > 0 && !locales.has("en"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Localized projects require an English reference locale",
        }),
      );
    for (const [language, entries] of locales)
      yield* Effect.try({
        try: () => validateParity(english, entries, language),
        catch: (error) =>
          error instanceof BoundaryError
            ? error
            : new BoundaryError({
                boundary: language,
                message: "Locale parity failed",
              }),
      });
    const { audit } = yield* projectTooling(project);
    const hasHook = audit !== undefined;
    if (audit !== undefined)
      yield* invokeProjectTool(
        audit,
        { project, members, english },
        `${project.info.name} audit`,
      );
    return yield* decode(
      AuditResult,
      {
        mod: { name: project.info.name, version: project.info.version },
        languages: [...locales.keys()],
        localeKeys: english.size,
        projectAudit: hasHook,
      },
      "project audit result",
    );
  });
}
