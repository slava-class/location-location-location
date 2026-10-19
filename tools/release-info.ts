import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { compareVersions } from "./dependencies.ts";
import { withReleaseLock } from "./locks.ts";
import { BoundaryError, decode, Info, readJSON, Version } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";

const Nonblank = Schema.String.check(Schema.isPattern(/\S/u));
const ChangeNote = Schema.String.check(
  // oxlint-disable-next-line no-control-regex -- Reject NUL in authored release notes.
  Schema.isPattern(/^(?=[^\r\n\u0000]*\S)[^\r\n\u0000]+$(?![\s\S])/u),
);
export const Listing = Schema.Struct({
  title: Nonblank,
  summary: Nonblank.check(Schema.isMaxLength(500)),
  description: Nonblank,
  category: Schema.Literals([
    "no-category",
    "content",
    "overhaul",
    "tweaks",
    "utilities",
    "scenarios",
    "mod-packs",
    "localizations",
    "internal",
  ]),
  license: Schema.Literal("default_mit"),
  homepage: Nonblank,
  source_url: Schema.String.check(
    Schema.isPattern(/^https:\/\/[^\s)]+$(?![\s\S])/u),
  ),
});
export function readListing(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = (yield* fs.readFileString(
      join(project.modRoot, "MOD_PORTAL.md"),
    )).replace(/\r\n/g, "\n");
    const descriptions = text.split("\n## Description\n\n");
    if (descriptions.length !== 2 || !text.includes("- **License:** MIT"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Listing requires one Description section and the declared MIT license",
        }),
      );
    return yield* decode(
      Listing,
      {
        title: project.info.title,
        summary: project.info.description,
        description: descriptions[1]!.trim(),
        category: text.match(/^- \*\*Category:\*\* (.+)$/m)?.[1]?.toLowerCase(),
        license: "default_mit",
        homepage: project.info.homepage,
        source_url: text.match(
          /^- \*\*Source:\*\* \[[^\]]+\]\((https:\/\/[^\s)]+)\)$/m,
        )?.[1],
      },
      "release listing",
    );
  });
}
const VersionChange = Schema.Struct({
  schema: Schema.Literal(1),
  mod: Info.fields.name,
  previous: Version,
  version: Version,
  note: ChangeNote,
});
export function setVersion(
  project: ResolvedProject,
  newVersion: string,
  authoredNote: string,
) {
  return Effect.gen(function* () {
    const version = yield* decode(Version, newVersion, "new mod version"),
      note = yield* decode(ChangeNote, authoredNote, "changelog note");
    if (compareVersions(version, project.info.version) <= 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: `New version must be greater than ${project.info.version}`,
        }),
      );
    return yield* withReleaseLock(
      project,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          infoPath = join(project.modRoot, "info.json"),
          changelogPath = join(project.modRoot, "changelog.txt");
        const raw = yield* readJSON(
          Schema.Record(Schema.String, Schema.Json),
          infoPath,
        );
        const info = yield* decode(Info, raw, "current release metadata", true);
        if (
          info.name !== project.info.name ||
          info.version !== project.info.version
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message:
                "Resolved release target changed before version mutation",
            }),
          );
        const changelog = yield* fs.readFileString(changelogPath);
        if (changelog.match(/^Version: (.+)$/m)?.[1] !== info.version)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message:
                "Changelog and metadata disagree; resolve before versioning",
            }),
          );
        const updated = `${"-".repeat(99)}\nVersion: ${version}\n  Changes:\n    - ${note.trim()}\n${changelog}`;
        const next = { ...raw, version };
        yield* decode(Info, next, "new release metadata", true);
        // Preserve external info.json fields; the consumed Info projection must not rewrite them away.
        const infoPart = infoPath + ".part",
          changelogPart = changelogPath + ".part";
        yield* fs.writeFileString(
          infoPart,
          JSON.stringify(next, null, 4) + "\n",
          { flag: "wx" },
        );
        yield* fs.writeFileString(changelogPart, updated, { flag: "wx" });
        yield* fs.rename(changelogPart, changelogPath);
        yield* fs.rename(infoPart, infoPath);
        const actual = yield* readJSON(Info, infoPath, true);
        if (
          actual.version !== version ||
          (yield* fs.readFileString(changelogPath)) !== updated
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message:
                "Version mutation readback differs; inspect both files before another change",
            }),
          );
        return yield* decode(
          VersionChange,
          {
            schema: 1,
            mod: info.name,
            previous: info.version,
            version,
            note: note.trim(),
          },
          "version change",
        );
      }),
    );
  });
}
