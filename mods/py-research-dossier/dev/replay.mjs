import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { parseLocale } from "../../../tools/audit.ts";
import { AbsolutePath, Sha256 } from "../../../tools/contracts.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  decodeJSON,
  prepareOutputDirectory,
  readJSON,
  RelativePath,
  Version,
} from "../../../tools/projects.ts";
import { compileContent } from "./content.ts";
import { Count, ModVersions } from "./contracts.ts";
import { helperSource } from "./py-helper.ts";
import { runLua } from "./lua.ts";
import { luaValue, sha256 } from "./lib.mjs";

const Options = Schema.Struct({ raw: AbsolutePath, snapshot: AbsolutePath });
const jsonObject = Schema.Record(Schema.String, Schema.Json);
const Context = Schema.StructWithRest(
  Schema.Struct({
    id: Sha256,
    inputHashes: Schema.Record(RelativePath, Sha256),
    factorioVersion: Version,
    capturedAt: Schema.NonEmptyString,
  }),
  [jsonObject],
);
const Snapshot = Schema.Struct({ context: Context });
const nativeList = Schema.Union([Schema.Array(jsonObject), Schema.Struct({})]);
const Prototype = Schema.StructWithRest(
  Schema.Struct({
    place_result: Schema.optionalKey(Schema.String),
    localised_description: Schema.optionalKey(Schema.Json),
    custom_tooltip_fields: Schema.optionalKey(nativeList),
    hidden: Schema.optionalKey(Schema.Boolean),
    hide_from_player_crafting: Schema.optionalKey(Schema.Boolean),
    results: Schema.optionalKey(nativeList),
  }),
  [jsonObject],
);
const Raw = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Prototype),
);
const Report = Schema.Struct({
  kind: Schema.Literal(
    "offline historical prototype replay; not a current engine or visual test",
  ),
  snapshot: Context,
  annotationContext: Schema.Struct({
    mods: ModVersions,
    startup: Schema.Record(
      Schema.String,
      Schema.Struct({ value: Schema.Boolean }),
    ),
    features: Schema.Record(Schema.String, Schema.Boolean),
  }),
  helperProgramSha256: Sha256,
  dossiers: Count,
  targets: Count,
  counts: Schema.Record(Schema.String, Count),
  placementPairs: Count,
  craftingRecipes: Count,
  existingDescriptions: Count,
  existingTooltipFields: Count,
  isolation: Schema.Struct({
    unselectedPrototypes: Count,
    fullyAnnotatedTypes: Schema.Array(Schema.String),
  }),
  output: Schema.String,
});
/**
 * @param {import("../../../tools/projects.ts").ResolvedProject} project
 * @param {unknown} input
 */
export function replayHistorical(project, input) {
  return Effect.gen(function* () {
    const options = yield* decode(Options, input, "historical replay inputs");
    const fs = yield* FileSystem.FileSystem;
    const { content } = yield* compileContent(project, "check");
    const bytes = yield* fs.readFile(options.raw);
    const snapshot = yield* readJSON(Snapshot, options.snapshot, true);
    const historical = content.game.historicalCapture;
    if (
      sha256(bytes) !== historical.rawSha256 ||
      snapshot.context.id !== historical.snapshotId ||
      snapshot.context.inputHashes["script-output/data-raw-dump.json"] !==
        historical.rawSha256 ||
      snapshot.context.factorioVersion !== historical.factorioVersion
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: "historical capture",
          message: "Capture identity differs from reviewed corpus provenance",
        }),
      );
    const raw = yield* decodeJSON(Raw, bytes, "historical prototype capture");
    const fixtures = {};
    let existingDescriptions = 0;
    let existingTooltipFields = 0;
    for (const entry of content.entries) {
      for (const target of entry.targets) {
        const [type, name] = target.split("/");
        const prototype = raw[type]?.[name];
        if (!prototype)
          throw new Error(
            `Historical capture lacks ${target}; do not silently omit targets`,
          );
        (fixtures[type] ??= {})[name] = prototype;
        if (prototype.localised_description !== undefined)
          existingDescriptions++;
        existingTooltipFields += prototype.custom_tooltip_fields?.length ?? 0;
      }
    }
    // Keep each real placement item alongside its entity: native item tooltips compose both.
    const placementPairs = [];
    const machineTypes = new Map(
      content.entries
        .flatMap((entry) => entry.targets)
        .map((target) => target.split("/"))
        .filter(([type]) => content.types.machine.has(type))
        .map(([type, name]) => [name, type]),
    );
    for (const [type, group] of Object.entries(raw)) {
      for (const [name, prototype] of Object.entries(group)) {
        if (!machineTypes.has(prototype.place_result)) continue;
        (fixtures[type] ??= {})[name] = prototype;
        placementPairs.push({
          type,
          name,
          entity: prototype.place_result,
          entityType: machineTypes.get(prototype.place_result),
        });
      }
    }
    for (const [name, type] of machineTypes) {
      if (!placementPairs.some((pair) => pair.entity === name))
        throw new Error(`No captured placement item for ${type}/${name}`);
    }
    // Native Crafting uses a recipe card followed by product cards; placement items compose their entity.
    const noteByTarget = new Map(
      content.entries.flatMap((entry) =>
        entry.targets.map((target) => [target, entry.id]),
      ),
    );
    const itemTypes = new Map();
    const entityTypes = new Map();
    for (const [type, group] of Object.entries(raw)) {
      const index = content.types.machine.has(type)
        ? entityTypes
        : content.types.material.has(type) && type !== "fluid"
          ? itemTypes
          : null;
      if (index) for (const name of Object.keys(group)) index.set(name, type);
    }
    const craftingRoutes = [];
    for (const [name, recipe] of Object.entries(raw.recipe)) {
      if (recipe.hidden || recipe.hide_from_player_crafting) continue;
      const cards = [{ kind: "recipe", targets: [["recipe", name]] }];
      if (
        recipe.results &&
        !Array.isArray(recipe.results) &&
        Object.keys(recipe.results).length
      )
        throw new Error(`${name}: unexpected captured result representation`);
      for (const product of Array.isArray(recipe.results)
        ? recipe.results
        : []) {
        const type =
          product.type === "fluid" ? "fluid" : itemTypes.get(product.name);
        if (!type || !raw[type]?.[product.name])
          throw new Error(`${name}: missing captured product ${product.name}`);
        const targets = [[type, product.name]];
        const entity = raw[type][product.name].place_result;
        if (entity) {
          if (!entityTypes.has(entity))
            throw new Error(
              `${name}: missing captured placement entity ${entity}`,
            );
          targets.push([entityTypes.get(entity), entity]);
        }
        cards.push({ kind: "product", targets });
      }
      for (const card of cards)
        card.notes = card.targets
          .map((target) => noteByTarget.get(target.join("/")))
          .filter(Boolean);
      if (!cards.some((card) => card.notes.length)) continue;
      for (const card of cards) {
        for (const [type, target] of card.targets)
          (fixtures[type] ??= {})[target] = raw[type][target];
      }
      craftingRoutes.push({ name, cards });
    }
    for (const name of ["diborane", "burner-inserter", "transport-belt"]) {
      if (!craftingRoutes.some((route) => route.name === name))
        throw new Error(`Missing Crafting route: ${name}`);
    }
    // Keep an actual unannotated prototype where one exists; complete families have no spare member.
    const isolation = { unselectedPrototypes: 0, fullyAnnotatedTypes: [] };
    for (const type of Object.keys(fixtures)) {
      const unselected = Object.keys(raw[type]).find(
        (name) => !noteByTarget.has(`${type}/${name}`),
      );
      if (unselected === undefined) isolation.fullyAnnotatedTypes.push(type);
      else {
        fixtures[type][unselected] = raw[type][unselected];
        isolation.unselectedPrototypes++;
      }
    }
    const locale = Object.fromEntries(
      [
        ...parseLocale(
          yield* fs.readFileString(
            join(project.modRoot, "locale/en/py-research-dossier.cfg"),
          ),
        ),
      ].map(([key, value]) => [key, value.replaceAll("\\n", "\n")]),
    );
    // Exercise every source-conditional family. These are explicit replay inputs, not recovered settings.
    const annotationContext = {
      mods: Object.fromEntries(
        Object.entries(content.game.reviewedMods).map(([name, mod]) => [
          name,
          mod.version,
        ]),
      ),
      startup: { "enable-cranes": { value: true } },
      features: { space_travel: true },
    };
    const helper = yield* helperSource(project);
    const source =
      helper +
      `
local check = require("dev.fixtures.assertions")
local raw = ${luaValue(fixtures)}
local before = check.copy(raw)
local context = ${luaValue(annotationContext)}
local environment = {data = {raw = raw}, py = py, require = require, mods = context.mods,
    settings = {startup = context.startup}, feature_flags = context.features}
assert(loadfile("data-final-fixes.lua", "t", environment))()
local catalogue = require("dossier.catalog")(context.mods, context.startup, context.features)
local count = check.only_annotations(before, raw, catalogue)
local placement_pairs = ${luaValue(placementPairs)}
for _, pair in ipairs(placement_pairs) do
    local item = raw[pair.type][pair.name]
    local entity = raw[pair.entityType][pair.entity]
    check.equal(before[pair.type][pair.name], item, pair.type .. "/" .. pair.name)
    local notes = 0
    for _, prototype in ipairs({item, entity}) do
        for _, field in ipairs(prototype.custom_tooltip_fields or {}) do
            if field.show_in_tooltip ~= false and type(field.value) == "table" and field.value[1] == "py-research-dossier.note" then
                notes = notes + 1
            end
        end
    end
    assert(notes == 1, pair.name .. ": duplicate or missing composed tooltip note")
end
print("Placement overlap checked: " .. #placement_pairs .. " actual item/entity pairs; one research note per combined tooltip.")
local crafting_routes = ${luaValue(craftingRoutes)}
for _, route in ipairs(crafting_routes) do
    local process_note
    for _, card in ipairs(route.cards) do
        local actual = {}
        for _, target in ipairs(card.targets) do
            for _, field in ipairs(raw[target[1]][target[2]].custom_tooltip_fields or {}) do
                if field.show_in_tooltip ~= false and type(field.value) == "table" and field.value[1] == "py-research-dossier.note" then
                    actual[#actual + 1] = field.value[2][1]
                end
            end
        end
        assert(#actual == #card.notes, route.name .. ": missing or extra Crafting note")
        assert(#actual <= 1, route.name .. ": duplicated note in a composed card")
        for i, id in ipairs(card.notes) do
            assert(actual[i] == "py-research-dossier.topic-" .. id, route.name .. ": wrong Crafting note")
            if card.kind == "recipe" then process_note = id
            else assert(id ~= process_note, route.name .. ": process text repeated on product card") end
        end
    end
end
print("Crafting composition checked: " .. #crafting_routes .. " covered recipe routes, including fluid-only products and entity-owned equipment notes.")
local locale = ${luaValue(locale)}
local function localise(value, depth)
    if type(value) == "string" then return value end
    assert(depth < 20 and #value <= 21, "LocalisedString exceeds API bounds")
    local template = assert(locale[value[1]], "Unknown locale key: " .. value[1])
    return (string.gsub(template, "__(%d+)__", function(index)
        return localise(assert(value[tonumber(index) + 1], "Missing locale parameter"), depth + 1)
    end))
end
for _, entry in ipairs(catalogue) do
    for _, target in ipairs(entry.targets) do
        local fields = raw[target[1]][target[2]].custom_tooltip_fields
        localise(fields[#fields - 1].value, 0)
        localise(fields[#fields].name, 0)
        localise(fields[#fields].value, 0)
    end
end
print("Entry point replayed: " .. count .. " targets; every original prototype field preserved except appended custom_tooltip_fields.")
for _, target in ipairs({
    {"assembling-machine", "tar-processing-unit"}, {"fluid", "coal-gas"}, {"item", "raw-coal"},
    {"item", "ash"}, {"item", "kerogen"}, {"module", "fawogae"}, {"module", "ulric"},
    {"item", "grade-1-iron"}, {"item", "grade-1-zinc"}, {"recipe", "diborane"}, {"fluid", "diborane"},
    {"inserter", "burner-inserter"}, {"transport-belt", "transport-belt"},
    {"underground-belt", "underground-belt"}, {"electric-pole", "small-electric-pole"},
    {"pipe", "pipe"}, {"boiler", "boiler"}, {"assembling-machine", "distilator"},
    {"assembling-machine", "electronics-factory-mk01"}, {"item", "inductor1"},
    {"item", "capacitor1"}, {"recipe", "copper-plate"}, {"item", "copper-plate"}, {"recipe", "latex-slab"}
}) do
    local fields = raw[target[1]][target[2]].custom_tooltip_fields
    print(target[1] .. "/" .. target[2] .. "\\n" .. localise(fields[#fields - 1].value, 0))
end
`;
    const stdout = yield* runLua(project, source);
    const report = {
      kind: "offline historical prototype replay; not a current engine or visual test",
      snapshot: snapshot.context,
      annotationContext,
      helperProgramSha256: sha256(helper),
      dossiers: content.entries.length,
      targets: content.targetCount,
      counts: content.counts,
      placementPairs: placementPairs.length,
      craftingRecipes: craftingRoutes.length,
      existingDescriptions,
      existingTooltipFields,
      isolation,
      output: stdout,
    };
    const checked = yield* decode(Report, report, "historical replay result");
    yield* prepareOutputDirectory(project.outputRoot);
    const output = join(project.outputRoot, "historical-replay.json");
    yield* assertCanonicalPath(output);
    yield* fs.writeFileString(output, JSON.stringify(checked, null, 2) + "\n");
    return { output, report: checked };
  });
}
