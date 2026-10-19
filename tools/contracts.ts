import { Schema } from "effect";
import { Info, LuaTypeName, ModId, RelativePath, Version } from "./projects.ts";
export const AbsolutePath = Schema.String.check(
  // oxlint-disable-next-line no-control-regex -- Reject NUL in filesystem paths.
  Schema.isPattern(/^\/[^\u0000\r\n]*$(?![\s\S])/u),
);
export const Sha256 = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$(?![\s\S])/u),
);
export const Sha1 = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{40}$(?![\s\S])/u),
);
export const PinnedFile = Schema.Struct({
  path: AbsolutePath,
  sha256: Sha256,
  maxBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  ),
});
export const ElapsedMs = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_VALUE }),
);
export const ModIdentity = Schema.Struct({ name: ModId, version: Version });
export const PackageResult = Schema.Struct({
  schema: Schema.Literal(2),
  mod: ModIdentity,
  archive: AbsolutePath,
  sha256: Sha256,
  sha1: Sha1,
  files: Schema.Record(RelativePath, Sha256),
  compression: Schema.Struct({
    implementation: Schema.Literal("yazl"),
    version: Schema.Literal("3.3.1"),
    bun: Schema.NonEmptyString,
    bunRevision: Schema.NonEmptyString,
    zlib: Schema.NonEmptyString,
    method: Schema.Literal("deflate"),
    level: Schema.Literal(9),
  }),
});
export type Packaged = typeof PackageResult.Type;
export const LuaToolsRequest = Schema.Struct({
  cache: AbsolutePath,
  inputSha256: Sha256,
  sources: Schema.Struct({
    "luacheck-1.2.0": PinnedFile,
    "argparse-0.7.1": PinnedFile,
    "luafilesystem-1_8_0": PinnedFile,
  }),
  emmy: PinnedFile,
});
export const LuaToolsResult = Schema.Struct({
  schema: Schema.Literal(3),
  cache: AbsolutePath,
  inputSha256: Sha256,
  luacheck: Schema.Literal("1.2.0"),
  emmy: Schema.Literal("0.25.1"),
  lua: Schema.Literal("5.2.4"),
  build: Schema.Struct({
    compiler: Schema.NonEmptyString,
    compilerExecutableSha256: Sha256,
    bun: Schema.NonEmptyString,
    bunRevision: Schema.NonEmptyString,
    luaExecutableSha256: Sha256,
  }),
  files: Schema.Record(RelativePath, Sha256),
});
export const ApiDocuments = Schema.Struct({
  version: Version,
  runtime: PinnedFile,
  prototype: PinnedFile,
});
export const TypesRequest = Schema.Struct({
  overlay: AbsolutePath,
  api: ApiDocuments,
  storageType: Schema.NullOr(LuaTypeName),
  flib: Schema.NullOr(
    Schema.Struct({
      archive: AbsolutePath,
      sha256: Sha256,
      version: Version,
      styleType: Schema.NullOr(LuaTypeName),
    }),
  ),
});
export const TypesResult = Schema.Struct({
  schema: Schema.Literal(1),
  version: Version,
  library: AbsolutePath,
  dependencies: Schema.Array(AbsolutePath),
});
export const ArchiveIdentity = Schema.Struct({
  archive: AbsolutePath,
  sha256: Sha256,
});
export const ArchiveResult = Schema.Struct({
  schema: Schema.Literal(1),
  archive: AbsolutePath,
  sha256: Sha256,
  mod: ModIdentity,
  factorio_version: Schema.optionalKey(Info.fields.factorio_version),
  dependencies: Schema.Array(Schema.NonEmptyString),
  members: Schema.Array(RelativePath),
});
