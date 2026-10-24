local scene = {}

---@param path string
---@param width integer
---@param height integer
---@param scale number
function scene.capture(path, width, height, scale)
    async(180)
    local player = assert(game.connected_players[1], "The tooltip scene requires a connected native player")
    assert(player.display_resolution.width == width and player.display_resolution.height == height)
    assert(math.abs(player.display_scale - scale) < 0.001, "Unexpected native UI scale")
    player.set_controller({ type = defines.controllers.god })
    player.opened = nil
    assert(player.force.research_all_technologies)()
    local surface = game.create_surface("recipe-tooltip-studio", { width = 64, height = 64, water = 0, seed = 42 })
    surface.request_to_generate_chunks({ 0, 0 }, 1)
    surface.force_generate_chunk_requests()
    for _, entity in pairs(surface.find_entities()) do
        entity.destroy()
    end
    surface.destroy_decoratives({})
    local tiles = {}
    for x = -24, 24 do
        for y = -20, 20 do
            tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
        end
    end
    surface.set_tiles(tiles)
    surface.daytime, surface.freeze_daytime = 0, true
    assert(player.teleport({ 0, 0 }, surface))
    assert(player.force.chart)(surface, { { -24, -20 }, { 24, 20 } })
    local entity = assert(surface.create_entity({ name = "oil-refinery", position = { 0, 0 }, force = player.force }))
    entity.set_recipe("advanced-oil-processing")
    player.zoom = 2
    player.game_view_settings.show_entity_info = false
    player.game_view_settings.show_entity_tooltip = true
    player.game_view_settings.update_entity_selection = false
    player.update_selected_entity(entity.position)
    assert(player.gui.screen["factorio-test-test-gui"]).visible = false
    after_ticks(30, function()
        player.update_selected_entity(entity.position)
        local fields = entity.get_tooltip_fields()
        assert(#fields == 1 and type(fields[1].name) == "table" and fields[1].name[1] == "recipe-name-tooltip.recipe")
        game.take_screenshot({
            player = player,
            position = { 0, 0 },
            resolution = { width, height },
            zoom = 2,
            anti_alias = true,
            force_render = true,
            show_gui = true,
            show_entity_info = false,
            path = path,
        })
        helpers.write_file("recipe-tooltip-scenes.jsonl", helpers.table_to_json({
            file = path,
            recipe = assert(entity.get_recipe()).name,
            field = fields[1],
            locale = player.locale,
            resolution = { player.display_resolution.width, player.display_resolution.height },
            ui_scale = player.display_scale,
            world_zoom = 2,
        }) .. "\n", false)
        after_ticks(1, function()
            done()
        end)
    end)
end

return scene
