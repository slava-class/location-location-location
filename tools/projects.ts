import { Data, Effect, FileSystem, Schema } from "effect";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

export class BoundaryError extends Data.TaggedError("BoundaryError")<{
  readonly boundary: string;
  readonly message: string;
}> {}

const isNotSymbolicLink = Schema.is(
  Schema.Struct({
    code: Schema.Literal("EINVAL"),
    syscall: Schema.Literal("readlink"),
  }),
);

/** Reject existing or dangling aliases without creating missing output paths. */
export function assertCanonicalPath(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fail = () =>
      new BoundaryError({
        boundary: path,
        message:
          "Generated output must use a canonical absolute path without filesystem aliases",
      });
    if (!isAbsolute(path) || resolve(path) !== path)
      return yield* Effect.fail(fail());
    let ancestor = path;
    while (true) {
      const actual = yield* fs
        .realPath(ancestor)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(undefined)
              : Effect.fail(error),
          ),
        );
      if (actual !== undefined) {
        if (actual !== ancestor) return yield* Effect.fail(fail());
        return;
      }
      // A regular entry can appear after realPath misses it. readlink's EINVAL
      // means "not a symlink"; we must still validate its ancestors below.
      // Dangling links remain detectable even though realPath cannot resolve them.
      const link = yield* fs
        .readLink(ancestor)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound" ||
            isNotSymbolicLink(error.reason.cause)
              ? Effect.succeed(undefined)
              : Effect.fail(error),
          ),
        );
      if (link !== undefined) return yield* Effect.fail(fail());
      const parent = dirname(ancestor);
      if (parent === ancestor) return yield* Effect.fail(fail());
      ancestor = parent;
    }
  });
}
export function prepareOutputDirectory(path: string) {
  return Effect.gen(function* () {
    yield* assertCanonicalPath(path);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path, { recursive: true });
    yield* assertCanonicalPath(path);
  });
}
export const ModId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,100}$(?![\s\S])/u),
);
const versionComponent =
  "(?:0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])";
export const Version = Schema.String.check(
  Schema.isPattern(
    new RegExp(
      `^${versionComponent}\\.${versionComponent}\\.${versionComponent}$(?![\\s\\S])`,
      "u",
    ),
  ),
);
export const Info = Schema.Struct({
  name: ModId,
  version: Version,
  title: Schema.NonEmptyString,
  author: Schema.NonEmptyString,
  factorio_version: Schema.String.check(
    Schema.isPattern(/^[0-9]+\.[0-9]+$(?![\s\S])/u),
  ),
  dependencies: Schema.Array(Schema.NonEmptyString),
  description: Schema.NonEmptyString,
  homepage: Schema.optionalKey(Schema.NonEmptyString),
});
export type ModInfo = typeof Info.Type;
const relativeSegment = "(?!(?:\\.|\\.\\.)(?:/|$))[^/\\\\\\r\\n\\u0000:]+";
export const RelativePath = Schema.String.check(
  Schema.isPattern(
    new RegExp(`^${relativeSegment}(?:/${relativeSegment})*$(?![\\s\\S])`, "u"),
  ),
);
export const LuaTypeName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_.]*$(?![\s\S])/u),
);
export const Locale = Schema.String.check(
  Schema.isPattern(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$(?![\s\S])/u),
);
export const TestProfile = Schema.Literals([
  "base",
  "space-age",
  "py-hardmode",
]);
export const TunerId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,47}$(?![\s\S])/u),
);
const CaptureProfile = Schema.Literals(["native", "gallery"]);
export const Profile = Schema.Literals([
  ...TestProfile.literals,
  ...CaptureProfile.literals,
]);
export type ProfileName = typeof Profile.Type;
const NativeScene = Schema.Struct({
  name: Schema.NonEmptyString,
  file: RelativePath,
});
const DevConfig = Schema.Struct({
  visual: Schema.optionalKey(Schema.Boolean),
  verification: Schema.optionalKey(Schema.Literals(["engine", "offline"])),
  profiles: Schema.optionalKey(Schema.Array(TestProfile)),
  persistence: Schema.optionalKey(Schema.Literals(["stateful", "stateless"])),
  storageType: Schema.optionalKey(LuaTypeName),
  flibStyleType: Schema.optionalKey(LuaTypeName),
  luaTypecheckIgnore: Schema.optionalKey(Schema.Array(RelativePath)),
  native: Schema.optionalKey(
    Schema.Struct({
      suite: Schema.NonEmptyString,
      scenes: Schema.Array(NativeScene),
      gallerySuite: Schema.NonEmptyString,
      gallery: Schema.Array(NativeScene),
      gallerySelection: Schema.Array(RelativePath),
    }),
  ),
  packageExtras: Schema.optionalKey(Schema.Array(RelativePath)),
  companions: Schema.optionalKey(Schema.Array(ModId)),
  verificationDependencies: Schema.optionalKey(Schema.Array(ModId)),
  performance: Schema.optionalKey(RelativePath),
  tuners: Schema.optionalKey(Schema.Array(TunerId)),
});
export type DevelopmentConfig = typeof DevConfig.Type;
export const Capabilities = Schema.Struct({
  runtime: Schema.Boolean,
  prototypes: Schema.Boolean,
  settings: Schema.Boolean,
  visual: Schema.Literals(["present", "absent", "undeclared"]),
  persistence: Schema.Literals(["stateful", "stateless", "undeclared"]),
  verification: Schema.Literals(["engine", "offline"]),
  profiles: Schema.Array(TestProfile),
});
const Workspace = Schema.Struct({
  repoRoot: Schema.NonEmptyString,
  outputRoot: Schema.NonEmptyString,
});
export type ResolvedWorkspace = typeof Workspace.Type;
export const Project = Schema.Struct({
  ...Workspace.fields,
  modRoot: Schema.NonEmptyString,
  info: Info,
  development: DevConfig,
  locales: Schema.Array(Locale),
  entrypoints: Schema.Array(RelativePath),
  capabilities: Capabilities,
});
export type ResolvedProject = typeof Project.Type;
const ProjectSelection = Schema.Struct({
  companions: Schema.optionalKey(Schema.Array(ModId)),
});
export type ExecutionContext = ResolvedProject | ResolvedWorkspace;
export function resolveWorkspace(repository: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      repoRoot = yield* fs.realPath(repository);
    yield* readJSON(
      Schema.Struct({
        private: Schema.Literal(true),
        type: Schema.Literal("module"),
      }),
      join(repoRoot, "package.json"),
      true,
    );
    const outputRoot = join(repoRoot, ".factorio-test", "workspace");
    yield* assertCanonicalPath(outputRoot);
    return yield* decode(
      Workspace,
      { repoRoot, outputRoot },
      "resolved workspace",
    );
  });
}

export function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
  boundary: string,
  external = false,
) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(schema, {
        onExcessProperty: external ? "ignore" : "error",
      })(value),
    catch: () =>
      new BoundaryError({
        boundary,
        message: `Invalid ${boundary}; input does not satisfy its schema`,
      }),
  });
}
export function decodeJSON<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  bytes: Uint8Array,
  boundary: string,
  external = false,
) {
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: (): unknown =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      catch: () =>
        new BoundaryError({ boundary, message: "Invalid UTF-8 JSON" }),
    });
    return yield* decode(schema, value, boundary, external);
  });
}
export function readJSON<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
  external = false,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(path);
    if (stat.type !== "File" || Number(stat.size) > 16 * 1024 * 1024)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message:
            "JSON boundary requires a regular file no larger than 16 MiB",
        }),
      );
    return yield* decodeJSON(schema, yield* fs.readFile(path), path, external);
  });
}
export function contains(root: string, path: string) {
  const child = relative(root, path);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(".." + sep))
  );
}
const entrypoints = [
  "control.lua",
  "data.lua",
  "data-updates.lua",
  "data-final-fixes.lua",
  "settings.lua",
  "settings-updates.lua",
  "settings-final-fixes.lua",
];

export function discoverProjects(repository: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const repoRoot = yield* fs.realPath(repository);
    const modsRoot = join(repoRoot, "mods");
    const names = [...(yield* fs.readDirectory(modsRoot))].sort();
    const projects: ResolvedProject[] = [];
    const seen = new Set<string>();
    for (const directory of names) {
      const candidate = join(modsRoot, directory);
      const stat = yield* fs.stat(candidate);
      if (stat.type !== "Directory") continue;
      projects.push(yield* loadProject(repoRoot, candidate, seen));
    }
    return projects;
  });
}
function loadProject(
  repoRoot: string,
  candidate: string,
  seen?: Set<string>,
  additionalCompanions?: readonly string[],
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const modsRoot = join(repoRoot, "mods");
    const modRoot = yield* fs.realPath(candidate);
    if (!contains(modsRoot, modRoot))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: candidate,
          message: "Mod directory escapes the workspace",
        }),
      );
    if (candidate !== modRoot)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: candidate,
          message: "Workspace mod roots cannot be symlinks or aliases",
        }),
      );
    const info = yield* readJSON(Info, join(modRoot, "info.json"), true);
    if (seen?.has(info.name))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modRoot,
          message: `Duplicate mod identity: ${info.name}`,
        }),
      );
    if (basename(modRoot) !== info.name)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modRoot,
          message: `Directory must match canonical mod ID ${info.name}`,
        }),
      );
    seen?.add(info.name);
    let development: DevelopmentConfig = {};
    const configPath = join(modRoot, "dev.config.ts");
    if (yield* fs.exists(configPath)) {
      const imported = yield* Effect.tryPromise({
        try: () => import(pathToFileURL(configPath).href),
        catch: () =>
          new BoundaryError({
            boundary: configPath,
            message: "Cannot import trusted development configuration",
          }),
      });
      development = yield* decode(DevConfig, imported.default, configPath);
    }
    if (additionalCompanions !== undefined && additionalCompanions.length !== 0)
      development = {
        ...development,
        companions: [
          ...(development.companions ?? []),
          ...additionalCompanions,
        ],
      };
    const found: string[] = [];
    for (const entry of entrypoints)
      if (yield* fs.exists(join(modRoot, entry))) found.push(entry);
    const localeRoot = join(modRoot, "locale");
    const locales: string[] = [];
    if (yield* fs.exists(localeRoot)) {
      for (const locale of [...(yield* fs.readDirectory(localeRoot))].sort())
        if ((yield* fs.stat(join(localeRoot, locale))).type === "Directory")
          locales.push(locale);
    }
    const runtime = found.includes("control.lua");
    const capabilities = yield* decode(
      Capabilities,
      {
        runtime,
        prototypes: found.some((path) => path.startsWith("data")),
        settings: found.some((path) => path.startsWith("settings")),
        visual:
          development.visual === true || development.native !== undefined
            ? "present"
            : development.visual === false
              ? "absent"
              : "undeclared",
        persistence:
          development.persistence ?? (runtime ? "undeclared" : "stateless"),
        verification: development.verification ?? "engine",
        profiles:
          development.verification === "offline"
            ? []
            : (development.profiles ?? ["base"]),
      },
      `capabilities for ${info.name}`,
    );
    if (
      new Set(capabilities.profiles).size !== capabilities.profiles.length ||
      (capabilities.verification === "engine" &&
        capabilities.profiles.length === 0)
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modRoot,
          message: "Engine profiles must be nonempty and unique",
        }),
      );
    if (
      development.verification === "offline" &&
      (development.profiles?.length ?? 0) !== 0
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modRoot,
          message:
            "Offline-only verification contradicts declared engine profiles",
        }),
      );
    const companions = development.companions ?? [];
    if (
      companions.includes(info.name) ||
      new Set(companions).size !== companions.length
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modRoot,
          message:
            "Test companions must be unique and cannot include the primary mod",
        }),
      );
    if (development.visual === false && development.native !== undefined)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: modRoot,
          message: "Native scenes contradict visual:false",
        }),
      );
    if (development.native) {
      const native = development.native;
      for (const scenes of [native.scenes, native.gallery])
        if (
          new Set(scenes.map((scene) => scene.name)).size !== scenes.length ||
          new Set(scenes.map((scene) => scene.file)).size !== scenes.length
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: modRoot,
              message: "Native scene names and capture paths must be unique",
            }),
          );
      if (
        native.scenes.length === 0 ||
        native.gallerySelection.some(
          (file) => !native.gallery.some((scene) => scene.file === file),
        ) ||
        new Set(native.gallerySelection).size !== native.gallerySelection.length
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: modRoot,
            message: "Native coverage or gallery selection is invalid",
          }),
        );
    }
    const outputRoot = join(repoRoot, ".factorio-test", "projects", info.name);
    yield* assertCanonicalPath(outputRoot);
    return yield* decode(
      Project,
      {
        repoRoot,
        modRoot,
        outputRoot,
        info,
        development,
        locales,
        entrypoints: found,
        capabilities,
      },
      `resolved project ${info.name}`,
    );
  });
}
export function resolveProject(
  repository: string,
  target: string,
  cwd: string,
  options: typeof ProjectSelection.Type = {},
) {
  return Effect.gen(function* () {
    const selection = yield* decode(
      ProjectSelection,
      options,
      "project selection",
    );
    if (!target.trim())
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "target",
          message: "Supply an exact mod ID or path; no default mod is selected",
        }),
      );
    const fs = yield* FileSystem.FileSystem;
    const repoRoot = yield* fs.realPath(repository),
      modsRoot = join(repoRoot, "mods");
    const explicitPath =
      isAbsolute(target) || target.startsWith(".") || target.includes("/");
    if (!explicitPath) yield* decode(ModId, target, "mod target");
    const requested = explicitPath
      ? resolve(cwd, target)
      : join(modsRoot, target);
    if (!(yield* fs.exists(requested)))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "target",
          message: `Unknown mod target: ${target}`,
        }),
      );
    const actual = yield* fs.realPath(requested);
    if (
      !contains(modsRoot, actual) ||
      relative(modsRoot, actual).includes(sep) ||
      actual === modsRoot
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "target",
          message: "Target is not a direct workspace mod root",
        }),
      );
    if ((yield* fs.stat(actual)).type !== "Directory")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "target",
          message: "Target is not a mod directory",
        }),
      );
    const project = yield* loadProject(
      repoRoot,
      join(yield* fs.realPath(dirname(requested)), basename(requested)),
      undefined,
      selection.companions,
    );
    for (const id of selection.companions ?? []) {
      const candidate = join(modsRoot, id);
      if (!(yield* fs.exists(candidate)))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: "companion",
            message: `Unknown companion mod: ${id}`,
          }),
        );
      yield* loadProject(repoRoot, candidate);
    }
    return project;
  });
}
