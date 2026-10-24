local underground_appearance = require("reversed_underground_belt_detector.appearance")
local underground_preferences = require("reversed_underground_belt_detector.underground_preferences")
local warning_planner = require("reversed_underground_belt_detector.warning_planner")
local undergrounds = require("reversed_underground_belt_detector.undergrounds")
---@type defines.transport_line[]
local belt_lanes = { defines.transport_line.left_line, defines.transport_line.right_line }
---@type defines.transport_line[]
local underground_lanes = {
    defines.transport_line.left_line,
    defines.transport_line.right_line,
    defines.transport_line.left_underground_line,
    defines.transport_line.right_underground_line,
}
---@type LuaPlayer
local player
---@type boolean
local original_alerts
---@type string
local original_overlay

tags("native-ui")
describe("underground native", function()
    before_all(function()
        player = assert(game.connected_players[1], "Native verification requires a connected player")
        local alerts = player.mod_settings[underground_preferences.alert_setting].value
        local overlay = player.mod_settings[underground_preferences.overlay_setting].value
        assert(type(alerts) == "boolean" and type(overlay) == "string")
        original_alerts, original_overlay = alerts, overlay
        settings.get_player_settings(player)[underground_preferences.overlay_setting] = { value = "pulsing" }
        player.set_controller({ type = defines.controllers.god })
        local surface =
            game.create_surface("Underground detector studio", { width = 96, height = 96, water = 0, seed = 42 })
        surface.request_to_generate_chunks({ 0, 0 }, 2)
        surface.force_generate_chunk_requests()
        for _, entity in pairs(surface.find_entities()) do
            entity.destroy()
        end
        surface.destroy_decoratives({})
        local tiles = {}
        for x = -32, 32 do
            for y = -32, 32 do
                tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
            end
        end
        surface.set_tiles(tiles)
        assert(player.teleport({ 0, 0 }, surface))
        surface.daytime, surface.freeze_daytime = 0, true
        assert(player.force.chart)(surface, { { -32, -32 }, { 32, 32 } })
    end)
    after_all(function()
        assert(player.cursor_stack).clear()
        settings.get_player_settings(player)[underground_preferences.alert_setting] = { value = original_alerts }
        settings.get_player_settings(player)[underground_preferences.overlay_setting] = { value = original_overlay }
    end)
    test("01 reversed-underground", function()
        async(underground_appearance.pulse_period * 2 + 240)
        settings.get_player_settings(player)[underground_preferences.alert_setting] = { value = false }
        assert(player.gui.screen["factorio-test-test-gui"], "FactorioTest GUI was not initialized").visible = false
        local surface = player.surface
        local endpoints = {}
        for row, reversed in ipairs({ true, false }) do
            local y = row == 1 and -4.5 or 4.5
            for x = -7, 7 do
                local underground = x == -2 or x == 2
                if underground or x < -2 or x > 2 then
                    local entity = assert(surface.create_entity({
                        name = underground and "underground-belt" or "transport-belt",
                        position = { x + 0.5, y },
                        force = player.force,
                        direction = underground and reversed and defines.direction.west or defines.direction.east,
                        type = underground and ((x == -2) ~= reversed and "input" or "output") or nil,
                        raise_built = true,
                    }))
                    if underground then
                        endpoints[#endpoints + 1] = entity
                    end
                end
            end
            rendering.draw_text({
                text = reversed and "Reversed underground: actual flow" or "Correct underground: no overlay",
                surface = surface,
                target = { -7, y - 2 },
                color = { 1, 1, 1 },
                scale = 1.5,
            })
        end
        ---@type LuaEntity[]
        local second_endpoints = {}
        for part, x in ipairs({ -2.5, -1.5, 2.5, 3.5 }) do
            local mouth = part == 2 or part == 3
            local entity = assert(surface.create_entity({
                name = mouth and "underground-belt" or "transport-belt",
                position = { x, -13.5 },
                force = player.force,
                direction = mouth and defines.direction.west or defines.direction.east,
                type = mouth and (part == 2 and "output" or "input") or nil,
                raise_built = true,
            }))
            if mouth then
                second_endpoints[#second_endpoints + 1] = entity
            end
        end
        ---@type LuaEntity[]
        local thumbnail_mouths = {}
        ---@type LuaEntity[]
        local thumbnail_feed_belts = {}
        ---@type LuaEntity[]
        local thumbnail_empty_belts = {}
        for x = 14, 26 do
            local mouth = x == 18 or x == 22
            if mouth or x < 18 or x > 22 then
                local entity = assert(surface.create_entity({
                    name = mouth and "underground-belt" or "transport-belt",
                    position = { x + 0.5, 20.5 },
                    force = player.force,
                    direction = mouth and defines.direction.west or defines.direction.east,
                    type = mouth and (x == 18 and "output" or "input") or nil,
                    raise_built = true,
                }))
                if mouth then
                    thumbnail_mouths[#thumbnail_mouths + 1] = entity
                elseif x < 18 then
                    thumbnail_feed_belts[#thumbnail_feed_belts + 1] = entity
                else
                    thumbnail_empty_belts[#thumbnail_empty_belts + 1] = entity
                end
            end
        end
        local thumbnail_captured = false
        local function feed_thumbnail()
            if thumbnail_captured then
                return
            end
            local source = assert(thumbnail_feed_belts[1])
            for _, lane in ipairs(belt_lanes) do
                source.get_transport_line(lane).insert_at_back({ name = "iron-plate", count = 1 })
            end
            after_ticks(1, feed_thumbnail)
        end
        feed_thumbnail()
        player.teleport({ 0, 0 }, surface)
        after_ticks(161, function()
            ---@type RUBDWarning?
            local input_warning
            for index, entity in ipairs(endpoints) do
                local warnings = assert(storage.reversed_underground_belt_detector).warnings
                if index <= 2 then
                    local warning = assert(warnings[entity.unit_number])
                    assert(warning.sprite.valid and warning.sprite.orientation == 0.75)
                    if entity.belt_to_ground_type == "input" then
                        input_warning = warning
                        local span = assert(warning.span)
                        assert(#span == 3)
                        for _, sprite in ipairs(span) do
                            assert(sprite.valid and sprite.orientation == 0.75)
                            assert(sprite.color.a < warning.sprite.color.a)
                        end
                    end
                    local alerts = player.get_alerts({ type = defines.alert_type.custom })
                    for _, alert in pairs((alerts[surface.index] or {})[defines.alert_type.custom] or {}) do
                        assert(alert.target ~= entity, "Disabling alerts must leave world arrows independent")
                    end
                else
                    assert(not warnings[entity.unit_number])
                end
            end
            local warning = assert(input_warning)
            local span = assert(warning.span)
            local interior = assert(span[1])
            local second_input = assert(second_endpoints[2])
            local second_id = assert(second_input.unit_number)
            local second_warning = assert(storage.reversed_underground_belt_detector).warnings[second_id]
            local second_span = assert(assert(second_warning).span)
            local second_interior = assert(second_span[1])
            local samples = {}
            local frame_count = underground_appearance.pulse_period / underground_appearance.pulse_interval
            local function capture(frame)
                samples[#samples + 1] = {
                    tick = game.tick,
                    mouth = warning.sprite.color,
                    span = interior.color,
                }
                game.take_screenshot({
                    player = player,
                    position = { 0.5, -4.5 },
                    resolution = { 710, 200 },
                    zoom = 4,
                    anti_alias = true,
                    force_render = true,
                    show_gui = false,
                    show_entity_info = false,
                    path = string.format("underground-pulse/frame-%02d.png", frame),
                })
                if frame == 0 then
                    for _, belt in ipairs(thumbnail_feed_belts) do
                        for _, lane in ipairs(belt_lanes) do
                            assert(
                                belt.get_transport_line(lane).get_item_count("iron-plate") == 4,
                                "The thumbnail feeding belt must back up with full iron-plate lanes"
                            )
                        end
                    end
                    for _, belt in ipairs(thumbnail_empty_belts) do
                        for _, lane in ipairs(belt_lanes) do
                            assert(
                                belt.get_transport_line(lane).get_item_count() == 0,
                                "The reversed connection must leave downstream belts empty"
                            )
                        end
                    end
                    for _, mouth in ipairs(thumbnail_mouths) do
                        local max_line = mouth.get_max_transport_line_index()
                        for _, lane in ipairs(underground_lanes) do
                            if lane <= max_line then
                                assert(
                                    mouth.get_transport_line(lane).get_item_count() == 0,
                                    "Iron plates must not enter the reversed underground connection"
                                )
                            end
                        end
                        local warnings = assert(storage.reversed_underground_belt_detector).warnings
                        local thumbnail_warning = assert(warnings[assert(mouth.unit_number)])
                        assert(
                            thumbnail_warning.sprite.valid
                                and thumbnail_warning.sprite.visible
                                and thumbnail_warning.sprite.orientation == 0.75
                        )
                    end
                    game.take_screenshot({
                        player = player,
                        resolution = { player.display_resolution.width, player.display_resolution.height },
                        zoom = 1.5,
                        show_gui = true,
                        show_entity_info = true,
                        path = "release-ui/01-reversed-underground.png",
                    })
                    game.take_screenshot({
                        player = player,
                        position = { 20.5, 20.5 },
                        resolution = { 256, 256 },
                        zoom = 1,
                        anti_alias = true,
                        force_render = true,
                        show_gui = false,
                        show_entity_info = false,
                        path = "detector-thumbnail.png",
                    })
                    thumbnail_captured = true
                end
                if frame + 1 < frame_count then
                    after_ticks(underground_appearance.pulse_interval, function()
                        capture(frame + 1)
                    end)
                else
                    -- A blue probe distinguishes a neutral stock mask from a
                    -- yellow texture that still multiplies away the blue channel.
                    rendering.draw_sprite({
                        sprite = underground_appearance.sprite,
                        surface = surface,
                        target = { 20, -4.5 },
                        tint = { 0, 0.4, 1, 1 },
                        x_scale = 3,
                        y_scale = 3,
                        orientation = 0.75,
                    })
                    game.take_screenshot({
                        player = player,
                        position = { 20, -4.5 },
                        resolution = { 400, 240 },
                        zoom = 4,
                        show_gui = false,
                        show_entity_info = false,
                        path = "underground-pulse/tint-probe.png",
                    })
                    helpers.write_file("underground-pulse/samples.json", helpers.table_to_json(samples), false)
                    after_ticks(2, function()
                        player.selected = endpoints[1]
                        assert(warning.sprite.visible and not interior.visible)
                        assert(second_interior.visible, "Hover must leave the other pair's span visible")
                        game.take_screenshot({
                            player = player,
                            position = { 0.5, -9 },
                            resolution = { 710, 560 },
                            zoom = 1.5,
                            anti_alias = true,
                            force_render = true,
                            show_gui = false,
                            show_entity_info = true,
                            path = "underground-hover/pair-specific.png",
                        })
                        game.take_screenshot({
                            player = player,
                            position = { 0.5, -4.5 },
                            resolution = { 710, 200 },
                            zoom = 4,
                            anti_alias = true,
                            force_render = true,
                            show_gui = true,
                            show_entity_info = true,
                            path = "underground-hover/hovering.png",
                        })
                        after_ticks(2, function()
                            player.clear_selected_entity()
                            local restored_interior = assert(rendering.get_object_by_id(interior.id))
                            assert(warning.sprite.visible and restored_interior.visible)
                            local overlay_setting = underground_preferences.overlay_setting
                            settings.get_player_settings(player)[overlay_setting] = { value = "steady" }
                            local steady = assert(warning.steady)
                            local steady_span = assert(steady.span)
                            local steady_interior = assert(steady_span[1])
                            local pulsing_mouth = assert(rendering.get_object_by_id(warning.sprite.id))
                            assert(not pulsing_mouth.visible and steady.sprite.visible and steady_interior.visible)
                            game.take_screenshot({
                                player = player,
                                position = { 0.5, -4.5 },
                                resolution = { 710, 200 },
                                zoom = 4,
                                anti_alias = true,
                                force_render = true,
                                show_gui = false,
                                show_entity_info = false,
                                path = "underground-hover/steady.png",
                            })
                            after_ticks(2, function()
                                settings.get_player_settings(player)[overlay_setting] = { value = "pulsing" }
                                done()
                            end)
                        end)
                    end)
                end
            end
            local until_peak = underground_appearance.pulse_period - game.tick % underground_appearance.pulse_period
            after_ticks(until_peak, function()
                capture(0)
            end)
        end)
    end)
    test("02 warning-planner", function()
        async(240)
        local surface = player.surface
        ---@type LuaEntity[][]
        local rows = {}
        for _, x in ipairs({ -7, 2 }) do
            local row = {}
            for index, offset in ipairs({ -1, 0, 4, 5 }) do
                local mouth = index == 2 or index == 3
                row[index] = assert(surface.create_entity({
                    name = mouth and "underground-belt" or "transport-belt",
                    position = { x + offset + 0.5, 24.5 },
                    force = player.force,
                    direction = mouth and defines.direction.west or defines.direction.east,
                    type = mouth and (index == 2 and "output" or "input") or nil,
                    raise_built = true,
                }))
            end
            rows[#rows + 1] = row
        end
        local first_row, second_row = assert(rows[1]), assert(rows[2])
        local intentional_mouth = assert(first_row[2])
        local intentional_partner = assert(first_row[3])
        local active_mouth = assert(second_row[2])
        player.clear_selected_entity()
        assert(player.teleport({ 0, 24.5 }, surface))
        settings.get_player_settings(player)[underground_preferences.overlay_setting] = { value = "off" }
        local cursor = assert(player.cursor_stack)
        assert(cursor.set_stack({ name = warning_planner.name }))
        after_ticks(2, function()
            local warnings = assert(storage.reversed_underground_belt_detector).warnings
            local intentional_id = assert(intentional_mouth.unit_number)
            local active_id = assert(active_mouth.unit_number)
            local active = assert(warnings[active_id])
            assert(
                assert(active.steady).sprite.visible,
                "The planner must reveal active warnings even with overlays off"
            )
            local event = defines.events.on_player_selected_area
            undergrounds.events[event]({
                name = event,
                player_index = player.index,
                entities = { intentional_partner },
                item = warning_planner.name,
            })
            after_ticks(2, function()
                local acknowledged_warning = assert(warnings[intentional_id])
                local untouched_warning = assert(warnings[active_id])
                local marker = assert(acknowledged_warning.intentional_marker)
                local marker_id = marker.id
                assert(marker.valid and marker.visible and marker.sprite == "utility/check_mark_white")
                local viewers = assert(marker.players)
                assert(assert(viewers[1]).index == player.index)
                assert(
                    not acknowledged_warning.sprite.visible
                        and not acknowledged_warning.span
                        and not acknowledged_warning.steady
                )
                assert(player.gui.top[warning_planner.name])
                assert(assert(untouched_warning.steady).sprite.visible)
                game.take_screenshot({
                    player = player,
                    resolution = { player.display_resolution.width, player.display_resolution.height },
                    zoom = 2,
                    show_gui = true,
                    show_entity_info = true,
                    path = "release-ui/02-warning-planner.png",
                })
                -- Screenshot rendering is deferred; keep this state intact
                -- until the engine has rendered the requested frame.
                after_ticks(2, function()
                    assert(player.clear_cursor())
                    after_ticks(2, function()
                        local hidden_warning = assert(warnings[intentional_id])
                        local hidden_active = assert(warnings[active_id])
                        assert(not rendering.get_object_by_id(marker_id) and not hidden_warning.intentional_marker)
                        assert(not player.gui.top[warning_planner.name])
                        assert(
                            not hidden_active.sprite.visible and not hidden_active.steady,
                            "Putting away the planner restores off mode"
                        )
                        assert(cursor.set_stack({ name = warning_planner.name }))
                        after_ticks(2, function()
                            local undo = defines.events.on_player_alt_selected_area
                            undergrounds.events[undo]({
                                name = undo,
                                player_index = player.index,
                                entities = { intentional_mouth },
                                item = warning_planner.name,
                            })
                            local restored_warning = assert(warnings[intentional_id])
                            local restored_active = assert(warnings[active_id])
                            assert(not restored_warning.acknowledged and not restored_warning.intentional_marker)
                            assert(
                                assert(restored_warning.steady).sprite.visible
                                    and assert(restored_active.steady).sprite.visible
                            )
                            assert(player.clear_cursor())
                            done()
                        end)
                    end)
                end)
            end)
        end)
    end)
end)
