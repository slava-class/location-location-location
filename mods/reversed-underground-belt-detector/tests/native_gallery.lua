local appearance = require("reversed_underground_belt_detector.appearance")
local preferences = require("reversed_underground_belt_detector.underground_preferences")

tags("native-ui", "portal-gallery")
describe("Underground detector gallery", function()
    test("01 reversed-underground", function()
        async(appearance.pulse_period + 120)
        local player = assert(game.connected_players[1], "Gallery requires a connected native player")
        assert(
            player.display_resolution.width == 1920 and player.display_resolution.height == 1080,
            "Gallery requires a 1920x1080 game window"
        )
        assert(math.abs(player.display_scale - 1.25) < 0.001, "Gallery requires 125% UI scale")
        player.set_controller({ type = defines.controllers.god })
        settings.get_player_settings(player)[preferences.alert_setting] = { value = false }
        settings.get_player_settings(player)[preferences.overlay_setting] = { value = "pulsing" }
        local surface =
            game.create_surface("Underground detector gallery", { width = 96, height = 96, water = 0, seed = 42 })
        surface.request_to_generate_chunks({ 0, 0 }, 2)
        surface.force_generate_chunk_requests()
        for _, entity in pairs(surface.find_entities()) do
            entity.destroy()
        end
        surface.destroy_decoratives({})
        local tiles = {}
        for x = -32, 32 do
            for y = -24, 24 do
                tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
            end
        end
        surface.set_tiles(tiles)
        surface.daytime, surface.freeze_daytime = 0, true
        assert(player.teleport({ 0.5, 0 }, surface))
        ---@type LuaEntity[]
        local reversed = {}
        ---@type LuaEntity[]
        local correct = {}
        for row = 1, 2 do
            local bad = row == 1
            local y = bad and -4.5 or 4.5
            for x = -7, 7 do
                local mouth = x == -2 or x == 2
                if mouth or x < -2 or x > 2 then
                    local entity = assert(surface.create_entity({
                        name = mouth and "underground-belt" or "transport-belt",
                        position = { x + 0.5, y },
                        force = player.force,
                        direction = mouth and bad and defines.direction.west or defines.direction.east,
                        type = mouth and ((x == -2) ~= bad and "input" or "output") or nil,
                        raise_built = true,
                    }))
                    if mouth then
                        local mouths = bad and reversed or correct
                        mouths[#mouths + 1] = entity
                    end
                end
            end
            rendering.draw_text({
                text = bad and "Reversed underground: actual flow" or "Correct underground: no overlay",
                surface = surface,
                target = { -7, y - 2 },
                color = { 1, 1, 1 },
                scale = 1.2,
            })
        end
        after_ticks(61, function()
            local warnings = assert(storage.reversed_underground_belt_detector).warnings
            for _, entity in ipairs(reversed) do
                local warning = assert(warnings[assert(entity.unit_number)])
                assert(warning.sprite.valid and warning.sprite.visible and warning.sprite.orientation == 0.75)
            end
            for _, entity in ipairs(correct) do
                assert(not warnings[assert(entity.unit_number)])
            end
            after_ticks(appearance.pulse_period - game.tick % appearance.pulse_period, function()
                game.take_screenshot({
                    player = player,
                    position = { 0.5, -1 },
                    resolution = { 1920, 1080 },
                    zoom = 2,
                    anti_alias = true,
                    force_render = true,
                    show_gui = false,
                    show_entity_info = false,
                    path = "gallery/01-reversed-underground.png",
                })
                helpers.write_file("gallery-scenes.jsonl", helpers.table_to_json({
                    scene = "reversed-underground",
                    file = "gallery/01-reversed-underground.png",
                    surface = surface.name,
                    resolution = { player.display_resolution.width, player.display_resolution.height },
                    ui_scale = player.display_scale,
                    world_zoom = 2,
                    seed = 42,
                }) .. "\n", false)
                done()
            end)
        end)
    end)
end)
