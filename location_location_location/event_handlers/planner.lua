local model = require("location_location_location.planner")
local gui = require("location_location_location.gui.planner")
local sources = require("location_location_location.sources")
local export = { events = {} }
local tool = "location_location_location_planner_tool"

local function initialize_player(player)
    model.preferences(player)
    gui.toolbar(player)
    sources.refresh(player)
end
export.on_init = function()
    model.initialize()
    for _, player in pairs(game.players) do
        initialize_player(player)
    end
end
export.on_configuration_changed = function()
    model.initialize()
    for _, player in pairs(game.players) do
        gui.close(player)
        sources.clear(player.index)
        initialize_player(player)
    end
end

local function open(e)
    local player = game.get_player(e.player_index)
    if player then
        gui.toggle(player)
    end
end
local function toggle_sources(e)
    local player = game.get_player(e.player_index)
    if not player then
        return
    end
    gui.toggle_highlights(player)
end
export.events["location_location_location_open_planner"] = open
export.events["location_location_location_highlight_sources"] = toggle_sources
export.events["location_location_location_focus_search"] = function(e)
    local player = game.get_player(e.player_index)
    if player then
        gui.focus_search(player)
    end
end
export.events[defines.events.on_lua_shortcut] = function(e)
    if e.prototype_name == "location_location_location_open_planner" then
        open(e)
    elseif e.prototype_name == "location_location_location_highlight_sources" then
        toggle_sources(e)
    end
end
export.events[defines.events.on_gui_closed] = function(e)
    local player = game.get_player(e.player_index)
    if not player then
        return
    end
    local s = storage.location_location_location.sessions[player.index]
    if not s or s.selecting or (s.compact and not s.picker) then
        return
    end
    local opened = s.gui.picker_frame or s.gui.frame
    if e.element == opened and player.opened ~= opened then
        gui.close(player)
    end
end

local function select(e, mode)
    if e.item ~= tool then
        return
    end
    local player = game.get_player(e.player_index)
    if not player then
        return
    end
    local s = storage.location_location_location.sessions[player.index]
    if not s or not s.draft or not s.selecting then
        return
    end
    if s.draft.force_index ~= player.force.index then
        gui.close(player)
        return
    end
    if s.draft.surface_index ~= e.surface.index then
        gui.report(player, { "location-location-location.wrong-surface" }, "error")
        return
    end
    if s.selection_mode == "marker" then
        if mode ~= "replace" then
            return
        end
        s.draft.marker_position = {
            x = (e.area.left_top.x + e.area.right_bottom.x) / 2,
            y = (e.area.left_top.y + e.area.right_bottom.y) / 2,
        }
        s.selecting, s.selection_mode, s.confirm_delete = nil, nil, nil
        player.clear_cursor()
        gui.render(player)
        return
    end
    if s.selection_mode == "machine" then
        if mode ~= "replace" then
            return
        end
        local recipe, count = nil, 0
        for _, entity in pairs(e.entities) do
            if
                entity.valid
                and (entity.type == "assembling-machine" or entity.type == "furnace" or entity.type == "rocket-silo")
            then
                local selected = entity.get_recipe()
                if selected then
                    recipe, count = selected.name, count + 1
                end
            end
        end
        if count ~= 1 then
            gui.report(player, { "location-location-location.one-machine" }, "info")
            return
        end
        gui.choose_recipe(player, recipe)
        return
    end
    local ok, err = model.select(s.draft, s.active_key, e.entities, mode, e.surface.index)
    if not ok then
        gui.report(player, err, "error")
        return
    end
    s.confirm_delete = nil
    gui.render(player)
end
export.events[defines.events.on_player_selected_area] = function(e)
    select(e, "replace")
end
export.events[defines.events.on_player_alt_selected_area] = function(e)
    select(e, "add")
end
export.events[defines.events.on_player_reverse_selected_area] = function(e)
    select(e, "remove")
end
export.events[defines.events.on_player_alt_reverse_selected_area] = function(e)
    select(e, "remove")
end
export.events[defines.events.on_player_cursor_stack_changed] = function(e)
    local player = game.get_player(e.player_index)
    if not player then
        return
    end
    local s = storage.location_location_location.sessions[player.index]
    if not s or not s.selecting then
        return
    end
    local cursor = player.cursor_stack
    if not cursor or not cursor.valid_for_read or cursor.name ~= tool then
        s.selecting, s.selection_mode = nil, nil
        gui.render(player)
    end
end

local function context_changed(e)
    local player = game.get_player(e.player_index)
    if not player then
        return
    end
    local s = storage.location_location_location.sessions[player.index]
    if not s or s.force_index ~= player.force.index or s.surface_index ~= player.surface_index then
        if s then
            gui.close(player)
        end
        sources.clear(player.index)
    end
    sources.refresh(player)
end
export.events[defines.events.on_player_changed_surface] = context_changed
export.events[defines.events.on_player_changed_force] = context_changed
export.events[defines.events.on_player_created] = function(e)
    initialize_player(game.get_player(e.player_index))
end
export.events[defines.events.on_player_joined_game] = function(e)
    initialize_player(game.get_player(e.player_index))
end
export.events[defines.events.on_player_left_game] = function(e)
    local player = game.get_player(e.player_index)
    if player then
        sources.clear(player.index)
    end
end
export.events[defines.events.on_player_removed] = function(e)
    storage.location_location_location.sessions[e.player_index] = nil
    storage.location_location_location.preferences[e.player_index] = nil
    sources.clear(e.player_index)
end
export.events[defines.events.on_surface_deleted] = function(e)
    for _, player in pairs(game.players) do
        local s = storage.location_location_location.sessions[player.index]
        if s and s.draft and s.draft.surface_index == e.surface_index then
            gui.close(player)
        end
        sources.refresh(player)
    end
end
export.events[defines.events.on_forces_merged] = function(e)
    for _, plan in pairs(storage.location_location_location.plans) do
        if plan.force_index == e.source_index then
            plan.force_index, plan.revision = e.destination.index, plan.revision + 1
        end
    end
    sources.refresh_force(e.destination.index)
end
local function research_changed(e)
    for _, player in pairs(e.research.force.players) do
        gui.refresh_picker(player)
    end
end
export.events[defines.events.on_research_finished] = research_changed
export.events[defines.events.on_research_reversed] = research_changed
export.on_nth_tick = { [30] = sources.expire }

return export
