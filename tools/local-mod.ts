import { Cause, Effect, Exit, FileSystem, Schema, Stream } from "effect";
import { basename, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { AbsolutePath, ArchiveResult, Sha256 } from "./contracts.ts";
import { runCommand } from "./commands.ts";
import { hashFile } from "./files.ts";
import { withOwnedLock } from "./locks.ts";
import { inspectArchive } from "./packaging.ts";
import {
  BoundaryError,
  contains,
  decode,
  ModId,
  readJSON,
  RelativePath,
  Version,
} from "./projects.ts";
import type { ResolvedWorkspace } from "./projects.ts";

const TargetMod = ModId.check(Schema.isPattern(/^(?!(?:base|core)$).+$/u));
const ModEntry = Schema.StructWithRest(
  Schema.Struct({
    name: ModId,
    enabled: Schema.Boolean,
    version: Schema.optionalKey(Version),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const ModList = Schema.StructWithRest(
  Schema.Struct({ mods: Schema.Array(ModEntry) }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const ArchiveFile = Schema.Struct({
  file: RelativePath,
  version: Version,
  sha256: Sha256,
});
const Snapshot = Schema.Struct({
  entry: Schema.NullOr(ModEntry),
  files: Schema.Array(ArchiveFile),
});
const Incoming = Schema.Struct({
  name: TargetMod,
  version: Version,
  factorio_version: ArchiveResult.fields.factorio_version,
  dependencies: ArchiveResult.fields.dependencies,
  file: RelativePath,
  sha256: Sha256,
});
const ProtectedFiles = Schema.Record(AbsolutePath, Schema.NullOr(Sha256));
const Summary = Schema.Struct({
  action: Schema.Literals(["load", "unload"]),
  profile: AbsolutePath,
  save: AbsolutePath,
  mod: TargetMod,
  incoming: Schema.NullOr(Incoming),
  before: Snapshot,
  after: Snapshot,
});
const InstallationResult = Schema.Union([
  Schema.Struct({
    ...Summary.fields,
    outcome: Schema.Literals(["unchanged", "preview"]),
  }),
  Schema.Struct({
    ...Summary.fields,
    outcome: Schema.Literal("applied"),
    receipt: AbsolutePath,
    save_backup: AbsolutePath,
    preserved_save_sha256: Sha256,
    restore_argv: Schema.Array(Schema.String),
    note: Schema.NonEmptyString,
  }),
]);
const InstallationReceipt = Schema.Struct({
  format: Schema.Literal(1),
  state: Schema.Literals([
    "prepared",
    "applied",
    "rolled-back",
    "interrupted",
    "restored",
  ]),
  action: Summary.fields.action,
  profile: AbsolutePath,
  mod: TargetMod,
  incoming: Schema.NullOr(Incoming),
  before: Snapshot,
  after: Snapshot,
  save: Schema.Struct({
    path: AbsolutePath,
    backup: AbsolutePath,
    sha256: Sha256,
  }),
  protected: ProtectedFiles,
  restore_argv: Schema.Array(Schema.String),
  error: Schema.optionalKey(Schema.String),
  restored_at: Schema.optionalKey(Schema.String),
});
const RestoreSummary = Schema.Struct({
  action: Schema.Literal("restore"),
  mod: TargetMod,
  profile: AbsolutePath,
  before: Snapshot,
  after: Snapshot,
  save_backup: AbsolutePath,
  note: Schema.NonEmptyString,
});
const RestorationResult = Schema.Union([
  Schema.Struct({
    ...RestoreSummary.fields,
    outcome: Schema.Literal("preview"),
  }),
  Schema.Struct({
    ...RestoreSummary.fields,
    outcome: Schema.Literal("restored"),
    receipt: AbsolutePath,
  }),
]);
const ModStatus = Schema.Struct({
  action: Schema.Literal("status"),
  profile: AbsolutePath,
  mod: TargetMod,
  ...Snapshot.fields,
});
const InstallationOptions = Schema.Struct({
  profile: Schema.optionalKey(Schema.NonEmptyString),
  dryRun: Schema.Boolean,
});
type InstallOptions = typeof InstallationOptions.Type;

function profilePath(value?: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (value === undefined && process.platform !== "darwin")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "profile",
          message: "Specify --profile on non-macOS hosts",
        }),
      );
    const profile = yield* fs.realPath(
      value ?? join(homedir(), "Library/Application Support/factorio"),
    );
    if ((yield* fs.realPath(join(profile, "mods"))) !== join(profile, "mods"))
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Symlinked mods directory is not a managed real profile",
        }),
      );
    return profile;
  });
}
function assertBackupPath(profile: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const path of [
      join(profile, "mod-backups"),
      join(profile, "mod-backups", "local-mods"),
    ]) {
      if ((yield* fs.exists(path)) && (yield* fs.realPath(path)) !== path)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message: "Backups must remain inside the selected real profile",
          }),
        );
    }
  });
}
function assertClosed(workspace: ResolvedWorkspace, profile: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      lock = join(profile, ".lock");
    if (!(yield* fs.exists(lock))) return;
    const result = yield* runCommand(
      workspace,
      "profile-lock",
      ["lsof", "-t", "--", lock],
      { allowedExitCodes: [0, 1] },
    );
    if (result.stderr.length !== 0)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message:
            "Cannot establish profile lock ownership; inspect the lsof run",
        }),
      );
    if (result.stdout.trim())
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: `Factorio profile is in use by PIDs ${result.stdout.trim().split("\n").join(", ")}; save and quit before changing mods`,
        }),
      );
  });
}
function modList(profile: string, name: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = join(profile, "mods", "mod-list.json");
    if ((yield* fs.realPath(path)) !== path)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message: "Symlinked mod lists are not managed profile files",
        }),
      );
    const contents = yield* fs.readFile(path);
    const bytes = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(contents),
      catch: () =>
        new BoundaryError({
          boundary: path,
          message: "Invalid UTF-8 mod list",
        }),
    });
    const value = yield* decode(Schema.fromJsonString(ModList), bytes, path);
    const matches = value.mods.filter((mod) => mod.name === name);
    if (matches.length > 1)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: name,
          message: "Duplicate mod-list entries for the selected mod",
        }),
      );
    return { path, bytes, value, entry: matches[0] ?? null };
  });
}
function candidateVersion(name: string, file: string) {
  if (!file.startsWith(name + "_") || !file.endsWith(".zip")) return null;
  const value = file.slice(name.length + 1, -4);
  return /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(value)
    ? value
    : null;
}
function inventory(profile: string, name: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      files: (typeof ArchiveFile.Type)[] = [];
    for (const file of yield* fs.readDirectory(join(profile, "mods"))) {
      const candidate = candidateVersion(name, file);
      const folder =
        file === name ||
        (file.startsWith(name + "_") &&
          /^[0-9]+\.[0-9]+\.[0-9]+$/u.test(file.slice(name.length + 1)));
      if (folder)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: file,
            message:
              "Unpacked target mod may be a source checkout; refusing to move it",
          }),
        );
      if (candidate === null) continue;
      const path = join(profile, "mods", file);
      if (
        (yield* fs.realPath(path)) !== path ||
        (yield* fs.stat(path)).type !== "File"
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: file,
            message: "Target archive is not a regular, non-symlinked file",
          }),
        );
      files.push(
        yield* decode(
          ArchiveFile,
          { file, version: candidate, sha256: yield* hashFile(path) },
          "installed archive",
        ),
      );
    }
    return files.sort((a, b) => a.file.localeCompare(b.file));
  });
}
function state(profile: string, name: string) {
  return Effect.gen(function* () {
    const list = yield* modList(profile, name);
    const snapshot = yield* decode(
      Snapshot,
      { entry: list.entry, files: yield* inventory(profile, name) },
      "installed state",
    );
    return { list, snapshot };
  });
}
function savePath(profile: string, value: string) {
  return Effect.gen(function* () {
    yield* decode(Schema.NonEmptyString, value, "selected save");
    const fs = yield* FileSystem.FileSystem;
    const directory = join(profile, "saves"),
      path = yield* fs.realPath(
        isAbsolute(value) ? value : join(directory, value),
      );
    if (
      path === directory ||
      !contains(directory, path) ||
      !path.endsWith(".zip") ||
      (yield* fs.stat(path)).type !== "File"
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: path,
          message:
            "Choose a ZIP save inside the selected profile saves directory",
        }),
      );
    return path;
  });
}
function verifiedCopy(source: string, destination: string, expected: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* Stream.run(fs.stream(source), fs.sink(destination, { flag: "wx" }));
    if ((yield* hashFile(destination)) !== expected)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: destination,
          message: "Backup or staged checksum differs",
        }),
      );
  });
}
function atomicText(path: string, text: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({
        directory: dirname(path),
        prefix: "." + basename(path) + "-",
      });
      const temporary = join(directory, "content");
      yield* fs.writeFileString(temporary, text, { flag: "wx" });
      yield* fs.rename(temporary, path);
    }),
  );
}
function updatedList(
  list: Effect.Success<ReturnType<typeof modList>>,
  name: string,
  entry: typeof ModEntry.Type | null,
) {
  if (isDeepStrictEqual(list.entry, entry)) return list.bytes;
  const mods = list.value.mods.filter((mod) => mod.name !== name);
  if (entry !== null) {
    const index = list.value.mods.findIndex((mod) => mod.name === name);
    mods.splice(index < 0 ? mods.length : index, 0, entry);
  }
  return JSON.stringify({ ...list.value, mods }, null, 2) + "\n";
}
function protectedFiles(profile: string, save: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      result: Record<string, string | null> = {};
    for (const path of [save, join(profile, "mods", "mod-settings.dat")])
      result[path] = (yield* fs.exists(path)) ? yield* hashFile(path) : null;
    return yield* decode(ProtectedFiles, result, "protected profile files");
  });
}
function assertProtected(files: typeof ProtectedFiles.Type) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const [path, expected] of Object.entries(files))
      if (
        ((yield* fs.exists(path)) ? yield* hashFile(path) : null) !== expected
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message: "Save or settings changed during the operation",
          }),
        );
  });
}
function transition(
  workspace: ResolvedWorkspace,
  profile: string,
  name: string,
  before: Effect.Success<ReturnType<typeof state>>,
  after: typeof Snapshot.Type,
  sources: ReadonlyMap<string, string>,
  directory: string,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      stage = join(directory, "stage"),
      removed = join(directory, "removed");
    yield* fs.makeDirectory(stage);
    yield* fs.makeDirectory(removed);
    const replaceFiles = !isDeepStrictEqual(before.snapshot.files, after.files);
    if (replaceFiles)
      for (const file of after.files) {
        const source = sources.get(file.file);
        if (source === undefined)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: file.file,
              message: "No verified source for the staged archive",
            }),
          );
        yield* verifiedCopy(source, join(stage, file.file), file.sha256);
      }
    const nextText = updatedList(before.list, name, after.entry);
    yield* assertClosed(workspace, profile);
    const current = yield* state(profile, name);
    if (
      current.list.bytes !== before.list.bytes ||
      !isDeepStrictEqual(current.snapshot, before.snapshot)
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: profile,
          message: "Profile changed during preparation; nothing was activated",
        }),
      );
    const moved: (typeof ArchiveFile.Type)[] = [],
      installed: (typeof ArchiveFile.Type)[] = [];
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        if (replaceFiles) {
          for (const file of before.snapshot.files) {
            yield* fs.rename(
              join(profile, "mods", file.file),
              join(removed, file.file),
            );
            moved.push(file);
          }
          for (const file of after.files) {
            yield* fs.rename(
              join(stage, file.file),
              join(profile, "mods", file.file),
            );
            installed.push(file);
          }
        }
        if (nextText !== before.list.bytes)
          yield* atomicText(before.list.path, nextText);
        if (!isDeepStrictEqual((yield* state(profile, name)).snapshot, after))
          return yield* Effect.fail(
            new BoundaryError({
              boundary: profile,
              message: "Installed state failed readback",
            }),
          );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            // Undo only this attempt, never a concurrent edit. Backups remain durable.
            for (const file of installed) {
              const path = join(profile, "mods", file.file);
              if ((yield* hashFile(path)) !== file.sha256)
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: directory,
                    message:
                      "Concurrent archive change; explicit recovery is required",
                  }),
                );
              yield* fs.remove(path);
            }
            for (const file of moved) {
              const path = join(profile, "mods", file.file);
              if (yield* fs.exists(path))
                return yield* Effect.fail(
                  new BoundaryError({
                    boundary: directory,
                    message:
                      "Concurrent archive replacement; explicit recovery is required",
                  }),
                );
              yield* fs.rename(join(removed, file.file), path);
            }
            const text = yield* fs.readFileString(before.list.path);
            if (text === nextText && text !== before.list.bytes)
              yield* atomicText(before.list.path, before.list.bytes);
            else if (text !== before.list.bytes)
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: directory,
                  message:
                    "Concurrent mod-list change; explicit recovery is required",
                }),
              );
            return yield* Effect.failCause(cause);
          }),
        ),
      ),
    );
  });
}
function writeReceipt(path: string, value: unknown) {
  return Effect.gen(function* () {
    const receipt = yield* decode(
      InstallationReceipt,
      value,
      "installation receipt",
    );
    yield* atomicText(path, JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  });
}
export function modStatus(name: string, profile?: string) {
  return Effect.gen(function* () {
    yield* decode(TargetMod, name, "installed mod");
    const path = yield* profilePath(profile);
    return yield* decode(
      ModStatus,
      {
        action: "status",
        profile: path,
        mod: name,
        ...(yield* state(path, name)).snapshot,
      },
      "mod status",
    );
  });
}
export function mutateMod(
  workspace: ResolvedWorkspace,
  action: "load" | "unload",
  target: string,
  selectedSave: string,
  options: InstallOptions,
) {
  return Effect.gen(function* () {
    yield* decode(InstallationOptions, options, "installation options");
    yield* decode(Summary.fields.action, action, "installation action");
    const fs = yield* FileSystem.FileSystem;
    let incoming: typeof Incoming.Type | null = null,
      archive: string | undefined;
    if (action === "load") {
      archive = yield* fs.realPath(target);
      const result = yield* inspectArchive(
        workspace,
        archive,
        yield* hashFile(archive),
      );
      incoming = yield* decode(
        Incoming,
        {
          name: result.mod.name,
          version: result.mod.version,
          ...(result.factorio_version === undefined
            ? {}
            : { factorio_version: result.factorio_version }),
          dependencies: result.dependencies,
          file: result.mod.name + "_" + result.mod.version + ".zip",
          sha256: result.sha256,
        },
        "incoming mod archive",
      );
    }
    const name = yield* decode(
        TargetMod,
        incoming?.name ?? target,
        "installed mod",
      ),
      profile = yield* profilePath(options.profile),
      save = yield* savePath(profile, selectedSave);
    yield* assertClosed(workspace, profile);
    const backupRoot = join(profile, "mod-backups", "local-mods");
    yield* assertBackupPath(profile);
    const operation = Effect.gen(function* () {
      const before = yield* state(profile, name);
      if (
        action === "unload" &&
        before.list.entry === null &&
        before.snapshot.files.length === 0
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: name,
            message: "Mod is not installed",
          }),
        );
      if (
        incoming !== null &&
        before.list.entry?.version !== undefined &&
        before.list.entry.version !== incoming.version
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: name,
            message:
              "Resolve the explicit mod-list version pin before changing versions",
          }),
        );
      const after = yield* decode(
        Snapshot,
        {
          entry: {
            ...(before.list.entry ?? { name }),
            enabled: action === "load",
          },
          files:
            incoming === null
              ? before.snapshot.files
              : [
                  {
                    file: incoming.file,
                    version: incoming.version,
                    sha256: incoming.sha256,
                  },
                ],
        },
        "requested installed state",
      );
      const summary = yield* decode(
        Summary,
        {
          action,
          profile,
          save,
          mod: name,
          incoming,
          before: before.snapshot,
          after,
        },
        "installation summary",
      );
      if (isDeepStrictEqual(before.snapshot, after))
        return yield* decode(
          InstallationResult,
          { ...summary, outcome: "unchanged" },
          "installation result",
        );
      if (options.dryRun)
        return yield* decode(
          InstallationResult,
          { ...summary, outcome: "preview" },
          "installation result",
        );
      const directory = yield* fs.makeTempDirectory({
          directory: backupRoot,
          prefix: action + "-" + name + "-",
        }),
        backup = join(directory, "before");
      yield* fs.makeDirectory(join(backup, "mods"), { recursive: true });
      yield* fs.makeDirectory(join(backup, "saves"));
      const protectedState = yield* protectedFiles(profile, save),
        saveHash = yield* decode(
          Sha256,
          protectedState[save],
          "selected save checksum",
        ),
        saveBackup = join(backup, "saves", basename(save));
      yield* verifiedCopy(save, saveBackup, saveHash);
      yield* fs.writeFileString(
        join(backup, "mod-list.json"),
        before.list.bytes,
        { flag: "wx" },
      );
      for (const file of before.snapshot.files)
        yield* verifiedCopy(
          join(profile, "mods", file.file),
          join(backup, "mods", file.file),
          file.sha256,
        );
      const receiptPath = join(directory, "receipt.json"),
        restoreArgv = [
          process.execPath,
          join(workspace.repoRoot, "tools", "cli.ts"),
          "mod-restore",
          receiptPath,
        ];
      let receipt = yield* writeReceipt(receiptPath, {
        format: 1,
        state: "prepared",
        ...summary,
        save: { path: save, backup: saveBackup, sha256: saveHash },
        protected: protectedState,
        restore_argv: restoreArgv,
      });
      yield* Effect.gen(function* () {
        yield* assertProtected(protectedState);
        const sources = new Map<string, string>();
        if (incoming !== null && archive !== undefined)
          sources.set(incoming.file, archive);
        yield* transition(
          workspace,
          profile,
          name,
          before,
          after,
          sources,
          directory,
        );
        receipt = yield* writeReceipt(receiptPath, {
          ...receipt,
          state: "applied",
        });
        yield* assertProtected(protectedState);
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.gen(function* () {
                const observed = (yield* state(profile, name)).snapshot;
                yield* writeReceipt(receiptPath, {
                  ...receipt,
                  state: isDeepStrictEqual(observed, after)
                    ? "applied"
                    : isDeepStrictEqual(observed, before.snapshot)
                      ? "rolled-back"
                      : "interrupted",
                  error: Cause.pretty(exit.cause),
                });
              }),
        ),
      );
      return yield* decode(
        InstallationResult,
        {
          ...summary,
          outcome: "applied",
          receipt: receiptPath,
          save_backup: saveBackup,
          preserved_save_sha256: saveHash,
          restore_argv: restoreArgv,
          note: "Restart Factorio and load with installed mods. No save, settings, or unrelated mod was changed.",
        },
        "installation result",
      );
    });
    return yield* options.dryRun
      ? operation
      : withOwnedLock(
          join(backupRoot, ".operation.lock"),
          "normal-profile:" + profile,
          operation,
        );
  });
}
export function restoreMod(
  workspace: ResolvedWorkspace,
  target: string,
  options: InstallOptions,
) {
  return Effect.gen(function* () {
    yield* decode(InstallationOptions, options, "restoration options");
    const fs = yield* FileSystem.FileSystem,
      receiptPath = yield* fs.realPath(target);
    const receipt = yield* readJSON(InstallationReceipt, receiptPath);
    if (receipt.state !== "applied")
      return yield* Effect.fail(
        new BoundaryError({
          boundary: receiptPath,
          message: "Restore requires an applied receipt",
        }),
      );
    const name = receipt.mod,
      profile = yield* profilePath(receipt.profile),
      directory = dirname(receiptPath),
      backupRoot = join(profile, "mod-backups", "local-mods");
    if (
      options.profile !== undefined &&
      (yield* profilePath(options.profile)) !== profile
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: receiptPath,
          message: "Receipt belongs to another profile",
        }),
      );
    if (
      directory === backupRoot ||
      !contains(backupRoot, directory) ||
      basename(receiptPath) !== "receipt.json"
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: receiptPath,
          message: "Receipt lies outside its declared profile backup directory",
        }),
      );
    for (const snapshot of [receipt.before, receipt.after]) {
      if (snapshot.entry !== null && snapshot.entry.name !== name)
        return yield* Effect.fail(
          new BoundaryError({
            boundary: receiptPath,
            message: "Receipt entry belongs to another mod",
          }),
        );
      if (
        new Set(snapshot.files.map((file) => file.file)).size !==
          snapshot.files.length ||
        snapshot.files.some(
          (file) => file.file !== name + "_" + file.version + ".zip",
        )
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: receiptPath,
            message: "Receipt archive identities are duplicated or foreign",
          }),
        );
    }
    const expectedBackup = join(
      directory,
      "before",
      "saves",
      basename(receipt.save.path),
    );
    if (
      receipt.save.backup !== expectedBackup ||
      (yield* hashFile(expectedBackup)) !== receipt.save.sha256
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: receiptPath,
          message: "Saved backup identity or checksum differs",
        }),
      );
    yield* assertClosed(workspace, profile);
    yield* assertBackupPath(profile);
    const operation = Effect.gen(function* () {
      const current = yield* state(profile, name);
      if (!isDeepStrictEqual(current.snapshot, receipt.after))
        return yield* Effect.fail(
          new BoundaryError({
            boundary: receiptPath,
            message:
              "Selected mod changed after this receipt; refusing to overwrite newer state",
          }),
        );
      const sources = new Map<string, string>();
      for (const file of receipt.before.files) {
        const source = join(directory, "before", "mods", file.file);
        if (
          (yield* fs.realPath(source)) !== source ||
          (yield* hashFile(source)) !== file.sha256
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: source,
              message: "Backup checksum or ownership differs",
            }),
          );
        sources.set(file.file, source);
      }
      const summary = {
        action: "restore",
        mod: name,
        profile,
        before: current.snapshot,
        after: receipt.before,
        save_backup: receipt.save.backup,
        note: "Only mod files and this mod-list entry are restored. No save migration is reversed; use the pre-change save backup for a downgrade.",
      };
      if (options.dryRun)
        return yield* decode(
          RestorationResult,
          { ...summary, outcome: "preview" },
          "restoration result",
        );
      const undo = yield* fs.makeTempDirectory({
          directory,
          prefix: "restore-",
        }),
        protectedState = yield* protectedFiles(
          profile,
          yield* savePath(profile, receipt.save.path),
        );
      yield* Effect.gen(function* () {
        yield* transition(
          workspace,
          profile,
          name,
          current,
          receipt.before,
          sources,
          undo,
        );
        yield* writeReceipt(receiptPath, {
          ...receipt,
          state: "restored",
          restored_at: new Date().toISOString(),
        });
        yield* assertProtected(protectedState);
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.gen(function* () {
                const observed = (yield* state(profile, name)).snapshot;
                const restored = isDeepStrictEqual(observed, receipt.before);
                yield* writeReceipt(receiptPath, {
                  ...receipt,
                  state: restored
                    ? "restored"
                    : isDeepStrictEqual(observed, receipt.after)
                      ? "applied"
                      : "interrupted",
                  ...(restored
                    ? { restored_at: new Date().toISOString() }
                    : {}),
                  error: Cause.pretty(exit.cause),
                });
              }),
        ),
      );
      return yield* decode(
        RestorationResult,
        { ...summary, outcome: "restored", receipt: receiptPath },
        "restoration result",
      );
    });
    return yield* options.dryRun
      ? operation
      : withOwnedLock(
          join(backupRoot, ".operation.lock"),
          "normal-profile:" + profile,
          operation,
        );
  });
}
