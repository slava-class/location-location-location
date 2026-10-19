import { Schema } from "effect";
import { AbsolutePath, Sha256 } from "../../../tools/contracts.ts";
import { ModId, Version } from "../../../tools/projects.ts";
import {
  Count,
  Entry,
  Families,
  FlagReadback,
  FlagReceipt,
  FlagRow,
  Identifier,
  PrototypeName,
  QualifiedTarget,
  Recipe,
  ReferenceContext,
  SaveReadback,
  UpgradePackages,
} from "./contracts.ts";

export const InputIdentity = Schema.Struct({
  path: AbsolutePath,
  bytes: Count,
  sha256: Sha256,
  mtimeUtc: Schema.NonEmptyString,
});
const Inputs = Schema.Record(Schema.String, InputIdentity);
export const CorpusInventory = Schema.Struct({
  notes: Count,
  targets: Count,
  counts: Schema.Record(Schema.String, Count),
  sources: Count,
  editorialSignals: Schema.Array(
    Schema.Struct({
      id: Identifier,
      signal: Schema.Literals([
        "explicit-game-narration",
        "name-comparison-instead-of-mechanism",
      ]),
      targets: Schema.Array(QualifiedTarget),
      paragraph: Schema.String,
    }),
  ),
  duplicateBodies: Schema.Array(Schema.Array(Identifier)),
  interpretation: Schema.NonEmptyString,
});
export const CorpusReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  inputs: Inputs,
  ...CorpusInventory.fields,
});
export const ProgressReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ...SaveReadback.fields,
});
export const FlagsReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  inputs: Inputs,
  flags: FlagReceipt,
  since: FlagReadback.fields.since,
  records: FlagReadback.fields.records,
});
export const PreviousReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  flags: FlagReceipt,
});
const Differences = Schema.Array(
  Schema.Struct({
    mod: ModId,
    reference: Schema.NullOr(Version),
    observed: Schema.NullOr(Version),
  }),
);
const Issue = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("save-mod-version-mismatch"),
    differences: Differences,
  }),
  Schema.Struct({
    kind: Schema.Literal("flag-mod-version-mismatch"),
    line: Count,
    differences: Differences,
  }),
  Schema.Struct({
    kind: Schema.Literals(["unreviewed-family", "unresolved-seed-recipe"]),
    line: Count,
    target: QualifiedTarget,
  }),
  Schema.Struct({
    kind: Schema.Literal("unresolved-upgrade-recipe"),
    upgrade: PrototypeName,
    target: QualifiedTarget,
  }),
  Schema.Struct({
    kind: Schema.Literal("unresolved-technology-prerequisites"),
    target: QualifiedTarget,
  }),
  Schema.Struct({
    kind: Schema.Literal("unresolved-native-subtype"),
    recipe: QualifiedTarget,
    type: Schema.Literals(["item", "fluid"]),
    name: PrototypeName,
  }),
  Schema.Struct({
    kind: Schema.Literal("unresolved-player-force"),
    force: Schema.String,
  }),
]);
const Notes = Schema.Array(
  Schema.Struct({
    id: Identifier,
    eligibility: Schema.Literals([
      "inactive",
      "condition-unverified",
      "eligible",
    ]),
  }),
);
export const ScopeReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  status: Schema.Literals([
    "incomplete-evidence",
    "scope-mapped-quality-review-required",
  ]),
  inputs: Inputs,
  flags: FlagReceipt,
  since: FlagReadback.fields.since,
  seeds: Schema.Array(
    Schema.Struct({
      ...FlagRow.fields,
      families: Schema.Array(Identifier),
      disposition: Schema.Literal("review-required"),
    }),
  ),
  issues: Schema.Array(Issue),
  families: Families.fields.families,
  rootTechnologies: Schema.Array(PrototypeName),
  technologies: Schema.Array(
    Schema.Struct({
      id: QualifiedTarget,
      prerequisites: Schema.NullOr(Schema.Array(PrototypeName)),
      notes: Notes,
      researchedBy: Schema.NullOr(Schema.Array(Schema.String)),
    }),
  ),
  upgradePackages: UpgradePackages,
  recipes: Schema.Array(
    Schema.Struct({
      ...Recipe.fields,
      family: Schema.Boolean,
      scopeReasons: Schema.Array(Schema.String),
      availableFor: Schema.NullOr(Schema.Array(Schema.String)),
      cards: Schema.Array(
        Schema.Struct({
          kind: Schema.Literals(["process", "product"]),
          targets: Schema.Array(QualifiedTarget),
          notes: Notes,
        }),
      ),
      coverage: Schema.Literals([
        "process-and-product",
        "process-only",
        "product-only",
        "condition-unverified",
        "no-note",
      ]),
    }),
  ),
  targets: Schema.Array(Schema.Struct({ id: QualifiedTarget, notes: Notes })),
  existingNotesToReview: Schema.Array(Entry),
  summary: Schema.Struct({
    flags: Count,
    families: Count,
    technologies: Count,
    recipes: Count,
    targets: Count,
    familyRecipes: Count,
    currentCraftingRecipes: Schema.NullOr(Count),
    currentWithoutLesson: Schema.NullOr(Count),
    currentConditionalUnknown: Schema.NullOr(Count),
    currentFamilyRecipes: Schema.NullOr(Count),
    existingNotesToReview: Count,
    evidenceIssues: Count,
  }),
  referenceEvidence: Schema.Struct({
    sourceSave: ReferenceContext.fields.sourceSave,
    provenance: ReferenceContext.fields.provenance,
  }),
  progress: SaveReadback,
  corpus: CorpusInventory,
  limits: Schema.Array(Schema.NonEmptyString),
});
