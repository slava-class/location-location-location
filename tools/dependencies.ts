import { Effect, FileSystem, Schema } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import dependencyInputs from "../.config/factorio-dependencies.json";
import { AbsolutePath, ModIdentity, Sha256 } from "./contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  ModId,
  readJSON,
  resolveProject,
  Version,
} from "./projects.ts";
import type {
  ExecutionContext,
  ProfileName,
  ResolvedProject,
} from "./projects.ts";
import { getBytes, getJSON } from "./network.ts";
import { provisionPinnedFile, verifyPinnedFile } from "./files.ts";
import { inspectArchive } from "./packaging.ts";

const Dependency = Schema.Struct({
  name: ModId,
  kind: Schema.Literals([
    "required",
    "optional",
    "recommended",
    "hidden-optional",
    "incompatible",
    "no-order",
  ]),
  operator: Schema.NullOr(Schema.Literals([">=", "<=", ">", "<", "="])),
  version: Schema.NullOr(Version),
});
export type Requirement = typeof Dependency.Type;
const DependencyPin = Schema.Struct({
  name: ModId,
  version: Version,
  sha256: Sha256,
});
export type Pin = typeof DependencyPin.Type;
const dependencyPins = Schema.decodeUnknownSync(Schema.Array(DependencyPin))(
  dependencyInputs,
);
export const builtins = new Set([
  "base",
  "quality",
  "elevated-rails",
  "space-age",
  "recycler",
]);

/** External roots; expansion modules are discovered from the selected engine. */
export const profileDependencies: Readonly<
  Record<ProfileName, readonly string[]>
> = {
  base: [],
  "space-age": [],
  "py-hardmode": ["pyhardmode", "enable-all-feature-flags"],
  native: [],
  gallery: [],
};
export function parseDependency(text: string) {
  return Effect.gen(function* () {
    const match =
      /^\s*(?:(\(\?\)|[?!~+])\s*)?([A-Za-z0-9_-]+)(?:\s*(>=|<=|=|>|<)\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?))?\s*$/u.exec(
        text,
      );
    if (!match)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "dependency",
          message: "Unsupported Factorio dependency declaration",
        }),
      );
    const prefix = match[1];
    return yield* decode(
      Dependency,
      {
        name: match[2],
        kind:
          prefix === "?"
            ? "optional"
            : prefix === "+"
              ? "recommended"
              : prefix === "(?)"
                ? "hidden-optional"
                : prefix === "!"
                  ? "incompatible"
                  : prefix === "~"
                    ? "no-order"
                    : "required",
        operator: match[3] ?? null,
        version:
          match[4] === undefined
            ? null
            : match[4].split(".").length === 2
              ? `${match[4]}.0`
              : match[4],
      },
      "dependency",
    );
  });
}
export function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number),
    b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const delta = a[index]! - b[index]!;
    if (delta) return Math.sign(delta);
  }
  return 0;
}
export function satisfies(version: string, requirement: Requirement) {
  if (requirement.kind === "incompatible") return false;
  if (requirement.version === null) return true;
  const order = compareVersions(version, requirement.version);
  switch (requirement.operator) {
    case ">=":
      return order >= 0;
    case ">":
      return order > 0;
    case "<=":
      return order <= 0;
    case "<":
      return order < 0;
    case "=":
      return order === 0;
    case null:
      return false;
  }
}
export function requirements(project: ResolvedProject) {
  return Effect.forEach(project.info.dependencies, parseDependency);
}
/** Runtime libraries consumed by the shared Lua type generator. */
export function luaTypeRequirements(items: readonly Requirement[]) {
  return items.filter(
    (item) =>
      item.name === "flib" &&
      (item.kind === "required" || item.kind === "no-order"),
  );
}
export function engineFloor(project: ResolvedProject) {
  return Effect.gen(function* () {
    const base = (yield* requirements(project)).filter(
      (item) => item.name === "base",
    );
    const requirement = base[0];
    if (
      base.length !== 1 ||
      !requirement ||
      requirement.kind !== "required" ||
      requirement.operator !== ">=" ||
      requirement.version === null
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Owned mods must declare one explicit base >= minimum-version dependency",
        }),
      );
    if (!requirement.version.startsWith(project.info.factorio_version + "."))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message: "Engine floor and factorio_version disagree",
        }),
      );
    return requirement.version;
  });
}
const Credentials = Schema.Struct({
  "service-username": Schema.NonEmptyString,
  "service-token": Schema.NonEmptyString,
});
const PortalReleases = Schema.Struct({
  releases: Schema.Array(
    Schema.Struct({ version: Version, download_url: Schema.NonEmptyString }),
  ),
});
function dependencyPath(project: ExecutionContext, pin: Pin) {
  return join(
    project.repoRoot,
    ".factorio-test",
    "cache",
    "dependencies",
    `${pin.name}_${pin.version}.zip`,
  );
}

/** Read-only resolution: no credentials, downloads or cache creation. */
export function resolveDependency(project: ExecutionContext, pin: Pin) {
  return Effect.gen(function* () {
    yield* decode(DependencyPin, pin, "dependency pin");
    return yield* verifyPinnedFile(
      {
        path: dependencyPath(project, pin),
        sha256: pin.sha256,
        maxBytes: 256 * 1024 * 1024,
      },
      "dependencies-provision with the selected mod or --all",
    );
  });
}

function downloadDependency(pin: Pin) {
  return Effect.gen(function* () {
    if (process.platform !== "darwin" && process.platform !== "linux")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: pin.name,
          message:
            "Credential path discovery is supported on macOS and Linux only",
        }),
      );
    const credentialsPath =
      process.platform === "darwin"
        ? join(
            homedir(),
            "Library",
            "Application Support",
            "factorio",
            "player-data.json",
          )
        : join(homedir(), ".factorio", "player-data.json");
    const credentials = yield* readJSON(Credentials, credentialsPath, true);
    const metadata = yield* getJSON(
      PortalReleases,
      `https://mods.factorio.com/api/mods/${pin.name}`,
      pin.name + " releases",
    );
    const matches = metadata.releases.filter(
      (release) => release.version === pin.version,
    );
    const release = matches[0];
    if (matches.length !== 1 || !release)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: pin.name,
          message: "Pinned release is missing or ambiguous",
        }),
      );
    const url = yield* Effect.try({
      try: () => new URL(release.download_url, "https://mods.factorio.com"),
      catch: () =>
        new BoundaryError({
          boundary: pin.name,
          message: "Invalid Portal download path",
        }),
    });
    if (
      url.origin !== "https://mods.factorio.com" ||
      !url.pathname.startsWith("/download/")
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: pin.name,
          message: "Portal supplied an unexpected download origin or path",
        }),
      );
    url.searchParams.set("username", credentials["service-username"]);
    url.searchParams.set("token", credentials["service-token"]);
    return yield* getBytes(
      url.href,
      `${pin.name} ${pin.version}`,
      256 * 1024 * 1024,
      { origin: "factorio", redirects: true },
    );
  });
}

/** Explicit provisioning; a supplied archive never falls back to the network. */
export function provisionDependency(
  project: ExecutionContext,
  pin: Pin,
  archive?: string,
) {
  return Effect.gen(function* () {
    yield* decode(DependencyPin, pin, "dependency pin");
    if (archive !== undefined) {
      yield* decode(AbsolutePath, archive, "dependency archive");
      yield* assertCanonicalPath(archive);
    }
    const fs = yield* FileSystem.FileSystem;
    const load =
      archive === undefined
        ? downloadDependency(pin)
        : Effect.gen(function* () {
            const stat = yield* fs.stat(archive);
            if (stat.type !== "File" || stat.size > 256n * 1024n * 1024n)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: pin.name,
                  message: "Dependency source is not a bounded regular archive",
                }),
              );
            return yield* fs.readFile(archive);
          });
    return yield* provisionPinnedFile(
      {
        path: dependencyPath(project, pin),
        sha256: pin.sha256,
        maxBytes: 256 * 1024 * 1024,
      },
      load,
    );
  });
}

const ProvisionResult = Schema.Struct({
  mod: ModIdentity,
  scope: Schema.Literals(["engine-verification", "offline-tooling"]),
  runtimeNotProvisioned: Schema.Array(
    Schema.Struct({ mod: ModId, dependency: Dependency }),
  ),
  archives: Schema.Array(
    Schema.Struct({ ...DependencyPin.fields, path: AbsolutePath }),
  ),
});

/** Provision declared verification inputs, reporting offline runtime exclusions explicitly. */
export function provisionDependencies(
  project: ResolvedProject,
  archivesDirectory?: string,
) {
  return Effect.gen(function* () {
    if (archivesDirectory !== undefined) {
      yield* decode(
        AbsolutePath,
        archivesDirectory,
        "dependency archives directory",
      );
      yield* assertCanonicalPath(archivesDirectory);
    }
    const projects = new Map([[project.info.name, project]]);
    const pendingProjects = [project];
    for (let index = 0; index < pendingProjects.length; index++) {
      for (const id of pendingProjects[index]!.development.companions ?? []) {
        if (projects.has(id)) continue;
        const companion = yield* resolveProject(
          project.repoRoot,
          id,
          project.repoRoot,
        );
        projects.set(id, companion);
        pendingProjects.push(companion);
      }
    }
    const runtime = project.capabilities.verification === "engine";
    const pending: Requirement[] = [];
    const runtimeNotProvisioned: (typeof ProvisionResult.Type)["runtimeNotProvisioned"][number][] =
      [];
    for (const item of pendingProjects) {
      const declared = yield* requirements(item);
      const selected = runtime ? declared : luaTypeRequirements(declared);
      pending.push(...selected);
      if (runtime)
        pending.push(
          ...(yield* Effect.forEach(
            item.development.verificationDependencies ?? [],
            parseDependency,
          )),
        );
      if (!runtime)
        for (const dependency of declared) {
          if (
            (dependency.kind === "required" ||
              dependency.kind === "no-order") &&
            !builtins.has(dependency.name) &&
            !selected.includes(dependency)
          )
            runtimeNotProvisioned.push({ mod: item.info.name, dependency });
        }
    }
    if (runtime) {
      pending.push(yield* parseDependency("factorio-test"));
      for (const profile of project.capabilities.profiles)
        for (const declaration of profileDependencies[profile])
          pending.push(yield* parseDependency(declaration));
    }
    const archives = new Map<
      string,
      (typeof ProvisionResult.Type)["archives"][number]
    >();
    for (let index = 0; index < pending.length; index++) {
      const requirement = pending[index]!;
      if (
        (requirement.kind !== "required" && requirement.kind !== "no-order") ||
        builtins.has(requirement.name)
      )
        continue;
      const companion = projects.get(requirement.name);
      const pin = companion ? null : yield* dependencyPin(requirement.name);
      const version = companion?.info.version ?? pin!.version;
      if (!satisfies(version, requirement))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: requirement.name,
            message:
              "Pinned or companion version contradicts required dependency",
          }),
        );
      if (companion || archives.has(requirement.name)) continue;
      const selected = pin!;
      const path = yield* provisionDependency(
        project,
        selected,
        archivesDirectory === undefined
          ? undefined
          : join(archivesDirectory, `${selected.name}_${selected.version}.zip`),
      );
      const metadata = yield* inspectArchive(path, selected.sha256);
      if (
        metadata.mod.name !== selected.name ||
        metadata.mod.version !== selected.version
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: selected.name,
            message: "Pinned ZIP metadata does not match its pin",
          }),
        );
      archives.set(selected.name, { ...selected, path });
      pending.push(
        ...(yield* Effect.forEach(metadata.dependencies, parseDependency)),
      );
    }
    return yield* decode(
      ProvisionResult,
      {
        mod: { name: project.info.name, version: project.info.version },
        scope: runtime ? "engine-verification" : "offline-tooling",
        runtimeNotProvisioned,
        archives: [...archives.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      },
      "dependency provisioning result",
    );
  });
}
export function dependencyPin(name: string) {
  const pin = dependencyPins.find((item) => item.name === name);
  return pin
    ? Effect.succeed(pin)
    : Effect.fail(
        new BoundaryError({
          boundary: name,
          message: "Dependency has no reviewed exact-version/checksum pin",
        }),
      );
}
