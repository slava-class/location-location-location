import {test, expect} from 'bun:test';
import {resolve} from 'node:path';

// Exercise the real Lua model and lookup code. Only the engine-owned objects are fixtures;
// these tests do not launch Factorio or claim to verify native GUI/engine behavior.
const fixture = String.raw`
local function deepcopy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, entry in pairs(value) do result[key] = deepcopy(entry) end
    return result
end
package.preload["__core__.lualib.util"] = function() return { table = { deepcopy = deepcopy } } end
local function item(name) return { type = "item", name = name } end
local function fluid(name) return { type = "fluid", name = name } end
local function product(entry, probability, minimum, maximum)
    entry.independent_probability = probability or 1
    entry.shared_probability = { min = minimum or 0, max = maximum or 1 }
    return entry
end
prototypes = { recipe = {
    gear = { name = "gear", ingredients = { item("plate") }, products = { product(item("gear")) } },
    circuit = { name = "circuit", ingredients = { item("plate"), item("cable") }, products = { product(item("circuit")) } },
    recycle = { name = "recycle", ingredients = { fluid("water"), item("plate") }, products = { product(fluid("water")), product(item("gear")) } },
    gear_user = { name = "gear_user", ingredients = { item("gear") }, products = { product(item("machine")) } },
    water_user = { name = "water_user", ingredients = { fluid("water") }, products = { product(fluid("steam")) } },
} }
storage = {}
local force = { index = 7 }
local surface = { index = 3 }
local player = { index = 1, force = force, surface_index = 3, surface = surface, position = { x = 0, y = 0 } }
local entities = {}
surface.find_entities_filtered = function(filter)
    local result = {}
    for _, entity in ipairs(entities) do
        if entity.valid and entity.force == filter.force then result[#result + 1] = entity end
    end
    return result
end
force.is_chunk_charted = function(_, chunk) return chunk.x >= 0 and chunk.x < 4 end
force.add_chart_tag = function(_, spec)
    local tag = { valid = true, force = force, surface = surface, position = spec.position, text = spec.text, icon = spec.icon }
    tag.destroy = function() tag.valid = false end
    return tag
end
game = { surfaces = { [3] = surface } }
local function anchor(x, y)
    return { valid = true, surface = surface, position = { x = x, y = y or 0 } }
end
local function machine(recipe, x, y, unit)
    local entity = anchor(x, y)
    entity.force, entity.type, entity.unit_number = force, "assembling-machine", unit or #entities + 1
    entity.get_recipe = function() return prototypes.recipe[recipe] end
    entities[#entities + 1] = entity
    return entity
end
local model = require("location_location_location.planner")
local sources = require("location_location_location.sources")
model.initialize()
local function draft(names)
    local plan = model.new(player)
    assert(model.set_recipes(plan, names))
    return plan
end
local function near(position, x, y)
    assert(position and math.abs(position.x - x) < 0.000001 and math.abs(position.y - (y or 0)) < 0.000001)
end
`;

function luaTest(name, body) {
  test(name, async () => {
    const child = Bun.spawn(['lua', '-'], {
      cwd: resolve(import.meta.dir, '..'),
      stdin: new Blob([fixture, '\n', body]),
      stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0);
  });
}

luaTest('multiple recipes deduplicate connections and preserve only still-applicable assignments', String.raw`
local plan = draft({ "gear" })
assert(model.select(plan, "input", "item/plate", { anchor(8) }, "add", 3))
assert(model.select(plan, "output", "item/gear", { anchor(80) }, "add", 3))
assert(model.set_recipes(plan, { "gear", "circuit", "gear" }))
assert(#plan.recipes == 2 and plan.recipes[1] == "gear" and plan.recipes[2] == "circuit")
assert(#plan.ingredients == 2 and #plan.outputs == 2)
near(model.connection(plan, "input", "item/plate").anchors["8:0"], 8)
near(model.connection(plan, "output", "item/gear").anchors["80:0"], 80)
plan.title = "Shared production"
assert(model.set_recipes(plan, { "circuit" }))
assert(plan.title == "Shared production" and not model.connection(plan, "output", "item/gear"))
near(model.center(plan), 8)
local before = plan.recipes
assert(not model.set_recipes(plan, { "gear", "missing" }))
assert(plan.recipes == before and plan.title == "Shared production")
near(model.center(plan), 8)
`);

luaTest('the same fluid can have independent source and destination sets with equal per-connection weight', String.raw`
local plan = draft({ "recycle" })
assert(model.select(plan, "input", "fluid/water", { anchor(0), anchor(10) }, "replace", 3))
assert(model.select(plan, "output", "fluid/water", { anchor(100) }, "replace", 3))
local position, assigned, total = model.center(plan)
near(position, 52.5)
assert(assigned == 2 and total == 4)
assert(not model.select(plan, "output", "fluid/water", { anchor(200) }, "replace", 4))
near(model.center(plan), 52.5)
assert(model.select(plan, "output", "fluid/water", { anchor(120) }, "add", 3))
near(model.center(plan), 57.5)
assert(model.select(plan, "output", "fluid/water", { anchor(100) }, "remove", 3))
near(model.center(plan), 62.5)
assert(model.select(plan, "input", "fluid/water", {}, "replace", 3))
near(model.center(plan), 120)
assert(model.connection(plan, "input", "fluid/water") ~= model.connection(plan, "output", "fluid/water"))
`);

luaTest('output edits remain private, count as edits, survive Apply, and respect stale revisions', String.raw`
local saved = assert(model.apply(player, draft({ "gear", "circuit" })))
local edited = assert(model.load(player, saved.id))
assert(model.select(edited, "output", "item/gear", { anchor(40, 6) }, "add", 3))
assert(model.change_count(player, edited) == 1)
assert(not model.position(model.load(player, saved.id)))
local stale = model.load(player, saved.id)
saved = assert(model.apply(player, edited))
near(model.position(model.load(player, saved.id)), 40, 6)
assert(model.change_count(player, saved) == 0)
local tag = storage.location_location_location.plans[saved.id].tag
assert(tag.icon.name == "gear")
assert(model.select(stale, "output", "item/gear", { anchor(400) }, "replace", 3))
local rejected, err = model.apply(player, stale)
assert(not rejected and err[1] == "location-location-location.conflict")
near(tag.position, 40, 6)
local private = model.load(player, saved.id)
assert(model.set_recipes(private, { "circuit" }))
assert(model.change_count(player, private) == 2)
assert(model.has_recipe(model.load(player, saved.id), "gear"))
`);

luaTest('single-recipe saves and private drafts migrate once without moving markers or losing identity', String.raw`
local legacy = {
    id = 4, revision = 9, force_index = 7, surface_index = 3, recipe = "gear", title = "Workshop",
    hide_label = true, retired = true, marker_position = { x = 2, y = 3 },
    ingredients = { { key = "item/plate", type = "item", name = "plate", anchors = { origin = { x = 12, y = 4 } } } },
    tag = { position = { x = 50, y = 60 }, text = "Existing label" },
}
local tag = legacy.tag
storage.location_location_location = {
    next_id = 8, plans = { [4] = legacy }, sessions = { [1] = { draft = deepcopy(legacy) } },
    preferences = { [1] = { researched_only = false } }, highlights = {},
}
model.initialize()
local state = storage.location_location_location
assert(state.schema_version == 2 and state.next_id == 8)
assert(legacy.recipe == nil and #legacy.recipes == 1 and legacy.recipes[1] == "gear")
assert(legacy.id == 4 and legacy.revision == 9 and legacy.retired and legacy.hide_label and legacy.title == "Workshop")
assert(legacy.tag == tag and tag.text == "Existing label")
near(tag.position, 50, 60)
near(legacy.marker_position, 2, 3)
near(model.connection(legacy, "input", "item/plate").anchors.origin, 12, 4)
assert(model.connection(legacy, "output", "item/gear"))
local private = state.sessions[1].draft
assert(private.recipe == nil and private.recipes[1] == "gear" and private.ingredients ~= legacy.ingredients)
assert(model.change_count(player, private) == 0 and not state.preferences[1].researched_only)
assert(model.select(legacy, "output", "item/gear", { anchor(90) }, "add", 3))
model.initialize()
near(model.connection(legacy, "output", "item/gear").anchors["90:0"], 90)
`);

luaTest('several removed recipes can be removed individually without stranding the remaining plan', String.raw`
local plan = draft({ "gear", "circuit", "recycle" })
assert(model.select(plan, "input", "item/plate", { anchor(18) }, "add", 3))
local saved = assert(model.apply(player, plan))
prototypes.recipe.gear, prototypes.recipe.circuit = nil, nil
local reopened = assert(model.load(player, saved.id))
assert(not model.apply(player, reopened))
assert(model.set_recipes(reopened, { "circuit", "recycle" }))
assert(not model.valid_recipes(reopened))
near(model.connection(reopened, "input", "item/plate").anchors["18:0"], 18)
assert(model.set_recipes(reopened, { "recycle" }))
assert(model.valid_recipes(reopened) and #reopened.outputs == 2)
near(model.center(reopened), 18)
assert(model.apply(player, reopened))
`);

luaTest('impossible products do not become destinations or mask a later possible duplicate', String.raw`
prototypes.recipe.random = {
    name = "random", ingredients = { item("plate") }, products = {
        product(item("impossible"), 0), product(item("empty-range"), 1, 0.5, 0.5),
        product(item("gear"), 0), product(item("gear"), 0.25),
    },
}
local plan = draft({ "random", "gear" })
assert(#plan.outputs == 1 and plan.outputs[1].key == "item/gear")
assert(not model.connection(plan, "output", "item/impossible"))
assert(not model.connection(plan, "output", "item/empty-range"))
`);

luaTest('output lookup finds charted consumers, not producers, for both items and fluids', String.raw`
local plan = draft({ "recycle" })
machine("recycle", 1, 0)
local uncharted = machine("gear_user", -1, 0)
local wrong_force = machine("gear_user", 2, 0)
wrong_force.force = { index = 8 }
local first = machine("gear_user", 8, 3, 10)
local second = machine("gear_user", 8, -3, 20)
assert(sources.closest(player, plan, "output", "item/gear") == first)
first.valid = false
assert(sources.closest(player, plan, "output", "item/gear") == second)
local water = machine("water_user", 0, 0)
assert(sources.closest(player, plan, "output", "fluid/water") == water)
assert(sources.closest(player, plan, "input", "fluid/water") == entities[1])
second.valid = false
local missing, reason, severity = sources.closest(player, plan, "output", "item/gear")
assert(not missing and reason[1] == "location-location-location.no-consumer" and severity == "info")
surface.platform = { force = force }
assert(sources.closest(player, plan, "output", "item/gear") == uncharted)
player.force = { index = 8 }
assert(not sources.closest(player, plan, "output", "item/gear"))
player.force, player.surface_index = force, 4
assert(not sources.closest(player, plan, "output", "item/gear"))
`);

luaTest('recipe prototype updates reconcile both sides without changing the saved marker until Apply', String.raw`
local plan = draft({ "gear", "circuit" })
assert(model.select(plan, "input", "item/plate", { anchor(0) }, "add", 3))
assert(model.select(plan, "input", "item/cable", { anchor(10) }, "add", 3))
assert(model.select(plan, "output", "item/gear", { anchor(80) }, "add", 3))
assert(model.select(plan, "output", "item/circuit", { anchor(100) }, "add", 3))
local saved = assert(model.apply(player, plan))
local tag = storage.location_location_location.plans[saved.id].tag
near(tag.position, 47.5)
prototypes.recipe.circuit.ingredients = { item("plate") }
prototypes.recipe.circuit.products = { product(item("new-circuit")) }
local reopened = assert(model.load(player, saved.id))
assert(not model.connection(reopened, "input", "item/cable"))
assert(not model.connection(reopened, "output", "item/circuit"))
assert(model.connection(reopened, "output", "item/new-circuit"))
near(model.connection(reopened, "output", "item/gear").anchors["80:0"], 80)
near(model.center(reopened), 40)
near(tag.position, 47.5)
assert(model.change_count(player, reopened) == 2)
assert(model.apply(player, reopened))
near(tag.position, 40)
`);
