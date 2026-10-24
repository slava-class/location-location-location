local Inspect = require("scripts.inspect")
local Presentation = require("scripts.presentation")
local Nearby = require("scripts.nearby")
local Pointer = require("scripts.pointer")
local Alt = require("scripts.native-alt")
local Fluid = require("scripts.fluid-context")
local Experiments = require("scripts.experiments")
local Capabilities = require("scripts.capabilities")
local Capacity = require("scripts.capacity")
local Warnings = require("scripts.warnings")
remote.add_interface(script.mod_name .. "-experiments", { set = Experiments.set })
local refresh_ticks = 15 -- Trial refresh interval; native latency/cost calibration is a release gate.
local tick

---@return NoAltNeededPreferences
local function preferences(player)
    local values = settings.get_player_settings(player)
    return {
        hover = values["no-alt-needed-hover"].value,
        nearby = values["no-alt-needed-nearby-recipes"].value,
        nearby_focus = values["no-alt-needed-experiment-nearby-focus"].value,
        radius = values["no-alt-needed-recipe-radius"].value,
        resources = values["no-alt-needed-resources"].value,
        electricity = values["no-alt-needed-electricity"].value,
        ammo_counts = values["no-alt-needed-ammo-counts"].value,
        auto_alt = values["no-alt-needed-auto-alt"].value,
        inserter_capacity = values["no-alt-needed-inserter-capacity"].value,
        warnings = values["no-alt-needed-warnings"].value,
        warning_inserters = values["no-alt-needed-warning-inserters"].value,
        warning_drills = values["no-alt-needed-warning-drills"].value,
        warning_fluids = values["no-alt-needed-warning-fluids"].value,
        warning_ignored = Warnings.ignored(values["no-alt-needed-warning-ignored"].value),
    } --[[@as NoAltNeededPreferences]]
end

local function record(player)
    local state = storage.players[player.index]
    if not state then
        state = {
            exact = {},
            nearby = {},
            pointer = {},
            fluid = {},
            capacity = {},
            warnings = {},
            auto_alt = {},
            preferences = preferences(player),
        }
        storage.players[player.index] = state
    end
    return state
end

local function visible(player, entity)
    if not entity.valid or entity.surface ~= player.surface then
        return false
    end
    if entity.force ~= player.force and not player.force.get_friend(entity.force) then
        return false
    end
    if not Inspect.permitted(entity) then
        return false
    end
    local position = entity.position
    return player.force.is_chunk_visible(entity.surface, { math.floor(position.x / 32), math.floor(position.y / 32) })
end

local function context(player)
    local blocked = not player.connected or player.opened ~= nil or player.render_mode == defines.render_mode.chart
    local selected = not blocked and player.selected or nil
    if selected and (Pointer.is_target(selected) or not visible(player, selected)) then
        selected = nil
    end
    return {
        selected = selected,
        surface = player.surface,
        position = player.position,
        alt = player.game_view_settings.show_entity_info,
        tick = game.tick,
        blocked = blocked,
        visible = function(entity)
            return visible(player, entity)
        end,
    }
end

local function has_active()
    return next(storage.active or {}) ~= nil
end

local function registration()
    script.on_event(defines.events.on_tick, has_active() and tick or nil)
end

local function clear(player, state)
    Presentation.clear(state.exact, player)
    Nearby.clear(state.nearby)
    Pointer.clear(state.pointer)
    Fluid.clear(state.fluid)
    Capacity.clear(state.capacity)
    Warnings.clear(state.warnings)
    state.selected, state.next_refresh, state.surface, state.force, state.alt, state.blocked =
        nil, nil, nil, nil, nil, nil
end

local function refresh(player, force)
    if not player or not player.valid then
        return
    end
    local state = record(player)
    if not player.connected then
        clear(player, state)
        Alt.release(player, state.auto_alt)
        storage.active[player.index] = nil
        return
    end
    local tool_active = Alt.update(player, state.auto_alt, state.preferences.auto_alt)
    local view = context(player)
    local view_changed = state.surface ~= view.surface.index
        or state.force ~= player.force.index
        or state.alt ~= view.alt
        or state.blocked ~= view.blocked
    local changed = force or state.selected ~= view.selected or view_changed
    if view_changed then
        Nearby.clear(state.nearby)
        Pointer.clear(state.pointer)
    end
    if changed then
        Presentation.clear(state.exact, player)
        Fluid.clear(state.fluid)
        state.selected, state.surface, state.force, state.alt, state.blocked =
            view.selected, view.surface.index, player.force.index, view.alt, view.blocked
    end
    local selected = view.selected
    if selected and (changed or not state.next_refresh or game.tick >= state.next_refresh) then
        Presentation.update(
            player,
            selected,
            Inspect.snapshot(selected, state.preferences, view.alt),
            state.exact,
            not state.preferences.nearby
        )
        state.next_refresh = game.tick + refresh_ticks
    elseif not selected then
        Presentation.clear(state.exact, player)
    end
    local pointer_active = Pointer.update(
        player,
        state.pointer,
        view,
        state.preferences.nearby and state.preferences.nearby_focus == "pointer"
    )
    view.pointer = state.pointer.point
    local recipes_active = Nearby.update(player, state.nearby, view, state.preferences, storage.world_version)
    local fluids_active = Fluid.update(player, state.fluid, view)
    local warnings_active =
        Warnings.update(player, state.warnings, view, state.preferences, storage.capabilities, storage.world_version)
    local warning_top = state.warnings.selected_record and state.warnings.selected_record.top
    local capacity_active = Capacity.update(
        player,
        state.capacity,
        view,
        state.preferences.inserter_capacity,
        storage.capabilities,
        warning_top
    )
    local hover_active = selected
        and (
            state.preferences.hover and not view.alt
            or Inspect.extra_visible(state.preferences.resources, view.alt)
            or Inspect.extra_visible(state.preferences.electricity, view.alt)
            or Inspect.extra_visible(state.preferences.ammo_counts, view.alt)
        )
    storage.active[player.index] = (
        hover_active
        or recipes_active
        or pointer_active
        or fluids_active
        or tool_active
        or warnings_active
        or capacity_active
    )
            and true
        or nil
end

tick = function()
    for index in pairs(storage.active) do
        refresh(game.get_player(index), false)
    end
    registration()
end

local function player_event(event)
    refresh(game.get_player(event.player_index), true)
    registration()
end

local function refresh_all()
    for _, player in pairs(game.players) do
        refresh(player, true)
    end
    registration()
end

local function world_changed()
    storage.world_version = storage.world_version + 1
end

script.on_event(defines.events.on_selected_entity_changed, function(event)
    local player = game.get_player(event.player_index)
    if player and not Pointer.select(player, record(player).pointer) then
        refresh(player, false)
        registration()
    end
end)

script.on_event({
    defines.events.on_player_cursor_stack_changed,
    defines.events.on_gui_opened,
    defines.events.on_gui_closed,
    defines.events.on_player_joined_game,
    defines.events.on_player_changed_surface,
    defines.events.on_player_changed_force,
    defines.events.on_player_controller_changed,
    defines.events.on_player_display_scale_changed,
    defines.events.on_player_display_resolution_changed,
}, player_event)
script.on_event(defines.events.on_player_changed_position, function(event)
    refresh(game.get_player(event.player_index), false)
    registration()
end)

script.on_event(defines.events.on_player_toggled_alt_mode, function(event)
    local player = game.get_player(event.player_index)
    if not player then
        return
    end
    Alt.manual(record(player).auto_alt)
    refresh(player, true)
    registration()
end)

script.on_event("no-alt-needed-experiments", function(event)
    ---@cast event EventData.CustomInputEvent
    local player = game.get_player(event.player_index)
    if player then
        Experiments.toggle(player)
    end
end)
script.on_event(defines.events.on_lua_shortcut, function(event)
    if event.prototype_name == "no-alt-needed-experiments" then
        local player = game.get_player(event.player_index)
        if player then
            Experiments.toggle(player)
        end
    end
end)
script.on_event({
    defines.events.on_gui_click,
    defines.events.on_gui_checked_state_changed,
    defines.events.on_gui_selection_state_changed,
}, Experiments.changed)

script.on_event(defines.events.on_runtime_mod_setting_changed, function(event)
    if event.player_index then
        local player = game.get_player(event.player_index)
        if player then
            Experiments.refresh(player)
        end
    end
    if event.setting:sub(1, 14) ~= "no-alt-needed-" then
        return
    end
    if event.player_index then
        local player = game.get_player(event.player_index)
        if player then
            record(player).preferences = preferences(player)
            refresh(player, true)
        end
    else
        for _, player in pairs(game.players) do
            record(player).preferences = preferences(player)
        end
        refresh_all()
    end
    registration()
end)

script.on_event({ defines.events.on_pre_player_left_game, defines.events.on_player_left_game }, function(event)
    local player = game.get_player(event.player_index)
    if player then
        local state = record(player)
        clear(player, state)
        Alt.release(player, state.auto_alt)
    end
    storage.active[event.player_index] = nil
    registration()
end)

script.on_event(defines.events.on_player_removed, function(event)
    local state = storage.players[event.player_index]
    if state then
        Presentation.clear(state.exact)
        Nearby.clear(state.nearby)
        Pointer.clear(state.pointer)
        Fluid.clear(state.fluid)
        Capacity.clear(state.capacity)
        Warnings.clear(state.warnings)
    end
    storage.players[event.player_index], storage.active[event.player_index] = nil, nil
    registration()
end)

script.on_event(defines.events.on_entity_cloned, function(event)
    if Pointer.is_target(event.destination) then
        event.destination.destroy()
    else
        world_changed()
    end
end)

script.on_event({
    defines.events.on_built_entity,
    defines.events.on_robot_built_entity,
    defines.events.script_raised_built,
    defines.events.script_raised_revive,
    defines.events.script_raised_destroy,
    defines.events.on_player_mined_entity,
    defines.events.on_robot_mined_entity,
    defines.events.on_entity_died,
    defines.events.on_player_rotated_entity,
    defines.events.on_entity_settings_pasted,
    defines.events.on_space_platform_built_entity,
    defines.events.on_space_platform_mined_entity,
}, world_changed)

script.on_event({ defines.events.on_pre_surface_deleted, defines.events.on_pre_surface_cleared }, function()
    for _, player in pairs(game.players) do
        clear(player, record(player))
    end
    world_changed()
end)
script.on_event({
    defines.events.on_surface_deleted,
    defines.events.on_surface_cleared,
    defines.events.on_forces_merged,
    defines.events.on_force_friends_changed,
}, refresh_all)

local function initialize()
    for index, state in pairs(storage.players or {}) do
        -- Released saves before pointer tracking have no helper state.
        local old_pointer = state.pointer --[[@as table?]]
        if old_pointer then
            Pointer.clear(old_pointer)
        end
        local player = game.get_player(index)
        if player then
            Alt.release(player, state.auto_alt)
            Presentation.clear_card(player)
            Experiments.close(player)
        end
    end
    rendering.clear(script.mod_name)
    storage.schema, storage.players, storage.active, storage.world_version = 1, {}, {}, 0
    storage.capabilities = Capabilities.read()
    refresh_all()
end

script.on_init(initialize)
script.on_configuration_changed(initialize)
script.on_load(registration)

if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")({
        "tests.inspection",
        "tests.nearby",
        "tests.pointer",
        "tests.lifecycle",
        "tests.fluids",
        "tests.diagnostics",
        "tests.native_preview",
        "tests.native_fluids",
        "tests.native_gallery",
    }, { log_passed_tests = true, tag_blacklist = { "native-ui" } })
end
