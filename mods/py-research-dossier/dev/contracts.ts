import { Schema } from "effect";
import { AbsolutePath, Sha256 } from "../../../tools/contracts.ts";
import { ModId, RelativePath, Version } from "../../../tools/projects.ts";

export const Count = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
export const Identifier = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,98}$/),
);
export const PrototypeName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,200}$(?![\s\S])/u),
);
export const QualifiedTarget = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*\/[A-Za-z0-9_-]{1,200}$/),
);
export const ModVersions = Schema.Record(ModId, Version);
const plain = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) => value === value.trim() && !/[\r\n[\]\\]|__\d+__/.test(value),
  ),
);
const Conditions = Schema.Struct({
  mod: Schema.optionalKey(ModId),
  startup: Schema.optionalKey(PrototypeName),
  featureFlag: Schema.optionalKey(PrototypeName),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0));
export const Entry = Schema.Struct({
  id: Identifier,
  kind: Schema.Literals(["recipe", "material", "machine", "technology"]),
  discipline: Schema.Literals([
    "chemistry",
    "physics",
    "engineering",
    "metallurgy",
    "geology",
    "biology",
  ]),
  basis: Schema.Literals(["real", "simplified", "abstracted", "fictional"]),
  topic: plain.check(Schema.isMaxLength(32)),
  text: plain,
  sources: Schema.NonEmptyArray(Identifier),
  gameSources: Schema.NonEmptyArray(Identifier),
  targets: Schema.NonEmptyArray(QualifiedTarget),
  when: Schema.optionalKey(Conditions),
});
export const Catalogue = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  entries: Schema.Array(Entry),
});
export const Sources = Schema.Record(
  Identifier,
  Schema.Struct({
    title: Schema.NonEmptyString,
    section: Schema.NonEmptyString,
    url: Schema.String.check(
      Schema.makeFilter(
        (value) => URL.canParse(value) && new URL(value).protocol === "https:",
      ),
    ),
  }),
);
export const GameSources = Schema.Struct({
  apiVersion: Version,
  reviewedBase: Schema.Struct({ version: Version }),
  reviewedMods: Schema.Record(
    ModId,
    Schema.Struct({
      version: Version,
      archive: RelativePath,
      root: RelativePath,
      sha256: Sha256,
    }),
  ),
  files: Schema.Record(
    Identifier,
    Schema.Struct({
      mod: ModId,
      path: RelativePath,
      sha256: Schema.optionalKey(Sha256),
    }),
  ),
  historicalCapture: Schema.Struct({
    snapshotId: Sha256,
    capturedAt: Schema.NonEmptyString,
    factorioVersion: Version,
    rawSha256: Sha256,
    scope: Schema.NonEmptyString,
  }),
});
export const PrototypeAPI = Schema.Struct({
  application: Schema.Literal("factorio"),
  stage: Schema.Literal("prototype"),
  application_version: Version,
  prototypes: Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      parent: Schema.optionalKey(Schema.String),
      typename: Schema.optionalKey(Schema.String),
    }),
  ),
});
const targetIdentity = {
  type: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
  name: PrototypeName,
  id: QualifiedTarget,
};
const matchingIdentity = Schema.makeFilter(
  (value: { type: string; name: string; id: string }) =>
    value.id === `${value.type}/${value.name}`,
);
const TypedTarget = Schema.Struct({
  ...targetIdentity,
  base_type: Schema.Literals([
    "item",
    "fluid",
    "entity",
    "recipe",
    "technology",
    "tile",
  ]),
}).check(matchingIdentity);
const PlacedEntity = Schema.Struct(targetIdentity).check(matchingIdentity);
export const FlagRecord = Schema.Struct({
  schema_version: Schema.Literal(1),
  tick: Count,
  player_index: Schema.Int.check(Schema.isGreaterThan(0)),
  force: Schema.String,
  surface: Schema.String,
  reason: Schema.Literals(["expand", "missing", "change"]),
  note: Schema.String,
  target: TypedTarget,
  dossier_note: Schema.optionalKey(Identifier),
  mod_versions: ModVersions,
  placed_entity: Schema.optionalKey(PlacedEntity),
  placed_entity_dossier_note: Schema.optionalKey(Identifier),
});
export const FlagReceipt = Schema.Struct({
  bytes: Count,
  sha256: Sha256,
  records: Count,
});
export const FlagRow = Schema.Struct({
  line: Schema.Int.check(Schema.isGreaterThan(0)),
  startByte: Count,
  endByte: Count,
  recordSha256: Sha256,
  record: FlagRecord,
});
export const FlagReadback = Schema.Struct({
  receipt: FlagReceipt,
  since: Schema.NullOr(FlagReceipt),
  records: Schema.Array(FlagRow),
});
const part = {
  type: Schema.Literals(["item", "fluid"]),
  name: PrototypeName,
  id: Schema.NullOr(QualifiedTarget),
  amount: Schema.Number.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
};
export const Recipe = Schema.Struct({
  id: QualifiedTarget,
  hidden: Schema.Boolean,
  excludedFromCrafting: Schema.NullOr(Schema.String),
  unlocks: Schema.Array(PrototypeName),
  ingredients: Schema.Array(
    Schema.Struct({
      ...part,
      targets: Schema.optionalKey(Schema.Array(QualifiedTarget)),
    }),
  ),
  products: Schema.Array(
    Schema.Struct({ ...part, targets: Schema.Array(QualifiedTarget) }),
  ),
});
const upgradeEffect = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["machine-replacement", "recipe-replacement"]),
    old: PrototypeName,
    new: PrototypeName,
  }),
  Schema.Struct({
    type: Schema.Literal("unlock-recipe"),
    recipe: PrototypeName,
    also_unlocked_by_techs: Schema.optionalKey(Schema.Literal("true")),
  }),
  Schema.Struct({
    type: Schema.Literal("module-effects"),
    consumption: Schema.optionalKey(Schema.String),
    pollution: Schema.optionalKey(Schema.String),
    productivity: Schema.optionalKey(Schema.String),
    speed: Schema.optionalKey(Schema.String),
  }),
]);
export const UpgradePackages = Schema.Record(
  PrototypeName,
  Schema.Struct({
    affectedEntities: Schema.Array(PrototypeName),
    choices: Schema.Record(
      PrototypeName,
      Schema.Union([
        Schema.Array(upgradeEffect),
        Schema.Literal("runtime-function"),
      ]),
    ),
  }),
);
export const ReferenceContext = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  modVersions: ModVersions,
  sourceSave: Schema.Struct({
    sha256: Sha256,
    mtimeUtc: Schema.NonEmptyString,
    factorioVersion: Schema.Literal("2.1.21-11"),
  }),
  provenance: Schema.Record(Schema.String, Schema.Json),
  versionNeutralMods: Schema.Array(ModId),
  versionNeutralJustification: Schema.NonEmptyString,
  recipePrototypeNames: Schema.Array(PrototypeName),
  technologyPrototypeNames: Schema.Array(PrototypeName),
  recipes: Schema.Record(QualifiedTarget, Recipe),
  technologies: Schema.Record(PrototypeName, Schema.Array(PrototypeName)),
  omittedRecipes: Schema.Array(
    Schema.Struct({
      id: QualifiedTarget,
      enabled: Schema.Boolean,
      disposition: Schema.NonEmptyString,
    }),
  ),
  upgradePackages: UpgradePackages,
});
export const Families = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  families: Schema.Array(
    Schema.Struct({
      id: Identifier,
      targets: Schema.Array(QualifiedTarget),
      recipes: Schema.Array(QualifiedTarget),
      technologies: Schema.Array(PrototypeName),
      evidence: Schema.NonEmptyArray(Schema.NonEmptyString),
      exclusions: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    }),
  ),
});
const mapping = Schema.Struct({ offset: Count, end: Count, count: Count });
const SavedForces = Schema.Struct({
  factorioVersion: Schema.Literal("2.1.21-11"),
  decompressedBytes: Count,
  forces: Schema.Record(
    Schema.String,
    Schema.Struct({
      recipeVectorOffset: Count,
      technologyVectorOffset: Count,
      technologyVectorEnd: Count,
      enabledRecipes: Schema.Array(PrototypeName),
      researchedTechnologies: Schema.Array(PrototypeName),
      triggers: Schema.Array(
        Schema.Struct({
          technology: PrototypeName,
          kind: Schema.Literal(0),
          progress: Count,
        }),
      ),
    }),
  ),
  prototypeMappings: Schema.Struct({ recipe: mapping, technology: mapping }),
  recipePrototypeNames: Schema.Array(PrototypeName),
  technologyPrototypeNames: Schema.Array(PrototypeName),
});
export const SaveReadback = Schema.Struct({
  ...SavedForces.fields,
  modVersions: ModVersions,
  kind: Schema.Literal(
    "version-scoped offline saved-force readback, not live engine state",
  ),
  save: AbsolutePath,
  saveBytes: Count,
  saveMtimeUtc: Schema.NonEmptyString,
  saveSha256: Sha256,
});
export const SaveRequest = Schema.Struct({
  schema: Schema.Literal(1),
  save: AbsolutePath,
});
