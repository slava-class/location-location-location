local model = require("location_location_location.planner")
local gui = require("location_location_location.gui.planner")
local sources = require("location_location_location.sources")
local player, surface, team, other_force, a, b, c
-- Chart requests finish on the engine tick after setup, before each test starts.
ticks_between_tests(1)
local function session() return storage.location_location_location.sessions[player.index] end
local function emit(id, data)
    data.name, data.tick, data.player_index = id, game.tick, player.index
    script.get_event_handler(id)(data)
end
local function click(element)
    emit(defines.events.on_gui_click, {element = element, button = defines.mouse_button_type.left})
end
local function choose(name)
    if not session().picker then click(session().gui.recipe) end
    local prototype = prototypes.recipe[name]
    local product = prototype.main_product or prototype.products[1]
    local search = session().gui.search
    search.text = product.name
    emit(defines.events.on_gui_text_changed, {element = search})
    local slot = session().gui["product_"..product.type.."/"..product.name]
    assert(slot and slot.visible, "Product missing from filtered picker: "..product.name)
    click(slot)
    if session().picker then click(session().gui["recipe_"..name]) end
    assert(session().draft.recipe == name)
end
local function select(mode, entities)
    local modes = {replace = defines.events.on_player_selected_area, add = defines.events.on_player_alt_selected_area,
        remove = defines.events.on_player_alt_reverse_selected_area}
    emit(modes[mode], {item = "location_location_location_planner_tool", entities = entities, surface = surface,
        area = {left_top = {x = -3, y = -3}, right_bottom = {x = 25, y = 4}}})
end
local function near(position, x, y)
    assert(position and math.abs(position.x - x) < 0.0001 and math.abs(position.y - y) < 0.0001, "wrong planner position")
end
local function draft()
    local value = model.new(player)
    assert(model.set_recipe(value, "electronic-circuit"))
    return value
end
local function populated()
    local value = draft()
    value.hide_label = false
    assert(model.select(value, "item/iron-plate", {a, b}, "add", surface.index))
    assert(model.select(value, "item/copper-cable", {c}, "add", surface.index))
    return value
end
local function apply(value)
    local result, err = model.apply(player, value)
    assert(result, err and err[1])
    return result, storage.location_location_location.plans[result.id].tag
end
local function start()
    emit(defines.events.on_lua_shortcut, {prototype_name = "location_location_location_open_planner"})
    click(session().gui.new)
    choose("electronic-circuit")
end
local function cleanup()
    local p = game.get_player(1)
    gui.close(p)
    sources.clear(p.index)
    local preferences = model.preferences(p)
    preferences.researched_only, preferences.show_retired, preferences.highlight_sources = true, false, false
    preferences.picker_group = nil
    p.clear_cursor()
    p.force = game.forces.player
    for _, plan in pairs(storage.location_location_location.plans) do
        if plan.tag and plan.tag.valid then plan.tag.destroy() end
    end
    storage.location_location_location.plans = {}
    if surface then
        for _, entity in pairs(surface.find_entities()) do entity.destroy() end
    end
end

before_all(function()
    surface = game.create_surface("recipe-planner-tests", {width = 128, height = 128})
    surface.request_to_generate_chunks({0, 0}, 2)
    surface.force_generate_chunk_requests()
    local tiles = {}
    for x = -32, 32 do for y = -32, 32 do tiles[#tiles + 1] = {name = "lab-dark-1", position = {x, y}} end end
    surface.set_tiles(tiles)
    team, other_force = game.create_force("planner-tests-team"), game.create_force("planner-tests-other")
    team.chart(surface, {{-32, -32}, {32, 32}})
end)
before_each(function()
    surface = game.surfaces["recipe-planner-tests"]
    team, other_force = game.forces["planner-tests-team"], game.forces["planner-tests-other"]
    cleanup()
    player = game.get_player(1)
    player.set_controller({type = defines.controllers.god})
    player.force = team
    team.recipes["electronic-circuit"].enabled = true
    team.recipes["iron-gear-wheel"].enabled = true
    player.teleport({0, 8}, surface)
    team.chart(surface, {{-32, -32}, {32, 32}})
    a = surface.create_entity({name = "wooden-chest", position = {0.5, 0.5}, force = team})
    b = surface.create_entity({name = "transport-belt", position = {10.5, 0.5}, force = team})
    c = surface.create_entity({name = "wooden-chest", position = {20.5, 0.5}, force = team})
end)
after_each(cleanup)

describe("source navigation", function()
    test("Find replaces and expires only its own navigation pin", function()
        local personal = player.add_pin({entity = c})
        sources.find(player, a)
        local first = storage.location_location_location.highlights[player.index].guide.pin
        assert(first.targets[1] == a and first.always_visible)
        sources.find(player, b)
        local second = storage.location_location_location.highlights[player.index].guide.pin
        assert(not first.valid and second.targets[1] == b and personal.valid)
        sources.expire({tick = game.tick + 1799})
        assert(second.valid)
        sources.expire({tick = game.tick + 1800})
        assert(not second.valid and personal.valid)
        personal.destroy()
    end)
    test("removed targets and dismissed pins leave no stale guidance", function()
        sources.find(player, a)
        local pin = storage.location_location_location.highlights[player.index].guide.pin
        a.destroy()
        sources.expire({tick = game.tick})
        assert(not pin.valid and not storage.location_location_location.highlights[player.index].guide)
        sources.find(player, b)
        storage.location_location_location.highlights[player.index].guide.pin.destroy()
        sources.expire({tick = game.tick})
        assert(not storage.location_location_location.highlights[player.index].guide)
        sources.find(player, c)
        local final = storage.location_location_location.highlights[player.index].guide.pin
        sources.clear(player.index)
        assert(not final.valid)
    end)
end)

describe("compact drafting and marker placement", function()
    test("New opens the product picker without creating a saved plan", function()
        gui.open(player)
        click(session().gui.new)
        assert(session().picker and player.opened == session().gui.picker_frame)
        assert(session().draft and not session().draft.id and not session().draft.recipe)
        assert(next(storage.location_location_location.plans) == nil)
        choose("electronic-circuit")
        assert(not session().picker and session().draft.recipe == "electronic-circuit")
        assert(next(storage.location_location_location.plans) == nil)
    end)
    test("pinned Add closest edits only the private ingredient sources", function()
        local saved, tag = apply(populated())
        team.recipes["copper-cable"].enabled = true
        local producer = surface.create_entity({name = "assembling-machine-2", position = {5.5, 8.5}, force = team})
        producer.set_recipe("copper-cable")
        assert(producer.get_recipe() and producer.get_recipe().name == "copper-cable", "Fixture producer must have its recipe")
        after_ticks(1, function()
            assert(team.is_chunk_charted(surface, {0, 0}), "Fixture producer must be charted")
            gui.open(player); click(session().gui["plan_"..saved.id]); click(session().gui.pin)
            local index
            for i, ingredient in ipairs(session().draft.ingredients) do
                if ingredient.key == "item/copper-cable" then index = i end
            end
            click(session().gui["clear_"..index]); click(session().gui["closest_"..index])
            local anchors = model.ingredient(session().draft, "item/copper-cable").anchors
            assert(table_size(anchors) == 1, "Add closest must find the charted copper-cable producer")
            for _, position in pairs(anchors) do near(position, producer.position.x, producer.position.y) end
            local original = model.ingredient(storage.location_location_location.plans[saved.id], "item/copper-cable").anchors
            assert(table_size(original) == 1)
            for _, position in pairs(original) do near(position, 20.5, 0.5) end
            near(tag.position, 13, 0.5)
            click(session().gui.discard)
            for _, position in pairs(original) do near(position, 20.5, 0.5) end
        end)
    end)
    test("pinning and expanding preserve the titlebar anchor after dragging either mode", function()
        start()
        local frame = session().gui.frame
        frame.location = {x = 140, y = 120}
        click(session().gui.pin)
        near(frame.location, 140, 120)
        frame.location = {x = 210, y = 180}
        click(session().gui.pin)
        near(frame.location, 210, 180)
        frame.location = {x = 90, y = 70}
        click(session().gui.pin)
        near(frame.location, 90, 70)
        click(session().gui.pin)
        near(frame.location, 90, 70)
    end)
    test("Selecting toggles off without discarding edits and another ingredient switches selection", function()
        local saved, tag = apply(populated())
        for _, compact in ipairs({false, true}) do
            gui.open(player); click(session().gui["plan_"..saved.id])
            if compact then click(session().gui.pin) end
            click(session().gui.select_1); select("replace", {a})
            local draft = session().draft
            click(session().gui.select_1)
            assert(not session().selecting and not player.cursor_stack.valid_for_read)
            assert(session().draft == draft and table_size(draft.ingredients[1].anchors) == 1)
            near(tag.position, 13, 0.5)
            assert((player.opened == session().gui.frame) == not compact)
            click(session().gui.select_2); click(session().gui.select_1)
            assert(session().selecting and session().active_key == draft.ingredients[1].key)
            click(session().gui.select_1)
            assert(not session().selecting and (model.change_count(player, draft) > 0))
        end
    end)
    test("pinning preserves a private draft across walking, selection, and expansion", function()
        local saved, tag = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id])
        local current = session().draft
        click(session().gui.pin)
        assert(session().compact and not player.opened)
        player.teleport({4, 8}, surface)
        click(session().gui.select_1); select("replace", {a})
        player.clear_cursor()
        emit(defines.events.on_player_cursor_stack_changed, {})
        assert(session().compact and not player.opened and not session().selecting)
        near(model.center(current), 10.5, 0.5)
        near(tag.position, 13, 0.5)
        click(session().gui.pin)
        assert(not session().compact and session().draft == current and player.opened == session().gui.frame)
        click(session().gui.pin); click(session().gui.apply)
        assert(session().compact and not player.opened and not (model.change_count(player, session().draft) > 0))
        near(tag.position, 10.5, 0.5)
    end)
    test("compact Discard restores saved sources and placement without closing", function()
        local saved, tag = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id]); click(session().gui.pin)
        click(session().gui.clear_1)
        click(session().gui.move_marker); select("replace", {})
        near(model.position(session().draft), 11, 0.5)
        click(session().gui.discard)
        assert(session().compact and not player.opened)
        local restored = session().draft
        assert(restored.id == saved.id and model.change_count(player, restored) == 0)
        assert(not session().gui.discard.enabled)
        assert(not restored.marker_position and table_size(restored.ingredients[1].anchors) == 2)
        near(tag.position, 13, 0.5)
    end)
    test("Discard reloads the latest saved revision and cancels active selection", function()
        local saved = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id])
        local title = session().gui.title
        title.text = "Private edit"
        emit(defines.events.on_gui_text_changed, {element = title})
        local newer = model.load(player, saved.id)
        newer.title = "Updated by teammate"
        newer = apply(newer)
        click(session().gui.select_1)
        click(session().gui.discard)
        assert(session().draft.title == newer.title and session().draft.revision == newer.revision)
        assert(not session().selecting and not player.cursor_stack.valid_for_read)
        assert(player.opened == session().gui.frame and model.change_count(player, session().draft) == 0)
        assert(not session().gui.discard.enabled)
    end)
    test("manual marker placement is private until Apply and does not select sources", function()
        local saved, tag = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id])
        click(session().gui.move_marker); select("replace", {})
        assert(not session().selecting and not player.cursor_stack.valid_for_read)
        near(model.position(session().draft), 11, 0.5)
        near(model.center(session().draft), 13, 0.5)
        near(tag.position, 13, 0.5)
        assert((model.change_count(player, session().draft) > 0))
        click(session().gui.apply)
        near(tag.position, 11, 0.5)
        local reloaded = model.load(player, saved.id)
        near(reloaded.marker_position, 11, 0.5)
        reloaded.marker_position.x = 9
        near(storage.location_location_location.plans[saved.id].marker_position, 11, 0.5)
        click(session().gui.clear_1); click(session().gui.apply)
        near(tag.position, 11, 0.5)
        click(session().gui.reset_marker)
        assert(not session().draft.marker_position and (model.change_count(player, session().draft) > 0))
        near(model.position(session().draft), 20.5, 0.5)
        near(tag.position, 11, 0.5)
        click(session().gui.apply)
        near(tag.position, 20.5, 0.5)
    end)
    test("marker selection ignores additive drags and foreign surfaces and can be paused", function()
        start(); click(session().gui.move_marker)
        select("add", {a})
        assert(not session().draft.marker_position and session().selecting)
        emit(defines.events.on_player_selected_area, {item = "location_location_location_planner_tool", entities = {},
            surface = game.surfaces.nauvis, area = {left_top = {x = 0, y = 0}, right_bottom = {x = 2, y = 2}}})
        assert(not session().draft.marker_position and session().gui.notice_panel.visible)
        player.clear_cursor()
        emit(defines.events.on_player_cursor_stack_changed, {})
        assert(not session().selecting and not session().selection_mode)
        select("replace", {})
        assert(not session().draft.marker_position)
    end)
    test("a recipe tag can save a chosen marker before assigning sources", function()
        start(); click(session().gui.move_marker); select("replace", {})
        assert(session().gui.apply.enabled)
        click(session().gui.apply)
        local saved = storage.location_location_location.plans[session().draft.id]
        near(saved.tag.position, 11, 0.5)
        local _, assigned = model.center(saved)
        assert(assigned == 0)
    end)
    test("manual position mode is dirty even when its coordinates equal the suggestion", function()
        local saved = apply(populated())
        local value = model.load(player, saved.id)
        value.marker_position = model.center(value)
        assert((model.change_count(player, value) > 0))
        local updated = apply(value)
        assert(not (model.change_count(player, updated) > 0))
        updated.marker_position = nil
        assert((model.change_count(player, updated) > 0))
    end)
    test("compact draft and manual marker selection survive script reload", function()
        local saved = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id]); click(session().gui.pin)
        click(session().gui.move_marker); select("replace", {})
        click(session().gui.select_1); select("replace", {a})
    end).after_reload_script(function()
        player = game.get_player(1)
        local current = session()
        assert(current.compact and current.gui.frame.valid and not player.opened)
        near(current.draft.marker_position, 11, 0.5)
        near(model.center(current.draft), 10.5, 0.5)
        local saved = storage.location_location_location.plans[current.draft.id]
        near(saved.tag.position, 13, 0.5)
        click(current.gui.apply)
        near(saved.tag.position, 11, 0.5)
    end)
end)

describe("recipe planner selection", function()
    test("choosing a recipe prepares ingredients without creating a plan", function()
        start()
        assert(session().draft.recipe == "electronic-circuit")
        assert(#session().draft.ingredients == 2)
        assert(#model.list(player) == 0)
        assert(session().gui.apply.enabled)
    end)
    test("copy from machine uses its configured recipe", function()
        start()
        local machine = surface.create_entity({name = "assembling-machine-1", position = {4.5, 4.5}, force = team})
        machine.set_recipe("iron-gear-wheel")
        click(session().gui.machine)
        select("replace", {machine})
        assert(session().draft.recipe == "iron-gear-wheel")
        assert(not session().selecting)
    end)
    test("Copy from machine leaves the product picker and fills the same private draft", function()
        gui.open(player); click(session().gui.new)
        local draft, picker_frame = session().draft, session().gui.picker_frame
        local machine = surface.create_entity({name = "assembling-machine-1", position = {4.5, 4.5}, force = team})
        machine.set_recipe("iron-gear-wheel")
        click(session().gui.picker_machine)
        assert(not session().picker and not picker_frame.valid and not player.opened)
        assert(session().selecting and session().selection_mode == "machine" and session().draft == draft)
        select("replace", {machine})
        assert(session().draft == draft and draft.recipe == "iron-gear-wheel")
        assert(not session().selecting and player.opened == session().gui.frame)
        assert(#model.list(player) == 0 and #team.find_chart_tags(surface) == 0)
    end)
    test("ambiguous machine selection does not replace the chosen recipe", function()
        start()
        local first = surface.create_entity({name = "assembling-machine-1", position = {4.5, 4.5}, force = team})
        local second = surface.create_entity({name = "assembling-machine-1", position = {8.5, 4.5}, force = team})
        first.set_recipe("iron-gear-wheel"); second.set_recipe("iron-gear-wheel")
        click(session().gui.machine)
        select("replace", {first, second})
        assert(session().draft.recipe == "electronic-circuit")
    end)
    test("ingredient selection accepts empty chests and belts and retains the window position", function()
        start()
        session().gui.frame.location = {x = 70, y = 90}
        local key = session().draft.ingredients[1].key
        click(session().gui.select_1)
        select("replace", {a})
        select("add", {a, b})
        assert(table_size(model.ingredient(session().draft, key).anchors) == 2)
        select("remove", {a})
        near(model.center(session().draft), 10.5, 0.5)
        assert(session().gui.frame.location.x == 70 and session().gui.frame.location.y == 90)
        assert(player.cursor_stack.name == "location_location_location_planner_tool")
    end)
    test("each assigned ingredient has equal weight regardless of its anchor count", function()
        local position, assigned, total = model.center(populated())
        near(position, 13, 0.5)
        assert(assigned == 2 and total == 2)
    end)
    test("partial plans exclude unassigned ingredients and visibly label the marker", function()
        local value = draft()
        value.hide_label = false
        model.select(value, "item/iron-plate", {a, b}, "replace", surface.index)
        local _, tag = apply(value)
        near(tag.position, 5.5, 0.5)
        assert(tag.text:find("[1/2]", 1, true))
    end)
    test("No label is private, reversible, and persists an icon-only marker without losing its name", function()
        local value = draft()
        value.hide_label = false
        value.title = "Circuit supply"
        model.select(value, "item/iron-plate", {a}, "replace", surface.index)
        local saved, tag = apply(value)
        gui.open(player); click(session().gui["plan_"..saved.id])
        local function hide_label(state)
            local checkbox = session().gui.hide_label
            checkbox.state = state
            emit(defines.events.on_gui_checked_state_changed, {element = checkbox})
        end
        hide_label(true)
        assert(not session().gui.title.enabled and session().gui.title.text == "Circuit supply")
        assert(model.change_count(player, session().draft) == 1 and tag.text == "Circuit supply [1/2]")
        hide_label(false)
        assert(session().gui.title.enabled and session().gui.title.text == "Circuit supply")
        assert(model.change_count(player, session().draft) == 0)
        hide_label(true); click(session().gui.discard)
        assert(not session().draft.hide_label and not session().gui.hide_label.state)
        hide_label(true); click(session().gui.pin); click(session().gui.apply)
        assert(tag.text == "" and tag.icon.name == "electronic-circuit")
        assert(model.change_count(player, session().draft) == 0)
        click(session().gui.close)
        gui.open(player); click(session().gui["plan_"..saved.id])
        assert(session().draft.hide_label and session().draft.title == "Circuit supply")
        assert(not session().gui.title.enabled)
        assert(session().gui.title.text == "Circuit supply" and session().gui.hide_label.state)
        hide_label(false); click(session().gui.apply)
        assert(tag.text == "Circuit supply [1/2]" and #team.find_chart_tags(surface) == 1)
    end)
    test("new recipe tags save icon-only markers unless labeling is explicitly enabled", function()
        start()
        assert(not session().gui.title.enabled and model.change_count(player, session().draft) == 1)
        click(session().gui.move_marker); select("replace", {})
        click(session().gui.apply)
        local saved = storage.location_location_location.plans[session().draft.id]
        assert(saved.tag.text == "" and saved.tag.icon.name == "electronic-circuit")
        local checkbox = session().gui.hide_label
        checkbox.state = false
        emit(defines.events.on_gui_checked_state_changed, {element = checkbox})
        assert(session().gui.title.enabled and model.change_count(player, session().draft) == 1)
        click(session().gui.apply)
        assert(saved.tag.text == "electronic-circuit [0/2]")
    end)
    test("source-free recipe tags save and reopen from either editor mode", function()
        for _, compact in ipairs({false, true}) do
            start()
            if compact then click(session().gui.pin) end
            assert(session().gui.apply.enabled)
            click(session().gui.apply)
            local id = session().draft.id
            assert(id and not storage.location_location_location.plans[id].tag)
            assert(not (model.change_count(player, session().draft) > 0))
            click(session().gui.close)
            gui.open(player); click(session().gui["plan_"..id])
            assert(session().draft.recipe == "electronic-circuit")
            assert(not model.position(session().draft))
            click(session().gui.close)
        end
        assert(#model.list(player) == 2 and #team.find_chart_tags(surface) == 0)
    end)
    test("assigning and clearing the last source creates and removes only the recipe tag marker", function()
        local saved = apply(draft())
        assert(not storage.location_location_location.plans[saved.id].tag)
        model.select(saved, "item/iron-plate", {a}, "add", surface.index)
        local positioned, marker = apply(saved)
        near(marker.position, 0.5, 0.5)
        local unrelated = team.add_chart_tag(surface, {position = {4, 4}, text = "Unrelated"})
        model.ingredient(positioned, "item/iron-plate").anchors = {}
        local cleared = apply(positioned)
        assert(cleared.id == saved.id and cleared.revision == positioned.revision + 1)
        assert(not marker.valid and unrelated.valid)
        assert(not storage.location_location_location.plans[cleared.id].tag)
        assert(model.load(player, cleared.id).recipe == "electronic-circuit")
        unrelated.destroy()
    end)
    test("foreign tools and cross-surface selections do not change ingredient sources", function()
        start(); click(session().gui.select_1)
        emit(defines.events.on_player_selected_area, {item = "unrelated-selection-tool", entities = {},
            surface = surface, area = {left_top = {x = 0, y = 0}, right_bottom = {x = 1, y = 1}}})
        local value = populated()
        assert(not model.select(value, "item/iron-plate", {c}, "replace", game.surfaces.nauvis.index))
        near(model.center(value), 13, 0.5)
        assert(model.center(session().draft) == nil)
    end)
    test("recipe changes retain only matching ingredient assignments", function()
        local value = populated()
        model.set_recipe(value, "iron-gear-wheel")
        assert(#value.ingredients == 1 and value.ingredients[1].name == "iron-plate")
        near(model.center(value), 5.5, 0.5)
    end)
end)

describe("planner interface", function()
    test("the close button dismisses an editor directly without saving its draft", function()
        start()
        click(session().gui.select_1); select("replace", {a})
        local frame = session().gui.frame
        click(session().gui.close)
        assert(not session() and not frame.valid)
        assert(not player.cursor_stack.valid_for_read and #model.list(player) == 0)
    end)
    test("Discard returns new drafts to the list without closing the planner", function()
        for _, compact in ipairs({false, true}) do
            start()
            if compact then click(session().gui.pin) end
            click(session().gui.select_1)
            click(session().gui.discard)
            assert(session() and not session().draft and not session().compact)
            assert(player.opened == session().gui.frame and not player.cursor_stack.valid_for_read)
            assert(#model.list(player) == 0)
            click(session().gui.close)
        end
    end)
    test("the close button dismisses the recipe picker and underlying draft together", function()
        start(); click(session().gui.recipe)
        local frame, modal = session().gui.frame, session().gui.picker_frame
        click(session().gui.picker_close)
        assert(not session() and not frame.valid and not modal.valid and #model.list(player) == 0)
    end)
    test("the normal GUI close event dismisses the editor", function()
        start()
        assert(player.opened == session().gui.frame)
        player.opened = nil
        after_ticks(1, function() assert(not session()) end)
    end)
    test("the picker keeps its draft and workspace through modal navigation and normal close", function()
        start()
        local draft, frame = session().draft, session().gui.frame
        click(session().gui.recipe)
        after_ticks(1, function()
            assert(session().draft == draft and frame.valid and not frame.enabled)
            assert(player.opened == session().gui.picker_frame)
            click(session().gui.back_to_plan)
            assert(session().draft == draft and frame.enabled and player.opened == frame)
            click(session().gui.recipe)
            player.opened = nil
            after_ticks(1, function() assert(not session() and not frame.valid) end)
        end)
    end)
    test("net changes count source sets and remove reverted names and placement edits", function()
        local saved = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id])
        assert(model.change_count(player, session().draft) == 0)
        local title = session().gui.title
        title.text = "Temporary title"
        emit(defines.events.on_gui_text_changed, {element = title})
        assert(model.change_count(player, session().draft) == 1)
        assert(session().gui.discard.enabled)
        title.text = saved.title
        emit(defines.events.on_gui_text_changed, {element = title})
        assert(model.change_count(player, session().draft) == 0)
        assert(not session().gui.discard.enabled)
        click(session().gui.clear_1)
        assert(model.change_count(player, session().draft) == 1)
        click(session().gui.select_1); select("add", {a, b})
        assert(model.change_count(player, session().draft) == 0)
        select("remove", {b})
        assert(model.change_count(player, session().draft) == 1)
        session().draft.marker_position = model.position(session().draft)
        assert(model.change_count(player, session().draft) == 2)
        session().draft.title = "Combined edits"
        assert(model.change_count(player, session().draft) == 3)
        session().draft.title, session().draft.marker_position = saved.title, nil
        assert(model.change_count(player, session().draft) == 1)
        click(session().gui.apply)
        assert(model.change_count(player, session().draft) == 0)
        near(model.center(model.load(player, saved.id)), 10.5, 0.5)
        click(session().gui.new)
        assert(model.change_count(player, session().draft) == 0)
        choose("electronic-circuit")
        assert(model.change_count(player, session().draft) == 1)
    end)
    test("recipe diffs count discarded source sets but not automatic recipe-name updates", function()
        local value = apply(populated())
        model.set_recipe(value, "iron-gear-wheel")
        assert(model.change_count(player, value) == 2)
        model.set_recipe(value, "electronic-circuit")
        assert(model.change_count(player, value) == 1)
        model.select(value, "item/copper-cable", {c}, "add", surface.index)
        assert(model.change_count(player, value) == 0)
        value.title = "  Named tag  "
        value = apply(value)
        value.title = "  Named tag  "
        assert(model.change_count(player, value) == 0)
        local fresh = draft()
        assert(model.change_count(player, fresh) == 1)
        fresh.title, fresh.marker_position = "New tag", {x = 1, y = 2}
        model.select(fresh, "item/iron-plate", {a, b}, "add", surface.index)
        assert(model.change_count(player, fresh) == 4)
    end)
    test("detaching the modal editor for world selection does not close the planner", function()
        start(); click(session().gui.select_1)
        after_ticks(1, function()
            assert(session() and session().selecting and player.opened ~= session().gui.frame)
            select("replace", {a})
            near(model.center(session().draft), 0.5, 0.5)
        end)
    end)
    test("the planner shortcut toggles an open editor closed", function()
        start()
        emit(defines.events.on_lua_shortcut, {prototype_name = "location_location_location_open_planner"})
        assert(not session() and #model.list(player) == 0)
    end)
    test("a surface without a custom display name is not reported as missing", function()
        local saved = apply(populated())
        surface.localised_name = nil
        gui.open(player); click(session().gui["plan_"..saved.id])
        assert(session().gui.surface.caption == surface.name)
    end)
    test("surface navigation isolates plans and discards private edits without relocating sources", function()
        local saved = apply(populated())
        local remote_surface = game.create_surface("planner-navigation-surface", {width = 64, height = 64})
        remote_surface.request_to_generate_chunks({0, 0}, 1)
        remote_surface.force_generate_chunk_requests()
        remote_surface.set_tiles({{name = "lab-dark-1", position = {0, 0}}})
        team.chart(remote_surface, {{-32, -32}, {32, 32}})
        after_ticks(1, function()
            player.teleport({0, 8}, remote_surface)
            local anchor = remote_surface.create_entity({name = "wooden-chest", position = {0.5, 0.5}, force = team})
            local remote_draft = draft()
            model.select(remote_draft, "item/iron-plate", {anchor}, "add", remote_surface.index)
            local remote_plan = apply(remote_draft)
            player.teleport({0, 8}, surface)
            sources.toggle(player)
            gui.open(player)
            assert(session().gui["plan_"..saved.id] and not session().gui["plan_"..remote_plan.id])
            click(session().gui["plan_"..saved.id])
            click(session().gui.clear_1)
            assert(#storage.location_location_location.highlights[player.index].plans == 4)
            local function browse(index)
                local selector = session().gui.surface_selector
                for choice, value in ipairs(session().surface_choices) do
                    if value == index then selector.selected_index = choice end
                end
                emit(defines.events.on_gui_selection_state_changed, {element = selector})
            end
            browse(remote_surface.index)
            assert(not session().draft and not session().gui["plan_"..saved.id])
            assert(session().gui["plan_"..remote_plan.id] and not session().gui.new.enabled)
            assert(#storage.location_location_location.highlights[player.index].plans == 8)
            click(session().gui.new)
            assert(not session().draft and session().gui.notice_panel.visible)
            assert(session().gui.notice_panel.style.name == "negative_message_frame")
            click(session().gui["plan_"..remote_plan.id])
            assert(session().draft.surface_index == remote_surface.index)
            browse(surface.index)
            assert(session().gui.new.enabled)
            click(session().gui.new)
            assert(session().draft.surface_index == surface.index)
            near(model.center(model.load(player, saved.id)), 13, 0.5)
            gui.close(player)
            game.delete_surface(remote_surface)
        end)
    end)
    test("the recipe filter distinguishes current research from prototype defaults", function()
        team.technologies.automation.researched = false
        team.recipes["assembling-machine-1"].enabled = false
        start(); click(session().gui.recipe)
        local search = session().gui.search
        search.text = "assembling-machine-1"
        emit(defines.events.on_gui_text_changed, {element = search})
        assert(not session().gui["product_item/assembling-machine-1"].visible)
        click(session().gui.show_unresearched)
        assert(session().gui["product_item/assembling-machine-1"].visible)
        click(session().gui.show_unresearched)
        team.technologies.automation.researched = true
        team.recipes["assembling-machine-1"].enabled = false
        gui.refresh_picker(player)
        assert(session().gui["product_item/assembling-machine-1"].visible)
        team.technologies.automation.researched = false
    end)
    test("the picker excludes blueprint parameters with no assignable ingredients", function()
        start(); click(session().gui.recipe)
        click(session().gui.show_unresearched)
        local search = session().gui.search
        search.text = "parameter-0"
        emit(defines.events.on_gui_text_changed, {element = search})
        assert(session().gui.recipe_empty.visible)
        search.text = "iron-gear-wheel"
        emit(defines.events.on_gui_text_changed, {element = search})
        assert(session().gui["product_item/iron-gear-wheel"].visible)
    end)
    test("recipe filter preference survives reopening the planner", function()
        start(); click(session().gui.recipe)
        click(session().gui.show_unresearched)
        gui.close(player)
        start(); click(session().gui.recipe)
        assert(session().gui.show_unresearched.toggled)
    end)
    test("products with multiple recipes require an explicit recipe choice", function()
        team.recipes["solid-fuel-from-heavy-oil"].enabled = true
        team.recipes["solid-fuel-from-light-oil"].enabled = true
        start(); click(session().gui.recipe)
        local search = session().gui.search
        search.text = "solid-fuel"
        emit(defines.events.on_gui_text_changed, {element = search})
        click(session().gui["product_item/solid-fuel"])
        assert(session().draft.recipe == "electronic-circuit")
        assert(session().gui["recipe_solid-fuel-from-heavy-oil"].visible)
        assert(session().gui["recipe_solid-fuel-from-light-oil"].visible)
        click(session().gui["recipe_solid-fuel-from-light-oil"])
        assert(session().draft.recipe == "solid-fuel-from-light-oil")
        assert(model.ingredient(session().draft, "fluid/light-oil"))
    end)
    test("search indicator follows filtering, clearing, and picker navigation", function()
        team.recipes["solid-fuel-from-heavy-oil"].enabled = true
        team.recipes["solid-fuel-from-light-oil"].enabled = true
        start(); click(session().gui.recipe)
        assert(not session().gui.focus_search.toggled)
        local function filter(text)
            local search = session().gui.search
            search.text = text
            emit(defines.events.on_gui_text_changed, {element = search})
        end
        filter("solid-fuel")
        assert(session().gui.focus_search.toggled)
        filter("")
        assert(not session().gui.focus_search.toggled)
        filter("solid-fuel")
        click(session().gui["product_item/solid-fuel"])
        assert(not session().gui.focus_search.toggled)
        filter("heavy")
        assert(session().gui.focus_search.toggled)
        assert(session().gui["recipe_solid-fuel-from-heavy-oil"].visible)
        assert(not session().gui["recipe_solid-fuel-from-light-oil"].visible)
        filter("")
        assert(not session().gui.focus_search.toggled)
        assert(session().gui["recipe_solid-fuel-from-light-oil"].visible)
        click(session().gui.back_to_products)
        assert(session().gui.search.text == "solid-fuel")
        assert(session().gui.focus_search.toggled)
    end)
    test("product group navigation survives reopening and searches reveal matching groups", function()
        start(); click(session().gui.recipe)
        local production
        for _, group in ipairs(session().picker.groups) do
            if group.name == "production" then production = group end
        end
        click(session().gui[production.button])
        assert(session().gui[production.pane].visible)
        local search = session().gui.search
        search.text = "iron-gear-wheel"
        emit(defines.events.on_gui_text_changed, {element = search})
        assert(not session().gui[production.pane].visible)
        assert(session().picker.group == prototypes.item["iron-gear-wheel"].group.name)
        gui.close(player)
        start(); click(session().gui.recipe)
        assert(session().picker.group == "production")
    end)
    test("retiring and reactivating a plan updates highlights without deleting its marker", function()
        local saved, tag = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id])
        emit(defines.events.on_lua_shortcut, {prototype_name = "location_location_location_highlight_sources"})
        local highlights = storage.location_location_location.highlights[player.index].plans
        assert(#highlights == 6 and player.is_shortcut_toggled("location_location_location_highlight_sources"))
        click(session().gui.retire)
        for _, object in ipairs(highlights) do assert(not object.valid) end
        assert(#storage.location_location_location.highlights[player.index].plans == 0)
        assert(tag.valid and #model.list(player) == 0 and #model.list(player, true) == 1)
        click(session().gui.show_retired)
        click(session().gui.retire)
        assert(#storage.location_location_location.highlights[player.index].plans == 6 and tag.valid)
        near(tag.position, 13, 0.5)
    end)
    test("shared anchors are highlighted once and survive original entity removal", function()
        apply(populated()); apply(populated())
        sources.toggle(player)
        local highlights = storage.location_location_location.highlights[player.index].plans
        assert(#highlights == 6)
        a.destroy(); b.destroy(); c.destroy()
        for _, object in ipairs(highlights) do
            assert(object.valid and object.players[1].index == player.index)
        end
        sources.toggle(player)
        for _, object in ipairs(highlights) do assert(not object.valid) end
    end)
    test("Discard restores saved source highlights while keeping the editor open", function()
        local saved = apply(populated())
        sources.toggle(player)
        gui.open(player); click(session().gui["plan_"..saved.id])
        local old = storage.location_location_location.highlights[player.index].plans
        click(session().gui.clear_1)
        for _, object in ipairs(old) do assert(not object.valid, "removed sources remain highlighted") end
        local highlights = storage.location_location_location.highlights[player.index].plans
        assert(#highlights == 2)
        for _, object in ipairs(highlights) do near(object.target.position, 20.5, 0.5) end
        assert(model.center(model.load(player, saved.id)))
        click(session().gui.discard)
        assert(session().draft.id == saved.id and player.opened == session().gui.frame)
        assert(#storage.location_location_location.highlights[player.index].plans == 6)
    end)
    test("right-drag removal updates highlights before Apply and preserves other active plans", function()
        local saved = apply(populated())
        local shared = draft()
        model.select(shared, "item/iron-plate", {a}, "add", surface.index)
        apply(shared)
        sources.toggle(player)
        gui.open(player); click(session().gui["plan_"..saved.id])
        click(session().gui.select_1); select("remove", {a, b})
        local highlights = storage.location_location_location.highlights[player.index].plans
        assert(#highlights == 4, "only the unshared removed source should disappear")
        for _, object in ipairs(highlights) do assert(object.target.position.x ~= b.position.x) end
        click(session().gui.apply)
        gui.close(player)
        assert(#storage.location_location_location.highlights[player.index].plans == 4)
    end)
    test("source lookup feedback is dismissible and clears on source edits without losing the draft", function()
        start()
        click(session().gui.select_1); select("replace", {a})
        click(session().gui.find_1)
        assert(session().gui.notice_panel.visible)
        assert(session().gui.notice_panel.style.name == "neutral_message_frame")
        click(session().gui.dismiss_notice)
        assert(not session().gui.notice_panel.visible)
        near(model.center(session().draft), 0.5, 0.5)
        click(session().gui.find_2)
        assert(session().gui.notice_panel.visible)
        assert(session().gui.notice_panel.style.name == "neutral_message_frame")
        click(session().gui.clear_1)
        assert(not session().gui.notice_panel.visible and not model.center(session().draft))
        assert(session().draft.recipe == "electronic-circuit" and #model.list(player) == 0)
    end)
    test("a stale revision cannot retire a newer saved plan", function()
        local saved = apply(populated())
        local stale = model.load(player, saved.id)
        saved.title = "Updated plan"
        apply(saved)
        assert(not model.retire(player, stale, true))
        assert(not storage.location_location_location.plans[saved.id].retired)
    end)
    test("closest-source lookup rejects a draft from another force", function()
        local value = populated()
        player.force = other_force
        assert(not sources.closest(player, value, "item/iron-plate"))
        player.force = team
    end)
end)

describe("saved recipe plans", function()
    test("Apply saves, list reopens, and Back leaves the saved marker unchanged", function()
        start(); click(session().gui.select_1); select("replace", {a})
        click(session().gui.apply)
        local id = session().draft.id
        local tag = storage.location_location_location.plans[id].tag
        click(session().gui.select_1); select("add", {b})
        near(tag.position, 0.5, 0.5)
        click(session().gui.back)
        click(session().gui["plan_"..id])
        near(model.center(session().draft), 0.5, 0.5)
        near(tag.position, 0.5, 0.5)
    end)
    test("reapplying updates the existing marker rather than adding another", function()
        local saved, tag = apply(populated())
        local number = tag.tag_number
        model.select(saved, "item/iron-plate", {c}, "replace", surface.index)
        saved = apply(saved)
        assert(storage.location_location_location.plans[saved.id].tag.tag_number == number)
        near(tag.position, 20.5, 0.5)
        assert(saved.revision == 2 and #team.find_chart_tags(surface) == 1)
    end)
    test("destroying original sources does not change saved or reopened anchor positions", function()
        local saved, tag = apply(populated())
        a.destroy(); b.destroy(); c.destroy()
        near(tag.position, 13, 0.5)
        near(model.center(model.load(player, saved.id)), 13, 0.5)
    end)
    test("stale drafts cannot overwrite or delete a teammate's revision", function()
        local saved = apply(populated())
        local first, stale = model.load(player, saved.id), model.load(player, saved.id)
        first.title = "Updated by teammate"
        apply(first)
        assert(not model.apply(player, stale))
        assert(not model.delete(player, stale))
        assert(storage.location_location_location.plans[saved.id].title == "Updated by teammate")
    end)
    test("another force cannot list, load, modify, or delete the plan", function()
        local saved = apply(populated())
        player.force = other_force
        assert(#model.list(player) == 0)
        assert(not model.load(player, saved.id))
        assert(not model.apply(player, saved))
        assert(not model.delete(player, saved))
        player.force = team
        assert(#model.list(player) == 1)
    end)
    test("externally deleted markers are recreated only on Apply", function()
        local saved, tag = apply(populated())
        tag.destroy()
        local reopened = model.load(player, saved.id)
        assert(#team.find_chart_tags(surface) == 0)
        local _, replacement = apply(reopened)
        near(replacement.position, 13, 0.5)
        assert(#team.find_chart_tags(surface) == 1)
    end)
    test("Apply restores an externally moved marker without leaving an orphan", function()
        local saved, tag = apply(populated())
        local number = tag.tag_number
        tag.surface = game.surfaces.nauvis
        apply(saved)
        assert(tag.surface == surface and tag.tag_number == number)
        assert(#team.find_chart_tags(surface) == 1)
    end)
    test("force merging transfers plan ownership without duplicating its marker", function()
        local source = game.create_force("planner-tests-merged")
        player.force = source
        local saved = apply(populated())
        game.merge_forces(source, team)
        after_ticks(1, function()
            player.force = team
            local reopened = model.load(player, saved.id)
            assert(reopened and reopened.revision == saved.revision + 1)
            apply(reopened)
            assert(#team.find_chart_tags(surface) == 1)
        end)
    end)
    test("plan deletion requires GUI confirmation and preserves unrelated markers", function()
        local saved, tag = apply(populated())
        local manual = team.add_chart_tag(surface, {position = {3, 3}, text = "Unrelated"})
        gui.open(player); click(session().gui["plan_"..saved.id]); click(session().gui.delete)
        assert(tag.valid)
        local title = session().gui.title
        title.text = "Edited while confirmation was armed"
        emit(defines.events.on_gui_text_changed, {element = title})
        click(session().gui.delete)
        assert(tag.valid and session().confirm_delete)
        local draft = session().draft
        click(session().gui.cancel_delete)
        assert(not session().confirm_delete and tag.valid and manual.valid)
        assert(session().draft == draft and draft.title == "Edited while confirmation was armed")
        click(session().gui.delete)
        assert(session().confirm_delete and tag.valid, "Cancellation must require a fresh confirmation")
        click(session().gui.delete)
        assert(not tag.valid and manual.valid)
        assert(#model.list(player) == 0)
        manual.destroy()
    end)
    test("clearing the cursor pauses selection without losing a draft", function()
        start(); click(session().gui.select_1); select("replace", {a})
        player.clear_cursor()
        after_ticks(1, function()
            assert(not session().selecting)
            near(model.center(session().draft), 0.5, 0.5)
        end)
    end)
    test("surface changes close an unsaved editor without creating a plan", function()
        start(); click(session().gui.select_1); select("replace", {a})
        player.teleport({0, 0}, game.surfaces.nauvis)
        after_ticks(1, function()
            assert(not session())
            assert(#model.list(player) == 0)
        end)
    end)
    test("missing recipes fail cleanly while leaving a saved plan deletable", function()
        local saved = apply(populated())
        storage.location_location_location.plans[saved.id].recipe = "removed-recipe"
        storage.location_location_location.plans[saved.id].ingredients[1].name = "removed-ingredient"
        local reopened = model.load(player, saved.id)
        assert(not model.apply(player, reopened))
        gui.open(player); click(session().gui["plan_"..saved.id])
        assert(not session().gui.apply.enabled)
        assert(not session().gui.recipe.elem_tooltip and not session().gui.recipe_name.elem_tooltip)
        assert(not session().gui.ingredient_1.elem_tooltip)
        assert(not session().gui.closest_1.enabled and not session().gui.find_1.enabled)
        assert(model.delete(player, reopened))
    end)
    test("missing surfaces fail cleanly while leaving a saved plan deletable", function()
        local saved = apply(populated())
        local temporary = game.create_surface("planner-deleted-surface")
        storage.location_location_location.plans[saved.id].surface_index = temporary.index
        game.delete_surface(temporary)
        after_ticks(1, function()
            local reopened = model.load(player, saved.id)
            assert(not model.apply(player, reopened))
            assert(model.delete(player, reopened))
        end)
    end)
    test("saved plans and pending edits survive script reload", function()
        local saved = apply(populated())
        gui.open(player); click(session().gui["plan_"..saved.id])
        gui.activate(player, "ingredient", "item/iron-plate")
        select("replace", {a})
    end).after_reload_script(function()
        player = game.get_player(1)
        surface, team = game.surfaces["recipe-planner-tests"], game.forces["planner-tests-team"]
        local current = session()
        local saved = storage.location_location_location.plans[current.draft.id]
        assert(current.gui.frame.valid and saved.revision == 1)
        near(model.center(current.draft), 10.5, 0.5)
        near(saved.tag.position, 13, 0.5)
        click(current.gui.apply)
        near(saved.tag.position, 10.5, 0.5)
    end)
end)

describe("planner minimap framing", function()
    test("fits distant sources and a manual marker, then tightens when they are removed", function()
        start(); click(session().gui.select_1); select("replace", {a})
        local close_zoom = session().gui.preview.zoom
        assert(close_zoom > 1)
        local current = session().draft
        current.ingredients[2].anchors = {distant = {x = 600, y = -300}}
        current.marker_position = {x = -400, y = 500}
        gui.render(player)
        local preview = session().gui.preview
        assert(preview.zoom < close_zoom)
        for _, position in ipairs({a.position, current.ingredients[2].anchors.distant, current.marker_position}) do
            assert(math.abs(position.x - preview.position.x) * preview.zoom <= 90.0001)
            assert(math.abs(position.y - preview.position.y) * preview.zoom <= 90.0001)
        end
        click(session().gui.clear_2); click(session().gui.reset_marker)
        assert(session().gui.preview.zoom == close_zoom)
        near(session().gui.preview.position, a.position.x, a.position.y)
    end)
end)

describe("viewing a recipe location", function()
    test("pins and focuses remote view across surfaces without moving the character or saving edits", function()
        local saved, tag = apply(populated())
        local character = surface.create_entity({name = "character", position = {0, 8}, force = team})
        player.set_controller({type = defines.controllers.character, character = character})
        player.set_controller({type = defines.controllers.remote, surface = game.surfaces.nauvis, position = {0, 0}})
        gui.open(player)
        local current = session()
        current.draft = model.load(player, saved.id)
        current.view_surface_index = surface.index
        current.draft.marker_position = {x = 7, y = 3}
        gui.render(player)
        local original = current.draft
        click(current.gui.view_location)
        emit(defines.events.on_player_changed_surface, {})
        assert(session() == current and current.compact and current.draft == original and not player.opened)
        assert(player.controller_type == defines.controllers.remote and player.surface_index == surface.index)
        near(player.position, 7, 3)
        assert(character.valid and character.surface.index == surface.index)
        near(character.position, 0, 8)
        near(tag.position, 13, 0.5)
        assert((model.change_count(player, current.draft) > 0))
        click(current.gui.pin)
        assert(not current.compact and current.draft == original)
    end)
end)

describe("native feedback and tooltip regressions", function()
    for _, compact in ipairs({false, true}) do
        for _, action in ipairs({"closest_1", "find_1"}) do
            test((compact and "pinned " or "full ")..action.." recovers from a blocked Apply and repeated empty lookups", function()
                local saved = apply(populated())
                gui.open(player); click(session().gui["plan_"..saved.id])
                if compact then click(session().gui.pin) end
                local current, original = session(), session().draft
                original.title = "Private edit"
                local newer = model.load(player, saved.id)
                newer.title = "Teammate edit"
                apply(newer)
                click(current.gui.apply)
                assert(current.gui.notice_panel.visible and current.gui.notice_panel.style.name == "negative_message_frame")
                assert(current.draft == original and original.title == "Private edit")
                local panel, width = current.gui.notice_panel, current.gui.notice_panel.style.minimal_width
                for _ = 1, 3 do
                    click(current.gui[action])
                    assert(current.gui.notice_panel == panel and panel.visible)
                    assert(panel.style.name == "neutral_message_frame" and panel.style.minimal_width == width)
                    assert(current.draft == original and model.change_count(player, original) == 1)
                end
                click(current.gui.dismiss_notice)
                assert(not panel.visible and current.draft == original)
                assert(model.load(player, saved.id).title == "Teammate edit")
                click(current.gui.discard)
                assert(session().draft.title == "Teammate edit" and (session().compact == true) == compact)
            end)
        end
        test((compact and "pinned" or "full").." tooltips follow recipe changes from items to fluids", function()
            start()
            if compact then click(session().gui.pin) end
            local function recipe_tooltips(name)
                for _, element in ipairs({session().gui.recipe, session().gui.recipe_name}) do
                    assert(element.elem_tooltip.type == "recipe" and element.elem_tooltip.name == name)
                    assert(not element.ignored_by_interaction)
                end
            end
            recipe_tooltips("electronic-circuit")
            assert(session().gui.ingredient_1.elem_tooltip.type == "item")
            assert(session().gui.ingredient_1.elem_tooltip.name == "iron-plate")
            gui.choose_recipe(player, "sulfur")
            recipe_tooltips("sulfur")
            for index, ingredient in ipairs(session().draft.ingredients) do
                local icon = session().gui["ingredient_"..index]
                assert(icon.elem_tooltip.type == "fluid" and icon.elem_tooltip.name == ingredient.name)
                assert(not icon.ignored_by_interaction)
            end
            gui.choose_recipe(player, "iron-gear-wheel")
            recipe_tooltips("iron-gear-wheel")
            assert(session().gui.ingredient_1.elem_tooltip.name == "iron-plate")
            assert(not session().gui.ingredient_2 and #model.list(player) == 0)
        end)
    end
    test("marker and ingredient selection omit standalone hints while machine guidance remains available", function()
        start(); click(session().gui.move_marker)
        assert(session().selecting and session().selection_mode == "marker" and not session().gui.selection_hint.visible)
        select("replace", {})
        near(session().draft.marker_position, 11, 0.5)
        click(session().gui.select_1)
        assert(not session().gui.selection_hint.visible and session().selection_mode == "ingredient")
        gui.activate(player, "machine")
        assert(session().gui.selection_hint.visible and session().selection_mode == "machine")
        click(session().gui.move_marker)
        assert(not session().gui.selection_hint.visible)
        click(session().gui.apply)
        near(model.load(player, session().draft.id).marker_position, 11, 0.5)
    end)
end)

describe("closest-source eligibility and navigation", function()
    local function producer(position, recipe, force, name)
        local entity = surface.create_entity({name = name or "assembling-machine-2", position = position, force = force or team})
        entity.set_recipe(recipe)
        assert(entity.get_recipe() and entity.get_recipe().name == recipe)
        return entity
    end
    test("lookup ignores empty machines, other products, and another force's nearer producer", function()
        local value = draft()
        surface.create_entity({name = "assembling-machine-2", position = {-7.5, 8.5}, force = team})
        producer({2.5, 8.5}, "iron-gear-wheel")
        producer({-3.5, 8.5}, "copper-cable", other_force)
        local nearest = producer({5.5, 8.5}, "copper-cable")
        producer({13.5, 8.5}, "copper-cable")
        assert(sources.closest(player, value, "item/copper-cable") == nearest)
        assert(table_size(model.ingredient(value, "item/copper-cable").anchors) == 0)
    end)
    test("equidistant producers resolve deterministically and destroyed producers are excluded", function()
        local first = producer({-5.5, 8.5}, "copper-cable")
        local second = producer({5.5, 8.5}, "copper-cable")
        assert(first.unit_number < second.unit_number)
        local value = draft()
        assert(sources.closest(player, value, "item/copper-cable") == first)
        first.destroy()
        assert(sources.closest(player, value, "item/copper-cable") == second)
    end)
    test("an uncharted producer is not disclosed even when it is closer", function()
        producer({-48.5, 8.5}, "copper-cable")
        local visible = producer({50.5, 8.5}, "copper-cable")
        team.unchart_chunk({-2, 0}, surface)
        assert(not team.is_chunk_charted(surface, {-2, 0}) and team.is_chunk_charted(surface, {1, 0}))
        assert(sources.closest(player, draft(), "item/copper-cable") == visible)
    end)
    test("fluid ingredients find recipes producing the matching fluid", function()
        local refinery = producer({12.5, 8.5}, "basic-oil-processing", team, "oil-refinery")
        local value = model.new(player)
        assert(model.set_recipe(value, "sulfur"))
        assert(sources.closest(player, value, "fluid/petroleum-gas") == refinery)
        local entity, _, severity = sources.closest(player, value, "fluid/water")
        assert(not entity and severity == "info")
    end)
    test("Find navigates without assigning sources and repeated Add closest does not duplicate them", function()
        local machine = producer({5.5, 8.5}, "copper-cable")
        start()
        click(session().gui.find_2)
        assert(table_size(model.ingredient(session().draft, "item/copper-cable").anchors) == 0)
        local guide = storage.location_location_location.highlights[player.index].guide
        assert(guide.pin.valid and guide.entity == machine)
        click(session().gui.closest_2); click(session().gui.closest_2)
        local anchors = model.ingredient(session().draft, "item/copper-cable").anchors
        assert(table_size(anchors) == 1 and #model.list(player) == 0)
        for _, position in pairs(anchors) do near(position, machine.position.x, machine.position.y) end
    end)
end)

describe("cross-surface world actions", function()
    for _, scenario in ipairs({
        {action = "select_1", mode = "ingredient"}, {action = "move_marker", mode = "marker"},
        {action = "machine", mode = "machine"}, {action = "closest_2"}, {action = "find_2"},
        {action = "select_1", mode = "ingredient", source_free = true},
        {action = "move_marker", mode = "marker", source_free = true},
    }) do
        test(scenario.action..(scenario.source_free and " without a marker" or "").." enters remote view without moving the character or saving", function()
            local saved, tag = apply(scenario.source_free and draft() or populated())
            local producer = surface.create_entity({name = "assembling-machine-2", position = {5.5, 8.5}, force = team})
            producer.set_recipe("copper-cable")
            local character = surface.create_entity({name = "character", position = {0, 8}, force = team})
            player.set_controller({type = defines.controllers.character, character = character})
            player.set_controller({type = defines.controllers.remote, surface = game.surfaces.nauvis, position = {0, 0}})
            gui.open(player)
            local selector = session().gui.surface_selector
            for choice, index in ipairs(session().surface_choices) do
                if index == surface.index then selector.selected_index = choice end
            end
            emit(defines.events.on_gui_selection_state_changed, {element = selector})
            click(session().gui["plan_"..saved.id])
            assert(player.surface_index == game.surfaces.nauvis.index, "Browsing must remain passive")
            local current, original = session(), session().draft
            original.title = "Private cross-surface edit"
            click(current.gui[scenario.action])
            emit(defines.events.on_player_changed_surface, {})
            assert(session() == current and current.draft == original and current.compact and not player.opened)
            assert(player.controller_type == defines.controllers.remote and player.surface_index == surface.index)
            assert(character.valid and character.surface.index == surface.index)
            near(character.position, 0, 8)
            assert(model.load(player, saved.id).title == saved.title and original.title == "Private cross-surface edit")
            assert(not current.gui.notice_panel.visible)
            if tag then near(tag.position, 13, 0.5) end
            if scenario.mode then
                assert(current.selecting and current.selection_mode == scenario.mode)
                assert(player.cursor_stack.name == "location_location_location_planner_tool")
            elseif scenario.action == "closest_2" then
                assert(table_size(model.ingredient(original, "item/copper-cable").anchors) == 2)
                assert(table_size(model.ingredient(model.load(player, saved.id), "item/copper-cable").anchors) == 1)
            else
                assert(storage.location_location_location.highlights[player.index].guide.pin.valid)
                assert(table_size(model.ingredient(original, "item/copper-cable").anchors) == 1)
            end
        end)
    end
end)

describe("picker invalidation and draft preservation", function()
    test("a recipe locked after opening the picker is rejected and can be chosen after research returns", function()
        team.technologies["advanced-oil-processing"].researched = false
        team.recipes["solid-fuel-from-heavy-oil"].enabled = true
        team.recipes["solid-fuel-from-light-oil"].enabled = true
        start(); click(session().gui.recipe)
        local original = session().draft
        click(session().gui["product_item/solid-fuel"])
        local search = session().gui.search
        search.text = "heavy"
        emit(defines.events.on_gui_text_changed, {element = search})
        team.recipes["solid-fuel-from-heavy-oil"].enabled = false
        click(session().gui["recipe_solid-fuel-from-heavy-oil"])
        assert(session().draft == original and original.recipe == "electronic-circuit")
        assert(session().picker.product == "item/solid-fuel" and session().gui.search.text == "heavy")
        assert(session().gui.notice_panel.visible and session().gui.notice_panel.style.name == "negative_message_frame")
        team.recipes["solid-fuel-from-heavy-oil"].enabled = true
        gui.refresh_picker(player)
        click(session().gui["recipe_solid-fuel-from-heavy-oil"])
        assert(not session().picker and session().draft.recipe == "solid-fuel-from-heavy-oil")
        assert(not session().gui.notice_panel.visible and #model.list(player) == 0)
    end)
    test("research refresh preserves filtered browsing and private ingredient assignments", function()
        start(); click(session().gui.select_1); select("replace", {a})
        click(session().gui.select_1)
        click(session().gui.recipe)
        local original = session().draft
        local search = session().gui.search
        search.text = "iron-gear-wheel"
        emit(defines.events.on_gui_text_changed, {element = search})
        emit(defines.events.on_research_finished, {research = team.technologies.automation})
        assert(session().draft == original and session().gui.search.text == "iron-gear-wheel")
        assert(session().gui["product_item/iron-gear-wheel"].visible and session().gui.focus_search.toggled)
        click(session().gui["product_item/iron-gear-wheel"])
        assert(session().draft.recipe == "iron-gear-wheel" and not session().picker)
        local anchors = model.ingredient(session().draft, "item/iron-plate").anchors
        assert(table_size(anchors) == 1)
        for _, position in pairs(anchors) do near(position, 0.5, 0.5) end
        assert(#model.list(player) == 0)
    end)
end)

describe("long saved-tag lists", function()
    test("the final tag stays editable through scrolling, Apply, and reopening", function()
        local ids = {}
        for index = 1, 40 do
            local value = draft()
            value.title = string.format("Survey %02d", index)
            ids[index] = apply(value).id
        end
        gui.open(player)
        local pane = session().gui.plans
        pane.scroll_to_bottom()
        click(session().gui["plan_"..ids[40]])
        assert(session().draft.id == ids[40] and session().draft.title == "Survey 40")
        local current = session()
        current.draft.title = "Survey 40 revised"
        click(current.gui.apply)
        assert(model.load(player, ids[40]).title == "Survey 40 revised")
        assert(current.gui["plan_"..ids[40]].toggled)
        current.gui.plans.scroll_to_top()
        click(current.gui["plan_"..ids[1]])
        assert(current.draft.id == ids[1] and current.draft.title == "Survey 01")
        gui.close(player); gui.open(player)
        session().gui.plans.scroll_to_bottom()
        click(session().gui["plan_"..ids[40]])
        assert(session().draft.title == "Survey 40 revised" and #model.list(player) == 40)
    end)
    test("retirement filtering in an overflowing list keeps all remaining tags reachable", function()
        local first, last
        for index = 1, 36 do
            local value = draft()
            value.title = string.format("Overflow %02d", index)
            local saved = apply(value)
            if index == 1 then first = saved end
            last = saved
        end
        assert(model.retire(player, last, true))
        gui.open(player)
        assert(session().gui["plan_"..first.id] and not session().gui["plan_"..last.id])
        click(session().gui.show_retired)
        session().gui.plans.scroll_to_bottom()
        click(session().gui["plan_"..last.id])
        assert(session().draft.id == last.id and session().draft.retired)
        click(session().gui.retire)
        assert(not model.load(player, last.id).retired)
        click(session().gui.show_retired)
        assert(session().gui["plan_"..first.id] and session().gui["plan_"..last.id])
        assert(#model.list(player) == 36 and session().draft.id == last.id)
    end)
end)

describe("saved-tag navigation availability", function()
    test("Back is disabled in the list and enabled only while a saved tag or new draft is open", function()
        local saved = apply(populated())
        gui.open(player)
        assert(not session().draft and not session().gui.back.enabled)
        click(session().gui["plan_"..saved.id])
        assert(session().draft.id == saved.id and session().gui.back.enabled)
        click(session().gui.back)
        assert(not session().draft and not session().gui.back.enabled)
        click(session().gui.new); choose("electronic-circuit")
        assert(session().draft and not session().draft.id and session().gui.back.enabled)
        click(session().gui.back)
        assert(not session().draft and not session().gui.back.enabled and #model.list(player) == 1)
    end)
end)

describe("saved-list overflow boundaries", function()
    test("filtering across the overflow boundary reclaims the gutter without losing names or counts", function()
        local first, last
        for index = 1, 16 do
            local value = draft()
            value.title = string.format("Boundary %02d", index)
            local saved = apply(value)
            if index == 1 then first = saved end
            last = saved
        end
        assert(model.retire(player, last, true))
        gui.open(player)
        for _, scrolling in ipairs({false, true, false}) do
            local pane, row = session().gui.plans, session().gui["plan_"..first.id]
            assert(pane.vertical_scroll_policy == (scrolling and "always" or "never"))
            assert(pane.style.minimal_width == pane.parent.style.minimal_width)
            assert(row.style.minimal_width == (scrolling and 220 or 232))
            local name, count = row.children[1], row.children[2]
            assert(count.style.minimal_width == row.style.minimal_width - 16)
            assert(name.style.minimal_width + 48 == count.style.minimal_width)
            assert(tostring(count.caption[2]) == "0" and tostring(count.caption[4]) == "2")
            click(session().gui.show_retired)
        end
    end)
end)
