local underground_appearance = require("reversed_underground_belt_detector.appearance")
local underground_preferences = require("reversed_underground_belt_detector.underground_preferences")
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
        settings.get_player_settings(player)[underground_preferences.alert_setting] = { value = original_alerts }
        settings.get_player_settings(player)[underground_preferences.overlay_setting] = { value = original_overlay }
    end)
    test("01 reversed-underground", function()
        async(underground_appearance.pulse_period * 2 + 120)
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
        local thumbnail_mouths = {}
        for part, x in ipairs({ 17.5, 18.5, 22.5, 23.5 }) do
            local mouth = part == 2 or part == 3
            local entity = assert(surface.create_entity({
                name = mouth and "underground-belt" or "transport-belt",
                position = { x, 20.5 },
                force = player.force,
                direction = mouth and defines.direction.west or defines.direction.east,
                type = mouth and (part == 2 and "output" or "input") or nil,
                raise_built = true,
            }))
            if mouth then
                thumbnail_mouths[#thumbnail_mouths + 1] = entity
            end
        end
        player.teleport({ 0, 0 }, surface)
        after_ticks(61, function()
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
                    for _, mouth in ipairs(thumbnail_mouths) do
                        local warnings = assert(storage.reversed_underground_belt_detector).warnings
                        local thumbnail_warning = assert(warnings[mouth.unit_number])
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
                        zoom = 1.25,
                        anti_alias = true,
                        force_render = true,
                        show_gui = false,
                        show_entity_info = false,
                        path = "detector-thumbnail.png",
                    })
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
end)
