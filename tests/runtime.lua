local selection = require("map_tag_generator.event_handlers.selection")
local gui_events = require("map_tag_generator.event_handlers.gui")
local add_gui = require("map_tag_generator.gui.add_tags")
local delete_gui = require("map_tag_generator.gui.delete_tags")
local edit_gui = require("map_tag_generator.gui.edit_icon")
local mtg = require("map_tag_generator.constants")

local player, state, surface, other, a, b, c
local modes = {
    replace = defines.events.on_player_selected_area,
    add = defines.events.on_player_alt_selected_area,
    remove = defines.events.on_player_alt_reverse_selected_area,
}
local function select(mode, entities, target)
    selection.events[modes[mode]]({
        player_index = player.index, item = "map_tag_generator_selection_tool", entities = entities,
        surface = target or surface, area = {left_top = {x = -2, y = -2}, right_bottom = {x = 16, y = 10}},
    })
end
local function count()
    local total = 0
    for _, entities in pairs(state.matching_entities) do total = total + #entities end
    return total
end
local function center(x, y)
    local position = state.gui.add_tags.preview_minimap.position
    assert(math.abs(position.x - x) < 0.0001 and math.abs(position.y - y) < 0.0001,
        "wrong centroid: "..position.x..","..position.y.."; expected "..x..","..y)
end
local function icons() return state.gui.add_tags.icon_button_table.children end
local function click(element, button)
    local id = defines.events.on_gui_click
    script.get_event_handler(id)({name = id, tick = game.tick, player_index = player.index,
        element = element, button = button or defines.mouse_button_type.left})
end
local function machine(x, y, target)
    local entity = (target or surface).create_entity({name = "assembling-machine-1", position = {x, y}, force = player.force})
    entity.set_recipe("iron-gear-wheel")
    return entity
end
local function cleanup()
    local p = game.get_player(1)
    local s = storage.player_table[p.index]
    if s.gui.add_tags then add_gui.close_window(p) end
    if s.gui.delete_tags then delete_gui.close_window(p) end
    p.opened = nil
    p.clear_cursor()
    p.set_controller({type = defines.controllers.god})
    for _, name in ipairs({"map-tag-tests", "map-tag-tests-other"}) do
        local target = game.surfaces[name]
        if target then
            for _, entity in pairs(target.find_entities()) do entity.destroy() end
            for _, tag in pairs(p.force.find_chart_tags(target)) do tag.destroy() end
        end
    end
end

before_all(function()
    for _, name in ipairs({"map-tag-tests", "map-tag-tests-other"}) do
        local target = game.create_surface(name, {width = 96, height = 96})
        target.request_to_generate_chunks({0, 0}, 2)
        target.force_generate_chunk_requests()
        local tiles = {}
        for x = -32, 32 do for y = -32, 32 do tiles[#tiles + 1] = {name = "lab-dark-1", position = {x, y}} end end
        target.set_tiles(tiles)
        target.always_day = true
    end
end)
before_each(function()
    cleanup()
    player = game.get_player(1)
    state = storage.player_table[player.index]
    surface, other = game.surfaces["map-tag-tests"], game.surfaces["map-tag-tests-other"]
    player.teleport({6, 12}, surface)
    player.force.chart(surface, {{-32, -32}, {32, 32}})
    player.cursor_stack.set_stack({name = "map_tag_generator_selection_tool"})
    state.position_style = mtg.position_styles.average_of_entities
    state.layout_style = mtg.layout_styles.horizontal
    state.add_tags_dialog, state.always_add_tags_dialog, state.delete_tags_dialog = true, true, true
    state.included_categories.assemblers = true
    state.included_categories.resources = true
    state.included_categories.train_stops = true
    a, b, c = machine(0.5, 0.5), machine(12.5, 0.5), machine(0.5, 6.5)
end)
after_each(cleanup)

describe("entity selection", function()
    test("normal selection replaces rather than accumulates", function()
        select("replace", {a, b})
        select("replace", {c})
        assert(count() == 1)
        center(0.5, 6.5)
    end)
    test("add computes the arithmetic centroid, not the bounding-box midpoint", function()
        select("replace", {a})
        select("add", {b, c})
        assert(count() == 3)
        center(4.5, 2.5)
    end)
    test("overlapping additions do not count an entity twice", function()
        select("replace", {a, b})
        select("add", {a, b, c})
        assert(count() == 3)
        center(4.5, 2.5)
    end)
    test("subtract removes only selected entities", function()
        select("replace", {a, b, c})
        select("remove", {b})
        assert(count() == 2)
        center(0.5, 3.5)
    end)
    test("subtracting an unselected entity leaves the selection unchanged", function()
        select("replace", {a, c})
        select("remove", {b})
        assert(count() == 2)
        center(0.5, 3.5)
    end)
    test("subtract-all disables confirmation and permits adding again", function()
        select("replace", {a, b})
        select("remove", {a, b})
        assert(count() == 0 and not state.gui.add_tags.confirm_button.enabled)
        select("add", {c})
        assert(state.gui.add_tags.confirm_button.enabled)
        center(0.5, 6.5)
    end)
    test("subtract without a pending selection cannot add entities", function()
        select("remove", {a, b})
        assert(count() == 0 and not state.gui.add_tags.confirm_button.enabled)
    end)
    test("destroyed suppliers are pruned on the next edit", function()
        select("replace", {a, b})
        a.destroy()
        select("add", {c})
        assert(count() == 2)
        center(6.5, 3.5)
    end)
    test("resource tiles deduplicate without unit numbers and refresh totals", function()
        local first = surface.create_entity({name = "iron-ore", position = {20.5, 0.5}, amount = 100})
        local second = surface.create_entity({name = "iron-ore", position = {22.5, 0.5}, amount = 300})
        select("replace", {first})
        select("add", {surface.find_entity("iron-ore", first.position), second})
        assert(count() == 2 and icons()[1].tags.tag_table.text:find("400", 1, true))
        center(21.5, 0.5)
        select("remove", {first})
        assert(count() == 1 and icons()[1].tags.tag_table.text:find("300", 1, true))
        center(22.5, 0.5)
    end)
    test("entity ghosts contribute once to the centroid", function()
        local ghost = surface.create_entity({name = "entity-ghost", inner_name = "assembling-machine-1",
            position = {20.5, 0.5}, force = player.force})
        select("replace", {a})
        select("add", {ghost, ghost})
        assert(count() == 2)
        center(10.5, 0.5)
    end)
    test("disabled categories do not contribute to the centroid", function()
        state.included_categories.resources = false
        local ore = surface.create_entity({name = "iron-ore", position = {20.5, 0.5}, amount = 100})
        select("replace", {a, ore})
        assert(count() == 1)
        center(0.5, 0.5)
    end)
    test("normal no-dialog selection still immediately creates a marker", function()
        state.add_tags_dialog = false
        select("replace", {a, b, c})
        local tags = player.force.find_chart_tags(surface)
        assert(not state.gui.add_tags and #tags == 1)
        assert(tags[1].position.x == 4.5 and tags[1].position.y == 2.5)
    end)
    test("add always previews even when normal selection skips the dialog", function()
        state.add_tags_dialog = false
        select("add", {a})
        assert(state.gui.add_tags and #player.force.find_chart_tags(surface) == 0)
    end)
end)

describe("selection dialog lifecycle", function()
    test("world selection remains non-modal and retains its moved dialog", function()
        select("replace", {a})
        local window = state.gui.add_tags.map_tag_generator_add_tags_window
        assert(player.opened ~= window, "a modal dialog is closed by the engine before the next world drag")
        assert(player.cursor_stack.name == "map_tag_generator_selection_tool")
        window.location = {x = 24, y = 80}
        select("add", {b, c})
        assert(window == state.gui.add_tags.map_tag_generator_add_tags_window)
        assert(window.location.x == 24 and window.location.y == 80)
        center(4.5, 2.5)
    end)
    test("clearing the cursor cancels through the real engine event", function()
        select("replace", {a})
        player.clear_cursor()
        after_ticks(1, function()
            assert(not state.gui.add_tags and not state.selection_event)
        end)
    end)
    test("changing surfaces cancels through the real engine event", function()
        select("replace", {a, b})
        player.teleport({0, 0}, other)
        after_ticks(1, function()
            assert(not state.gui.add_tags and not state.selection_event)
            local supplier = machine(20.5, 0.5, other)
            select("add", {supplier}, other)
            assert(count() == 1)
            center(20.5, 0.5)
        end)
    end)
    test("Cancel prevents previous suppliers returning in a new selection", function()
        select("replace", {a, b})
        click(state.gui.add_tags.cancel_button)
        assert(not state.gui.add_tags and not state.selection_event)
        select("add", {c})
        assert(count() == 1)
        center(0.5, 6.5)
    end)
    test("foreign selection tools do not replace pending state", function()
        select("replace", {a, b})
        for _, id in pairs(modes) do
            selection.events[id]({player_index = player.index, item = "other-tool", entities = {}, surface = surface})
        end
        assert(count() == 2)
        center(6.5, 0.5)
    end)
    test("keyboard confirmation creates the centroid marker and ends the session", function()
        select("replace", {a, b, c})
        gui_events.events["map_tag_generator_confirm_gui_linked"]({player_index = player.index})
        local tags = player.force.find_chart_tags(surface)
        assert(#tags == 1 and tags[1].position.x == 4.5 and tags[1].position.y == 2.5)
        assert(not state.gui.add_tags and not state.selection_event)
    end)
    test("keyboard confirmation cannot submit an empty selection", function()
        select("remove", {a})
        gui_events.events["map_tag_generator_confirm_gui_linked"]({player_index = player.index})
        assert(state.gui.add_tags and #player.force.find_chart_tags(surface) == 0)
    end)
    test("pending supplier references survive script reload", function()
        select("replace", {a, b})
    end).after_reload_script(function()
        player = game.get_player(1)
        state = storage.player_table[player.index]
        surface = game.surfaces["map-tag-tests"]
        local third = surface.find_entity("assembling-machine-1", {0.5, 6.5})
        select("add", {third})
        assert(count() == 3)
        center(4.5, 2.5)
    end)
end)

describe("tag choices while refining selection", function()
    test("disabled generated icons stay disabled after addition", function()
        select("replace", {a})
        click(icons()[1])
        select("add", {b})
        assert(not icons()[1].tags.tag_table.enabled and not state.gui.add_tags.confirm_button.enabled)
    end)
    test("edited icon and text survive and the editor returns to non-modal selection", function()
        select("replace", {a})
        click(icons()[1], defines.mouse_button_type.right)
        state.gui.edit_icon.name_textfield.text = "My supplier"
        state.gui.edit_icon.choose_icon_button.elem_value = {type = "item", name = "copper-plate"}
        edit_gui.confirm_window(player)
        edit_gui.close_window(player)
        assert(player.opened ~= state.gui.add_tags.map_tag_generator_add_tags_window)
        select("add", {b})
        assert(icons()[1].tags.tag_table.text == "My supplier")
        assert(icons()[1].tags.tag_table.signal.name == "copper-plate")
    end)
    test("selection events do not invalidate a currently open icon editor", function()
        select("replace", {a})
        click(icons()[1], defines.mouse_button_type.right)
        local editor = state.gui.edit_icon.map_tag_generator_edit_icon_window
        select("add", {b})
        assert(count() == 1 and editor.valid)
    end)
    test("manual tags survive removing every supplier", function()
        select("replace", {a})
        click(state.gui.add_tags.add_icon_button)
        state.gui.edit_icon.name_textfield.text = "Candidate"
        state.gui.edit_icon.choose_icon_button.elem_value = {type = "item", name = "iron-plate"}
        edit_gui.confirm_window(player)
        edit_gui.close_window(player)
        select("remove", {a})
        assert(#icons() == 1 and icons()[1].tags.tag_table.text == "Candidate")
        assert(state.gui.add_tags.confirm_button.enabled)
    end)
    test("generated tags disappear when their last supplying entity is removed", function()
        c.set_recipe("copper-cable")
        select("replace", {a, c})
        assert(#icons() == 2)
        select("remove", {c})
        assert(#icons() == 1 and icons()[1].tags.tag_table.signal.name == "iron-gear-wheel")
    end)
    test("position and layout choices survive selection edits", function()
        select("replace", {a})
        state.position_style_temp = mtg.position_styles.middle_of_entities
        state.layout_style_temp = mtg.layout_styles.vertical
        select("add", {b, c})
        assert(state.position_style_temp == mtg.position_styles.middle_of_entities)
        assert(state.layout_style_temp == mtg.layout_styles.vertical)
        center(6.5, 3.5)
    end)
    test("same-name train stops remain distinct by position", function()
        local first = surface.create_entity({name = "train-stop", position = {20, 10}, force = player.force})
        local second = surface.create_entity({name = "train-stop", position = {26, 10}, force = player.force})
        first.backer_name, second.backer_name = "Supplies", "Supplies"
        select("replace", {first})
        select("add", {second})
        assert(#icons() == 2)
        select("remove", {first})
        assert(#icons() == 1 and icons()[1].tags.tag_table.position.x == second.position.x)
    end)
end)

describe("separate map-tag eraser", function()
    test("subtracting suppliers never deletes existing chart tags", function()
        local tag = player.force.add_chart_tag(surface, {position = {4.5, 2.5}, text = "Keep"})
        select("replace", {a, b})
        select("remove", {a, b})
        assert(tag.valid and #player.force.find_chart_tags(surface) == 1)
    end)
    test("plain reverse selection cannot erase tags outside chart view", function()
        local tag = player.force.add_chart_tag(surface, {position = {4.5, 2.5}, text = "Existing"})
        selection.events[defines.events.on_player_reverse_selected_area]({
            player_index = player.index, item = "map_tag_generator_selection_tool", entities = {}, surface = surface,
            area = {left_top = {x = -5, y = -5}, right_bottom = {x = 15, y = 10}},
        })
        assert(not state.gui.delete_tags and tag.valid)
    end)
    test("Cancel in the eraser leaves selected chart tags intact", function()
        local tag = player.force.add_chart_tag(surface, {position = {4.5, 2.5}, text = "Existing"})
        state.tags_selected_for_deletion = {tag}
        delete_gui.build_window(player)
        click(state.gui.delete_tags.cancel_button)
        assert(tag.valid and not state.gui.delete_tags)
    end)
    test("Confirm in the eraser deletes only selected chart tags", function()
        local remove = player.force.add_chart_tag(surface, {position = {4.5, 2.5}, text = "Remove"})
        local keep = player.force.add_chart_tag(surface, {position = {8.5, 2.5}, text = "Keep"})
        state.tags_selected_for_deletion = {remove, keep}
        delete_gui.build_window(player)
        click(state.gui.delete_tags.icon_button_table.children[2])
        click(state.gui.delete_tags.confirm_button)
        assert(not remove.valid and keep.valid and not state.gui.delete_tags)
    end)
end)
