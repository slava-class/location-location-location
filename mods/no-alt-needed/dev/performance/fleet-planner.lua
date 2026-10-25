-- Fixture setup through the existing GUI event handlers in the planner's console
-- context. This is scripted native interaction, not physical mouse input.
local player = assert(game.get_player("FleetVerifier"))
local surface = player.surface
local function at(name, position)
    local found = surface.find_entities_filtered({ name = name, position = position, radius = 1 })
    assert(#found == 1, name .. " fixture lookup on " .. surface.name .. ": found " .. #found)
    return found[1]
end
local foreign = at("steel-chest", { -24, -24 })
local machine = at("assembling-machine-3", { 0, 0 })
local function session()
    return assert(storage.location_location_location.sessions[player.index])
end
local function emit(id, data)
    data.name, data.tick, data.player_index = id, game.tick, player.index
    assert(script.get_event_handler(id))(data)
end
local function click(element)
    assert(element and element.valid and element.enabled)
    emit(defines.events.on_gui_click, { element = element, button = defines.mouse_button_type.left })
end
local function select(entity)
    emit(defines.events.on_player_selected_area, {
        item = "location_location_location_planner_tool",
        entities = { entity },
        surface = surface,
        area = { left_top = { x = -25, y = -25 }, right_bottom = { x = 1, y = 1 } },
    })
end
assert(not next(storage.location_location_location.plans))
emit(defines.events.on_lua_shortcut, { prototype_name = "location_location_location_open_planner" })
click(session().gui.new)
click(session().gui.picker_machine)
select(machine)
click(session().gui.select_1)
select(foreign)
click(session().gui.select_1)
local checkbox = session().gui.hide_label
checkbox.state = false
emit(defines.events.on_gui_checked_state_changed, { element = checkbox })
local title = session().gui.title
title.text = "Fleet saved plan"
emit(defines.events.on_gui_text_changed, { element = title })
click(session().gui.apply)
local saved = assert(storage.location_location_location.plans[session().draft.id])
assert(saved.tag and saved.tag.valid)
assert(not player.is_shortcut_toggled("location_location_location_highlight_sources"))
emit(defines.events.on_lua_shortcut, { prototype_name = "location_location_location_highlight_sources" })
emit(defines.events.on_lua_shortcut, { prototype_name = "location_location_location_open_planner" })
return { plan = saved.id, tag = saved.tag.tag_number, text = saved.tag.text }
