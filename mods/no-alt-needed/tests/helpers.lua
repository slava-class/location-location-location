local mod_gui = require("__core__.lualib.mod-gui")
local Helpers = {}
local sequence = 0
---@return LuaSurface
function Helpers.surface()
    sequence = sequence + 1
    local surface = game.create_surface("no-alt-needed-test-" .. game.tick .. "-" .. sequence, {
        width = 256,
        height = 256,
        seed = 1729,
        default_enable_all_autoplace_controls = false,
        autoplace_settings = {
            entity = { treat_missing_as_default = false },
            decorative = { treat_missing_as_default = false },
        },
    })
    surface.request_to_generate_chunks({ 0, 0 }, 2)
    surface.force_generate_chunk_requests()
    surface.daytime, surface.freeze_daytime = 0, true
    return surface
end
---@param surface LuaSurface
---@param name string
---@param position MapPosition?
---@param extra table?
---@return LuaEntity
function Helpers.entity(surface, name, position, extra)
    local definition = { name = name, position = position or { 0, 0 }, force = game.forces.player }
    for key, value in pairs(extra or {}) do
        definition[key] = value
    end
    local entity = assert(surface.create_entity(definition), "Could not create native test entity " .. name)
    return entity
end
---@param surface LuaSurface
---@return LuaPlayer
function Helpers.player(surface)
    local player = assert(game.get_player(1), "Canonical fixture must supply player 1")
    player.teleport({ 0, 0 }, surface)
    local force = player.force --[[@as LuaForce]]
    force.chart(surface, { { -100, -100 }, { 100, 100 } })
    return player
end
---@param surface LuaSurface?
function Helpers.destroy_surface(surface)
    if surface and surface.valid then
        game.delete_surface(surface)
    end
end
---@return NoAltNeededPreferences
function Helpers.preferences(changes)
    local result = {
        hover = true,
        nearby = true,
        nearby_focus = "retain",
        radius = 6,
        resources = "off",
        electricity = "off",
        ammo_counts = "off",
        auto_alt = false,
        inserter_capacity = true,
        warnings = "alt",
        warning_inserters = true,
        warning_drills = true,
        warning_fluids = "issues",
        warning_ignored = {},
    }
    for key, value in pairs(changes or {}) do
        result[key] = value
    end
    return result
end
function Helpers.group(snapshot, id)
    for _, group in ipairs(snapshot.groups) do
        if group.id == id then
            return group
        end
    end
    return nil
end
---@param player LuaPlayer
function Helpers.setting(player, name, value)
    settings.get_player_settings(player)["no-alt-needed-" .. name] = { value = value }
end
---@param player LuaPlayer
function Helpers.context(player)
    local state = storage.players[player.index]
    local position = player.position --[[@as {x:number,y:number}]]
    return helpers.table_to_json({
        connected = player.connected,
        selected = player.selected and player.selected.name,
        opened = player.opened_gui_type,
        render_mode = player.render_mode,
        visible = (player.force --[[@as LuaForce]]).is_chunk_visible(player.surface, {
            math.floor(position.x / 32),
            math.floor(position.y / 32),
        }),
        surface = player.surface.name,
        state_selected = state and state.selected and state.selected.valid and state.selected.name,
        blocked = state and state.blocked,
        active = storage.active[player.index],
    })
end
function Helpers.select_when_visible(player, entity, ready)
    local deadline = game.tick + 120
    local function observe()
        local position = entity.position
        if
            (player.force --[[@as LuaForce]]).is_chunk_visible(entity.surface, {
                math.floor(position.x / 32),
                math.floor(position.y / 32),
            })
        then
            player.selected = entity
            ready()
        else
            assert(game.tick < deadline, Helpers.context(player))
            after_ticks(1, observe)
        end
    end
    observe()
end
function Helpers.capture(player, surface, path, width, height, scale, position, zoom, name)
    assert(
        player.display_resolution.width == width and player.display_resolution.height == height,
        "Actual native viewport does not match the capture contract"
    )
    assert(player.display_scale == scale, "Actual native UI scale does not match the capture contract")
    local framework_gui = assert(player.gui.screen["factorio-test-test-gui"], "Native framework GUI is absent")
    local framework_visible = framework_gui.visible
    framework_gui.visible = false
    local button_flow = mod_gui.get_button_flow(player)
    local framework_button = assert(button_flow["factorio-test:mod-select"])
    local framework_frame = assert(player.gui.top.mod_gui_top_frame)
    local button_visible, frame_visible = framework_button.visible, framework_frame.visible
    framework_button.visible = false
    local another_button = false
    for _, button in ipairs(button_flow.children) do
        if button.visible then
            another_button = true
            break
        end
    end
    if not another_button then
        framework_frame.visible = false
    end
    game.take_screenshot({
        player = player,
        by_player = player,
        surface = surface,
        position = position or { 0, 0 },
        resolution = { width, height },
        zoom = zoom or 1.7,
        path = path,
        show_gui = true,
        show_entity_info = player.game_view_settings.show_entity_info,
        anti_alias = true,
        force_render = true,
    })
    game.set_wait_for_screenshots_to_finish()
    after_ticks(1, function()
        framework_gui.visible = framework_visible
        framework_button.visible = button_visible
        framework_frame.visible = frame_visible
    end)
    helpers.write_file("gallery-scenes.jsonl", helpers.table_to_json({
        scene = name,
        surface = surface.name,
        width = width,
        height = height,
        scale = player.display_scale,
        locale = player.locale,
        zoom = zoom or 1.7,
        position = position or { 0, 0 },
    }) .. "\n", true)
end
return Helpers
