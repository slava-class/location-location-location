import { test } from "bun:test";
import { helperSource, project, runLua } from "./test-support.ts";
import { renderContent } from "./content.ts";
import { luaValue } from "./lib.mjs";

const harness =
  (await helperSource()) +
  '\nlocal apply = require("dossier.apply")\nlocal check = require("dev.fixtures.assertions")\n';

test("preserves warnings and mechanics without leaking through shared tooltip arrays or same-name prototypes", async () => {
  await runLua(
    harness +
      `
local fields = {{name = {"original.label"}, value = {"original.warning"}, order = 4, show_in_factoriopedia = false}}
local raw = {
    recipe = {
        sample = {name = "sample", localised_description = {"", {"metadata-warning"}, "\\nKeep this warning"}, custom_tooltip_fields = fields, energy_required = 3, ingredients = {{name = "coal", amount = 10}}, results = {{name = "tar", amount = 30}}, enabled = false, hidden = true, allow_productivity = true},
        sibling = {name = "sibling", custom_tooltip_fields = fields, category = "chemistry"},
        untouched = {name = "untouched", custom_tooltip_fields = fields, energy_required = 9},
    },
    item = {sample = {name = "sample", localised_name = {"inherited-name"}, stack_size = 50, fuel_value = "8MJ"}},
    fluid = {sample = {name = "sample", default_temperature = 15, max_temperature = 100}},
}
local catalogue = {
    {id = "recipe-note", targets = {{"recipe", "sample"}, {"recipe", "sibling"}}},
    {id = "item-note", targets = {{"item", "sample"}}},
}
local before = check.copy(raw)
apply(raw, catalogue, py.add_to_description)
check.only_annotations(before, raw, catalogue)
assert(raw.recipe.sample.custom_tooltip_fields ~= fields, "Shared array was mutated")
assert(raw.recipe.sibling.custom_tooltip_fields ~= raw.recipe.sample.custom_tooltip_fields, "Sibling arrays were aliased")
assert(#fields == 1, "Unselected owner received research notes")
assert(raw.recipe.sample.custom_tooltip_fields[1] == fields[1], "Existing field was unnecessarily replaced")
`,
  );
});

test("a missing qualified target fails before any valid prototype is changed", async () => {
  await runLua(
    harness +
      `
local raw = {recipe = {present = {name = "present", enabled = false}}}
local before = check.copy(raw)
local catalogue = {{id = "missing", targets = {{"recipe", "present"}, {"fluid", "absent"}}}}
local ok, message = pcall(apply, raw, catalogue, py.add_to_description)
assert(not ok and string.find(message, "missing fluid/absent", 1, true), "Missing target did not identify the exact prototype")
check.equal(before, raw)
`,
  );
});

test("duplicate ownership is rejected before it can duplicate notes", async () => {
  await runLua(
    harness +
      `
local raw = {recipe = {present = {name = "present", custom_tooltip_fields = {{name = "Old", value = "Keep"}}}}}
local before = check.copy(raw)
local catalogue = {
    {id = "first", targets = {{"recipe", "present"}}},
    {id = "second", targets = {{"recipe", "present"}}},
}
local ok, message = pcall(apply, raw, catalogue, py.add_to_description)
assert(not ok and string.find(message, "duplicate target recipe/present", 1, true), "Duplicate ownership was accepted")
check.equal(before, raw)
`,
  );
});

test("a machine item and its placed entity contribute only one research note to a combined tooltip", async () => {
  await runLua(
    harness +
      `
local catalogue = require("dossier.catalog")({}, {["enable-cranes"] = {value = false}}, {})
local family
for _, entry in ipairs(catalogue) do
    for _, target in ipairs(entry.targets) do
        if target[1] == "assembling-machine" and target[2] == "tar-processing-unit" then
            family = entry
        end
    end
end
assert(family, "Tar processing family is missing")
local raw = {item = {}, ["assembling-machine"] = {}}
local names = {"tar-processing-unit", "tar-processing-unit-mk02", "tar-processing-unit-mk03", "tar-processing-unit-mk04"}
for _, name in ipairs(names) do
    raw.item[name] = {name = name, place_result = name, stack_size = 10}
    raw["assembling-machine"][name] = {name = name, minable = {result = name}, crafting_speed = 1}
end
local before = check.copy(raw)
apply(raw, {family}, py.add_to_description)
check.only_annotations(before, raw, {family})
for _, name in ipairs(names) do
    -- The reported native tooltip combines fields from both related prototypes.
    local visible = 0
    for _, prototype in ipairs({raw.item[name], raw["assembling-machine"][name]}) do
        for _, field in ipairs(prototype.custom_tooltip_fields or {}) do
            if field.show_in_tooltip ~= false then visible = visible + 1 end
        end
    end
    assert(visible == 1, name .. ": duplicate research note in item/entity tooltip")
    check.equal(before.item[name], raw.item[name], name .. "/placement-item")
end
`,
  );
});

test("creation conditions exclude unavailable families but never excuse a missing active target", async () => {
  const entries = [
    { id: "always", targets: ["recipe/always"] },
    { id: "mod", targets: ["recipe/mod"], when: { mod: "optional-mod" } },
    {
      id: "startup",
      targets: ["recipe/startup"],
      when: { startup: "enabled" },
    },
    {
      id: "feature",
      targets: ["recipe/feature"],
      when: { featureFlag: "space_travel" },
    },
    {
      id: "combined",
      targets: ["recipe/combined"],
      when: {
        startup: "enabled",
        mod: "optional-mod",
        featureFlag: "space_travel",
      },
    },
  ].map((entry) => ({
    ...entry,
    topic: "Context",
    text: "Context",
    discipline: "engineering",
    basis: "real",
    sources: [],
  }));
  const factory = renderContent({ entries, sources: {} }, project.info).get(
    "dossier/catalog.lua",
  );
  const optionalFactory = renderContent(
    { entries: [entries[4]], sources: {} },
    project.info,
  ).get("dossier/catalog.lua");
  await runLua(
    harness +
      `
local factory = (function()
${factory}
end)()
local optional_factory = (function()
${optionalFactory}
end)()
local absent_mod_raw = {recipe = {combined = {name = "combined"}}}
local absent_mod_before = check.copy(absent_mod_raw)
apply(absent_mod_raw, optional_factory({}, {}, {space_travel = true}), py.add_to_description)
check.equal(absent_mod_before, absent_mod_raw, "An absent mod must not access its unavailable startup setting")
for mod = 0, 1 do
    for startup = 0, 1 do
        for feature = 0, 1 do
            local raw = {recipe = {always = {name = "always"}, dormant = {name = "dormant"}}}
            local expected = {always = true, mod = mod == 1, startup = startup == 1, feature = feature == 1,
                combined = mod == 1 and startup == 1 and feature == 1}
            for name, enabled in pairs(expected) do
                if enabled then raw.recipe[name] = {name = name} end
            end
            local before = check.copy(raw)
            local catalogue = factory({["optional-mod"] = mod == 1 and "1.0" or nil},
                {enabled = {value = startup == 1}}, {space_travel = feature == 1})
            apply(raw, catalogue, py.add_to_description)
            check.only_annotations(before, raw, catalogue)
            for name, enabled in pairs(expected) do
                if enabled then
                    assert(raw.recipe[name].custom_tooltip_fields[1].value[2][1] == "py-research-dossier.topic-" .. name)
                else
                    assert(raw.recipe[name] == nil, "Inactive family was created")
                end
            end
            check.equal(before.recipe.dormant, raw.recipe.dormant)
        end
    end
end
local raw = {recipe = {always = {name = "always"}, mod = {name = "mod"}}}
local before = check.copy(raw)
apply(raw, factory({}, {enabled = {value = false}}, {}), py.add_to_description)
check.equal(before.recipe.mod, raw.recipe.mod, "Existing but inactive family must stay untouched")
raw = {recipe = {always = {name = "always"}}}
before = check.copy(raw)
local ok, message = pcall(apply, raw, factory({["optional-mod"] = "1.0"}, {enabled = {value = false}}, {}), py.add_to_description)
assert(not ok and string.find(message, "missing recipe/mod", 1, true))
check.equal(before, raw, "Active missing target must fail atomically")
`,
  );
});

test("Lua string literals preserve ASCII escapes and multibyte Unicode bytes", async () => {
  const value =
    "\0" +
    "123" +
    String.fromCharCode(
      ...Array.from({ length: 32 }, (_, index) => index),
      127,
      128,
      159,
    ) +
    '9"\\ research 研究 ' +
    String.fromCodePoint(0x1d11e);
  await runLua(`
local value = ${luaValue(value)}
local bytes = {}
for index = 1, #value do bytes[index] = string.format("%02x", string.byte(value, index)) end
assert(table.concat(bytes) == ${luaValue(Buffer.from(value).toString("hex"))})
`);
});
