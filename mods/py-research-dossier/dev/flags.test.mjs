import { expect, test } from "bun:test";
import { runLua } from "./test-support.ts";

const harness = 'local env = require("dev.fixtures.flag-environment")\n';
const records = (output) =>
  output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("hovered recipe and identically named item remain distinct feedback targets", async () => {
  const output = await runLua(
    harness +
      `
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "recipe", name = "same"}})
local window = env.window()
window.body.note.text = [[Explain "this"
without losing the newline.]]
env.fire("on_gui_click", {element = window.body.actions.expand})
assert(not env.window(), "Submitted dialog stayed open")
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "item", name = "same"}})
env.fire("on_gui_click", {element = env.window().body.actions.missing})
env.dump()
`,
  );
  const [recipe, item] = records(output);
  expect(recipe.target).toEqual({
    base_type: "recipe",
    type: "recipe",
    name: "same",
    id: "recipe/same",
  });
  expect(recipe.dossier_note).toBe("recipe-note");
  expect(recipe.note).toBe('Explain "this"\nwithout losing the newline.');
  expect(item.target.id).toBe("item/same");
  expect(item.dossier_note).toBeUndefined();
  expect([recipe.reason, item.reason]).toEqual(["expand", "missing"]);
});

test("changing picker type clears a stale same-name selection and cannot submit it", async () => {
  const output = await runLua(
    harness +
      `
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "recipe", name = "same"}})
local window = env.window()
window.body.note.text = "Keep my draft while I choose"
window.body.selection.kind.selected_index = 1
env.fire("on_gui_selection_state_changed", {element = window.body.selection.kind})
assert(window.body.selection.picker.elem_value == nil, "Old recipe leaked into item picker")
assert(not window.body.actions.change.enabled, "An empty selection remained actionable")
env.fire("on_gui_click", {element = window.body.actions.change})
assert(#env.writes == 0 and env.window() == window, "Stale selection was logged or draft discarded")
window.body.selection.picker.elem_value = "same"
env.fire("on_gui_elem_changed", {element = window.body.selection.picker})
env.fire("on_gui_click", {element = window.body.actions.change})
env.dump()
`,
  );
  expect(records(output)).toMatchObject([
    {
      target: { id: "item/same" },
      reason: "change",
      note: "Keep my draft while I choose",
    },
  ]);
});

test("a draft survives repeated shortcuts and controller reload, while cancellation logs nothing", async () => {
  const output = await runLua(
    harness +
      `
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "recipe", name = "Moss-1"}})
local window = env.window()
window.body.note.text = "Why does this need stone?"
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "item", name = "same"}})
assert(env.window() == window and window.tags.target.name == "Moss-1", "Shortcut replaced draft")
package.loaded["dossier.flag-gui"], package.loaded["dossier.flags"] = nil, nil
env.events = require("dossier.flag-gui").events
env.fire("on_gui_click", {element = window.body.actions.change})
env.fire("on_lua_shortcut", {prototype_name = "py-research-dossier-flag"})
window = env.window()
window.body.note.text = "Unsubmitted"
env.fire("on_gui_closed", {element = window})
assert(not env.window() and #env.writes == 1, "Closing the dialog created an unwanted flag")
env.dump()
`,
  );
  expect(records(output)).toMatchObject([
    {
      target: { id: "recipe/Moss-1" },
      reason: "change",
      note: "Why does this need stone?",
    },
  ]);
});

test("item subtypes and placement ownership are recorded without changing the reported target", async () => {
  const output = await runLua(
    harness +
      `
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "item", name = "plant_unit"}})
env.fire("on_gui_click", {element = env.window().body.actions.expand})
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "item", name = "moss"}})
env.fire("on_gui_click", {element = env.window().body.actions.change})
env.dump()
`,
  );
  const [plant, moss] = records(output);
  expect(plant.target.id).toBe("item-with-entity-data/plant_unit");
  expect(plant.placed_entity).toEqual({
    type: "furnace",
    name: "plant_unit",
    id: "furnace/plant_unit",
  });
  expect(plant.dossier_note).toBeUndefined();
  expect(plant.placed_entity_dossier_note).toBe("plant-note");
  expect(moss.target.id).toBe("module/moss");
  expect(moss.dossier_note).toBe("moss-note");
});

test("unlocked fluid-only recipes can be searched and flagged independently of native signal visibility", async () => {
  const output = await runLua(
    harness +
      `
env.fire("on_lua_shortcut", {prototype_name = "py-research-dossier-flag"})
local window = env.window()
window.body.recipes.query.text = "DIBORANE"
env.fire("on_gui_text_changed", {element = window.body.recipes.query})
local choices = window.body.recipes.results.children
assert(#choices == 1 and choices[1].tags.recipe == "diborane")
env.fire("on_gui_click", {element = choices[1]})
env.fire("on_gui_click", {element = window.body.actions.missing})
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "fluid", name = "diborane"}})
env.fire("on_gui_click", {element = env.window().body.actions.expand})
env.dump()
`,
  );
  expect(records(output).map((record) => record.target.id)).toEqual([
    "recipe/diborane",
    "fluid/diborane",
  ]);
});

test("the recipe list follows force unlocks and crafting visibility, not handcrafting or ingredient filters", async () => {
  await runLua(
    harness +
      `
local recipes = require("dossier.recipes")
env.player.force.recipes.same.enabled = false
env.player.force.recipes["Moss-1"].hidden = true
prototypes.recipe["burner-inserter"].hidden_from_player_crafting = true
prototypes.recipe.diborane.ingredients = {}
prototypes.recipe.diborane.products = {{type = "fluid", name = "diborane", amount = 150}}
prototypes.recipe.diborane.category = "electrolyzer"
local matches = recipes.search(env.player, "")
assert(#matches == 1 and matches[1].name == "diborane")
env.player.force.recipes.same.enabled = true
matches = recipes.search(env.player, "same")
assert(#matches == 1 and matches[1].name == "same", "Newly unlocked recipe stayed absent")
`,
  );
});

test("recipe search supports translated names and exact native IDs, then refreshes when translations arrive", async () => {
  await runLua(
    harness +
      `
local recipes = require("dossier.recipes")
local matches = recipes.search(env.player, "MECHANICAL")
assert(#matches == 1 and matches[1].name == "burner-inserter")
env.translations = nil
matches = recipes.search(env.player, "burner-inserter")
assert(#matches == 1 and matches[1].name == "burner-inserter")
env.fire("on_lua_shortcut", {prototype_name = "py-research-dossier-flag"})
local browser = env.window().body.recipes
browser.query.text = "Mechanical"
env.fire("on_gui_text_changed", {element = browser.query})
assert(#browser.results.children == 0 and browser.translating.visible)
env.translations = {["burner-inserter"] = "Mechanical inserter"}
env.fire("dictionaries-ready", {})
assert(#browser.results.children == 1 and not browser.translating.visible)
`,
  );
});

test("a hovered target is retained even outside the unlocked crafting list", async () => {
  const output = await runLua(
    harness +
      `
env.player.force.recipes.diborane.enabled = false
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "recipe", name = "diborane"}})
env.fire("on_gui_click", {element = env.window().body.actions.change})
env.dump()
`,
  );
  expect(records(output)[0].target.id).toBe("recipe/diborane");
});

test("upgrading the released widget-owned draft preserves both target and note", async () => {
  const output = await runLua(
    harness +
      `
env.fire("py-research-dossier-flag", {selected_prototype = {base_type = "item", name = "same"}})
local window = env.window()
window.tags = {}
window.body.note.text = "Keep this across the update"
require("dossier.flag-gui").on_configuration_changed({mod_changes = {["py-research-dossier"] = {old_version = "0.3.0"}}})
env.fire("on_gui_click", {element = env.window().body.actions.change})
env.dump()
`,
  );
  expect(records(output)).toMatchObject([
    { target: { id: "item/same" }, note: "Keep this across the update" },
  ]);
});

test("paging keeps exact recipe identities and excludes a recipe disabled while the dialog is open", async () => {
  const output = await runLua(
    harness +
      `
for i = 1, 18 do
    local name = string.format("extra_%02d", i)
    local prototype = {type = "recipe", name = name, localised_name = name}
    prototypes.recipe[name] = prototype
    env.player.force.recipes[name] = {name = name, enabled = true, prototype = prototype}
end
env.fire("on_lua_shortcut", {prototype_name = "py-research-dossier-flag"})
local window = env.window()
local browser = window.body.recipes
browser.query.text = "extra_"
env.fire("on_gui_text_changed", {element = browser.query})
env.fire("on_gui_click", {element = browser.pages.next})
env.fire("on_gui_click", {element = browser.pages.next})
local last = browser.results.children[2]
assert(last.tags.recipe == "extra_18", "Last page lost recipe identity")
env.player.force.recipes.extra_18.enabled = false
env.fire("on_gui_click", {element = last})
assert(not window.body.actions.missing.enabled, "Disabled recipe remained selectable")
env.fire("on_gui_click", {element = browser.results.children[1]})
env.fire("on_gui_click", {element = window.body.actions.missing})
env.dump()
`,
  );
  expect(records(output)[0].target.id).toBe("recipe/extra_17");
});
