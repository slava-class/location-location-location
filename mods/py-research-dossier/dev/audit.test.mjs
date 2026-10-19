import { test, expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../../tools/commands.ts";
import { readFlags, auditScope, validateContext } from "./audit-model.mjs";
import { readSavedProgress } from "./audit.ts";
import { project } from "./test-support.ts";

const mods = {
  base: "2.1.21",
  pycoalprocessing: "3.1.7",
  "py-research-dossier": "0.5.0",
};
function flag(id = "recipe/device", reason = "missing", note = "") {
  const [type, name] = id.split("/");
  return {
    schema_version: 1,
    tick: 20,
    player_index: 1,
    force: "player",
    surface: "nauvis",
    reason,
    note,
    target: {
      id,
      type,
      name,
      base_type: type === "assembling-machine" ? "entity" : type,
    },
    mod_versions: mods,
  };
}
const bytes = (records) =>
  Buffer.from(records.map((record) => JSON.stringify(record) + "\n").join(""));
function fixture() {
  /**
   * @param {string} name
   * @param {number} [amount]
   * @param {string|null} [entity]
   */
  const part = (name, amount = 1, entity = null) => ({
    type: "item",
    name,
    amount,
    id: `item/${name}`,
    targets: [
      `item/${name}`,
      ...(entity ? [`assembling-machine/${entity}`] : []),
    ],
  });
  const recipe = (name, unlocks, products, ingredients = []) => ({
    id: `recipe/${name}`,
    hidden: false,
    excludedFromCrafting: null,
    unlocks,
    products,
    ingredients,
  });
  const recipes = Object.fromEntries(
    [
      recipe("device", ["make"], [part("device", 1, "device")]),
      recipe("device-alt", ["upgrade"], [part("device", 2, "device")]),
      recipe("other-package-member", ["make"], [part("wire")]),
      recipe("ancestor-product", ["base"], [part("metal")]),
      recipe(
        "catalyst-return",
        ["unrelated"],
        [part("device", 0.9, "device")],
        [part("device", 1)],
      ),
      recipe("consumer", ["unrelated"], [part("resin")], [part("device")]),
      recipe("choice-a", [], [part("choice-a")]),
      recipe("choice-b", [], [part("choice-b")]),
    ].map((row) => [row.id, row]),
  );
  const context = {
    schemaVersion: 1,
    sourceSave: { sha256: "reference" },
    provenance: { source: "fixture" },
    modVersions: mods,
    versionNeutralMods: ["py-research-dossier"],
    technologies: {
      base: [],
      make: ["base"],
      upgrade: ["make"],
      unrelated: [],
    },
    recipePrototypeNames: Object.keys(recipes).map((id) => id.slice(7)),
    technologyPrototypeNames: ["base", "make", "upgrade", "unrelated"],
    recipes,
    omittedRecipes: [],
    upgradePackages: {},
  };
  const families = {
    schemaVersion: 1,
    families: [
      {
        id: "devices",
        targets: ["assembling-machine/device"],
        recipes: [],
        technologies: [],
        evidence: ["fixture placement and upgrade links"],
      },
    ],
  };
  const content = {
    entries: [
      {
        id: "device-note",
        targets: ["assembling-machine/device"],
        text: "Mechanism",
        topic: "Device",
      },
    ],
  };
  const progress = {
    modVersions: mods,
    recipePrototypeNames: context.recipePrototypeNames,
    technologyPrototypeNames: context.technologyPrototypeNames,
    forces: {
      player: {
        enabledRecipes: ["device", "ancestor-product", "other-package-member"],
        researchedTechnologies: ["base", "make"],
      },
    },
  };
  return {
    flags: readFlags(bytes([flag()])),
    content,
    context,
    families,
    progress,
  };
}

test("flag receipts preserve repeated submissions, multiline notes and tick resets", () => {
  const first = flag(
    "recipe/device",
    "change",
    "First paragraph\n\nSecond paragraph",
  );
  const prefix = readFlags(bytes([first, first]));
  expect(prefix.records.map((row) => row.line)).toEqual([1, 2]);
  const later = { ...flag("item/device", "expand"), tick: 1 };
  const appended = readFlags(bytes([first, first, later]), prefix.receipt);
  expect(
    appended.records.map((row) => [
      row.line,
      row.record.target.id,
      row.record.tick,
    ]),
  ).toEqual([[3, "item/device", 1]]);
  expect(prefix.records[0].record.note).toBe(
    "First paragraph\n\nSecond paragraph",
  );
});

test("flag reads fail on incomplete, malformed, inconsistent or unsupported records", () => {
  expect(() => readFlags(Buffer.from(JSON.stringify(flag())))).toThrow();
  expect(() => readFlags(Buffer.from("{oops}\n"))).toThrow();
  const wrong = flag();
  wrong.target.name = "different";
  expect(() => readFlags(bytes([wrong]))).toThrow();
  const placed = {
    ...flag(),
    placed_entity: {
      id: "assembling-machine/device",
      type: "assembling-machine",
      name: "device",
    },
    placed_entity_dossier_note: "device-note",
  };
  expect(readFlags(bytes([placed])).records[0].record.placed_entity).toEqual(
    placed.placed_entity,
  );
  placed.placed_entity.name = "different";
  expect(() => readFlags(bytes([placed]))).toThrow();
});

test("changed log prefixes cannot silently acknowledge new or replaced feedback", () => {
  const original = bytes([flag()]);
  const receipt = readFlags(original).receipt;
  const changed = bytes([flag("recipe/device", "change")]);
  expect(() => readFlags(changed, receipt)).toThrow();
  expect(() => readFlags(bytes([{ ...flag(), schema_version: 2 }]))).toThrow();
  expect(() => readFlags(bytes([flag("recipe/device", "unknown")]))).toThrow();
});

test("scope follows all positive producers, complete unlock packages and recursive prerequisites", () => {
  const input = fixture();
  input.flags = readFlags(bytes([flag("item/device")]));
  const result = auditScope(input);
  expect(result.recipes.map((row) => row.id)).toEqual([
    "recipe/ancestor-product",
    "recipe/device",
    "recipe/device-alt",
    "recipe/other-package-member",
  ]);
  expect(result.technologies.map((row) => row.id)).toEqual([
    "technology/base",
    "technology/make",
    "technology/upgrade",
  ]);
  expect(
    result.recipes.find((row) => row.id === "recipe/device").coverage,
  ).toBe("product-only");
  expect(result.seeds[0].record.target.id).toBe("item/device");
  expect(result.seeds[0].disposition).toBe("review-required");
});

test("recipe and material identities never collapse because names match", () => {
  const input = fixture();
  input.flags = readFlags(bytes([flag("fluid/device")]));
  const result = auditScope(input);
  expect(result.recipes).toEqual([]);
  expect(result.issues).toContainEqual({
    kind: "unreviewed-family",
    line: 1,
    target: "fluid/device",
  });
});

test("current coverage respects saved force state, hidden recipes and crafting exclusions", () => {
  const input = fixture();
  input.context.recipes["recipe/ancestor-product"].hidden = true;
  input.context.recipes["recipe/other-package-member"].excludedFromCrafting =
    "reviewed hidden-container rule";
  const result = auditScope(input);
  expect(
    result.recipes
      .filter((row) => row.availableFor.length)
      .map((row) => row.id),
  ).toEqual(["recipe/device"]);
  expect(
    result.technologies.find((row) => row.id === "technology/upgrade")
      .researchedBy,
  ).toEqual([]);
  delete input.progress;
  expect(auditScope(input).summary.currentCraftingRecipes).toBeNull();
});

test("unobserved creation conditions are not counted as active coverage", () => {
  const input = fixture();
  input.content.entries[0].when = { startup: "enable-devices" };
  expect(
    auditScope(input).recipes.find((row) => row.id === "recipe/device")
      .coverage,
  ).toBe("condition-unverified");
  input.content.entries[0].when = {
    mod: "absent-mod",
    startup: "enable-devices",
  };
  expect(
    auditScope(input).recipes.find((row) => row.id === "recipe/device")
      .coverage,
  ).toBe("no-note");
});

test("expand and change requests remain open even with an existing lesson", () => {
  const input = fixture();
  input.flags = readFlags(
    bytes([
      flag("recipe/device", "change", "Wrong mechanism"),
      flag("item/device", "expand", "Explain energy losses"),
    ]),
  );
  const result = auditScope(input);
  expect(
    result.seeds.map((seed) => [seed.record.reason, seed.disposition]),
  ).toEqual([
    ["change", "review-required"],
    ["expand", "review-required"],
  ]);
  expect(result.summary.flags).toBe(2);
  expect(result.existingNotesToReview.map((note) => note.id)).toEqual([
    "device-note",
  ]);
});

test("ingredient-only lessons remain in the quality review and typed target inventory", () => {
  const input = fixture();
  input.context.recipes["recipe/device"].ingredients = [
    { type: "item", name: "fuel", id: "item/fuel", amount: 1 },
  ];
  input.content.entries.push({
    id: "fuel-note",
    targets: ["item/fuel"],
    topic: "Fuel",
    text: "Stored energy",
  });
  const result = auditScope(input);
  expect(result.existingNotesToReview.map((note) => note.id)).toEqual([
    "device-note",
    "fuel-note",
  ]);
  expect(
    result.targets.find((target) => target.id === "item/fuel").notes,
  ).toEqual([{ id: "fuel-note", eligibility: "eligible" }]);
  expect(
    result.recipes.find((recipe) => recipe.id === "recipe/other-package-member")
      .scopeReasons,
  ).toContain("technology/make");
});

test("unknown graph edges and mismatched gameplay mods remain explicit evidence issues", () => {
  const input = fixture();
  delete input.context.technologies.base;
  input.progress.modVersions = { ...mods, pycoalprocessing: "9.0.0" };
  const result = auditScope(input);
  expect(result.status).toBe("incomplete-evidence");
  expect(result.issues.map((issue) => issue.kind).sort()).toEqual([
    "save-mod-version-mismatch",
    "unresolved-technology-prerequisites",
  ]);
});

test("prerequisite cycles fail instead of hanging or reporting a complete audit", () => {
  const input = fixture();
  input.context.technologies.base = ["upgrade"];
  expect(() => auditScope(input)).toThrow();
});

test("technology packages retain all runtime upgrade choices, not only the flagged choice", () => {
  const input = fixture();
  input.context.upgradePackages.make = {
    affectedEntities: ["different-machine"],
    choices: {
      a: [{ type: "unlock-recipe", recipe: "choice-a" }],
      b: [{ type: "unlock-recipe", recipe: "choice-b" }],
    },
  };
  const result = auditScope(input);
  expect(
    result.recipes
      .filter((row) => row.id.startsWith("recipe/choice-"))
      .map((row) => row.id),
  ).toEqual(["recipe/choice-a", "recipe/choice-b"]);
  expect(Object.keys(result.upgradePackages.make.choices)).toEqual(["a", "b"]);
});

test("reference omissions and changed save prototype universes fail closed", () => {
  const input = fixture();
  input.context.recipePrototypeNames = [
    ...input.context.recipePrototypeNames,
    "unclassified",
  ];
  expect(() => validateContext(input.context)).toThrow();
  const changed = fixture();
  changed.progress.recipePrototypeNames = [
    ...changed.progress.recipePrototypeNames,
    "new-recipe",
  ];
  expect(() => auditScope(changed)).toThrow();
});

function saveFixture() {
  const u16 = (value) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    return b;
  };
  const text = (value) =>
    Buffer.concat([Buffer.from([value.length]), Buffer.from(value)]);
  const table = (kind, names) =>
    Buffer.concat([
      text(kind),
      u16(names.length),
      ...names.flatMap((name, index) => [text(name), u16(index + 1)]),
    ]);
  const header = Buffer.alloc(9);
  [2, 1, 21, 11].forEach((value, index) =>
    header.writeUInt16LE(value, index * 2),
  );
  const forces = [
    [1, "player"],
    [2, "enemy"],
    [3, "neutral"],
  ].map(([id, name]) => {
    const recipes = Buffer.alloc(16);
    recipes[4] = id === 1 ? 1 : 0;
    const techs =
      id === 1
        ? Buffer.from([1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 5, 0, 0, 0])
        : Buffer.alloc(12);
    return Buffer.concat([
      Buffer.from([id]),
      text(name),
      u16(3),
      recipes,
      u16(4),
      techs,
    ]);
  });
  return Buffer.concat([
    header,
    table("recipe", ["enabled", "disabled"]),
    table("technology", ["early", "later", "triggered"]),
    ...forces,
  ]);
}
function scriptFixture() {
  const uint = (value) =>
    value < 255
      ? Buffer.from([value])
      : (() => {
          const bytes = Buffer.alloc(5);
          bytes[0] = 255;
          bytes.writeUInt32LE(value, 1);
          return bytes;
        })();
  const text = (value) =>
    Buffer.concat([uint(Buffer.byteLength(value)), Buffer.from(value)]);
  const version = Buffer.alloc(9);
  [2, 1, 21, 11].forEach((value, index) =>
    version.writeUInt16LE(value, index * 2),
  );
  const state = Buffer.concat([
    version,
    Buffer.from([4]),
    text("installed_mods"),
    Buffer.from([5]),
    uint(Object.keys(mods).length),
    ...Object.entries(mods).flatMap(([name, value]) => [
      Buffer.from([4]),
      text(name),
      Buffer.from([4]),
      text(value),
    ]),
  ]);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(1);
  return Buffer.concat([
    version,
    count,
    text("mod-factoryplanner"),
    uint(state.length),
    state,
    Buffer.from([0]),
  ]);
}
const archiveScript = [
  "import base64,sys,zipfile,zlib",
  "with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as archive:",
  " archive.writestr('fixture/level.dat0', zlib.compress(base64.b64decode(sys.argv[2])))",
  " archive.writestr('fixture/script.dat', base64.b64decode(sys.argv[3]))",
].join("\n");
async function withSave(level, use) {
  await mkdir(project.outputRoot, { recursive: true });
  const directory = await mkdtemp(join(project.outputRoot, "save-fixture-"));
  try {
    const save = join(directory, "fixture.zip");
    const rewrite = (data) =>
      Effect.runPromise(
        runCommand(
          project,
          "offline-save-fixture",
          [
            "uv",
            "run",
            "--locked",
            "--no-sync",
            "--offline",
            "--no-python-downloads",
            "--project",
            project.repoRoot,
            "python",
            "-B",
            "-c",
            archiveScript,
            save,
            data.toString("base64"),
            scriptFixture().toString("base64"),
          ],
          { cwd: project.repoRoot },
        ).pipe(Effect.provide(BunServices.layer)),
      );
    await rewrite(level);
    return await use(save, rewrite);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("saved-force readback preserves typed progression and saved mod identity through the real ZIP protocol", async () => {
  await withSave(saveFixture(), async (save) => {
    const result = await Effect.runPromise(
      readSavedProgress(project, save).pipe(Effect.provide(BunServices.layer)),
    );
    expect(result.forces.player.enabledRecipes).toEqual(["enabled"]);
    expect(result.forces.player.researchedTechnologies).toEqual(["early"]);
    expect(result.forces.player.triggers).toEqual([
      { technology: "triggered", kind: 0, progress: 5 },
    ]);
    expect(result.forces.enemy.researchedTechnologies).toEqual([]);
    expect(result.modVersions).toEqual(mods);
    expect(result.save).toBe(save);
  });
});
test("unsupported save versions fail rather than reusing an old progression result", async () => {
  await withSave(saveFixture(), async (save, rewrite) => {
    const prior = await Effect.runPromise(
      readSavedProgress(project, save).pipe(Effect.provide(BunServices.layer)),
    );
    expect(prior.factorioVersion).toBe("2.1.21-11");
    const data = saveFixture();
    data.writeUInt16LE(22, 4);
    await rewrite(data);
    expect(
      Effect.runPromise(
        readSavedProgress(project, save).pipe(
          Effect.provide(BunServices.layer),
        ),
      ),
    ).rejects.toThrow();
  });
});
