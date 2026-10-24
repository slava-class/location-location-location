local H = require("tests.helpers")

tags("native-ui", "portal-gallery")
describe("portal gallery", function()
    ---@type LuaSurface
    local surface
    ---@type LuaPlayer
    local player
    local selection_updates
    after_each(function()
        player.selected = nil
        player.clear_cursor()
        player.game_view_settings.update_entity_selection = selection_updates
        H.destroy_surface(surface)
    end)
    test("unlocked refinery context", function()
        player = assert(game.connected_players[1], "Gallery requires a real connected Extreme client")
        selection_updates = player.game_view_settings.update_entity_selection
        player.game_view_settings.update_entity_selection = false
        surface = H.surface()
        H.player(surface)
        player.opened = nil
        player.game_view_settings.show_entity_info = false
        H.setting(player, "hover", true)
        H.setting(player, "nearby-recipes", true)
        H.setting(player, "recipe-radius", 6)
        H.setting(player, "fluid-context", true)
        H.setting(player, "fluid-background", "none")
        H.setting(player, "resources", "off")
        H.setting(player, "electricity", "off")
        H.setting(player, "ammo-counts", "off")
        H.setting(player, "auto-alt", false)
        local force = player.force --[[@as LuaForce]]
        force.research_all_technologies()
        for _, name in ipairs({ "basic-oil-processing", "iron-gear-wheel", "copper-cable" }) do
            assert(force.recipes[name].enabled, "Every gallery recipe must be unlocked, not merely configured")
        end
        local refinery = H.entity(surface, "oil-refinery", { 0, 0 })
        refinery.set_recipe("basic-oil-processing")
        assert(refinery.get_module_inventory()).insert({ name = "speed-module", count = 2 })
        local gears = H.entity(surface, "assembling-machine-3", { 5, 0 })
        gears.set_recipe("iron-gear-wheel")
        local wire = H.entity(surface, "assembling-machine-3", { 5, 4 })
        wire.set_recipe("copper-cable")
        H.entity(surface, "pipe", { -1, 4 })
        H.select_when_visible(player, refinery, function()
            after_ticks(45, function()
                local state = assert(storage.players[player.index])
                local recipe = assert(assert(state.exact.snapshot).recipe)
                assert(recipe.name == "basic-oil-processing" and not recipe.unavailable)
                assert(next(state.nearby.entries), "Gallery must show actual nearby recipe context")
                H.capture(
                    player,
                    surface,
                    "gallery/refinery-context.png",
                    1920,
                    1080,
                    1.25,
                    { 1.8, 0.8 },
                    2,
                    "unlocked refinery context"
                )
                -- This is an actual native render candidate, never a painted placeholder.
                -- Main inspects and promotes these bytes only after Extreme qualification.
                game.take_screenshot({
                    player = player,
                    by_player = player,
                    surface = surface,
                    position = { 0, 0 },
                    resolution = { 256, 256 },
                    zoom = 1.05,
                    path = "no-alt-needed-thumbnail.png",
                    show_gui = false,
                    show_entity_info = false,
                    anti_alias = true,
                    force_render = true,
                })
                game.set_wait_for_screenshots_to_finish()
                after_ticks(2, function()
                    assert(refinery.valid and player.selected == refinery)
                end)
            end)
        end)
    end)
end)
