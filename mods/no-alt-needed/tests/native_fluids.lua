local Fluid = require("scripts.fluid-context")
local H = require("tests.helpers")
---@type LuaSurface
local surface
---@type LuaPlayer
local player
---@type {surface:LuaSurface,position:MapPosition,alt:boolean,sulfur:boolean,
---selection_updates:boolean,settings:table<string,boolean|string|number>}
local original
local names = { "fluid-context", "fluid-background", "fluid-radius", "fluid-search-radius" }

tags("native-ui")
describe("native presentation", function()
    after_each(function()
        player.selected = nil
        player.clear_cursor()
        player.opened = nil
        player.game_view_settings.show_entity_info = original.alt
        player.game_view_settings.update_entity_selection = original.selection_updates
        local force = player.force --[[@as LuaForce]]
        force.recipes.sulfur.enabled = original.sulfur
        for _, name in ipairs(names) do
            H.setting(player, name, original.settings[name])
        end
        player.teleport(original.position, original.surface)
        H.destroy_surface(surface)
    end)

    test("fluid construction context", function()
        player = assert(game.connected_players[1], "Fluid native scene requires a real connected client")
        original = {
            surface = player.surface,
            position = player.position,
            alt = player.game_view_settings.show_entity_info,
            sulfur = (player.force --[[@as LuaForce]]).recipes.sulfur.enabled,
            selection_updates = player.game_view_settings.update_entity_selection,
            settings = {},
        }
        for _, name in ipairs(names) do
            original.settings[name] = settings.get_player_settings(player)["no-alt-needed-" .. name].value
        end
        surface = H.surface()
        H.player(surface)
        player.opened = nil
        player.game_view_settings.update_entity_selection = false
        local force = player.force --[[@as LuaForce]]
        force.recipes.sulfur.enabled = true
        H.setting(player, "fluid-context", true)
        H.setting(player, "fluid-background", "none")
        H.setting(player, "fluid-radius", 15)
        H.setting(player, "fluid-search-radius", 50)
        player.game_view_settings.show_entity_info = false
        local plant = H.entity(surface, "chemical-plant", { -4, 0 })
        plant.set_recipe("sulfur")
        assert(plant.insert_fluid({ name = "water", amount = 30 }) > 0)
        assert(plant.insert_fluid({ name = "petroleum-gas", amount = 30 }) > 0)
        local boiler = H.entity(surface, "boiler", { 3, 0 })
        local pump = H.entity(surface, "pump", { 8, 0 })
        assert(pump.set_fluid_filter(1, { fluid = "water" }))
        local ghost = H.entity(
            surface,
            "entity-ghost",
            { -3, 6 },
            { inner_name = "chemical-plant", direction = defines.direction.east }
        )
        ghost.set_recipe("sulfur")
        assert(assert(player.cursor_stack).set_stack({ name = "pipe", count = 1 }))
        async(240)
        H.select_when_visible(player, plant, function()
            after_ticks(90, function()
                local state = assert(storage.players[player.index]).fluid
                assert(state.records, H.context(player))
                for _, entity in ipairs({ plant, boiler, pump, ghost }) do
                    local record = assert(
                        state.records[entity.unit_number],
                        "Construction scene omitted an applicable visible target"
                    )
                    assert(record.mode == "both" and #record.objects > 0)
                    assert(record.snapshot.unresolved == 0)
                end
                assert(Fluid.snapshot(ghost).ports[1], "Native ghost fluid layout is unavailable")
                H.capture(
                    player,
                    surface,
                    "native/fluid-context.png",
                    1600,
                    1000,
                    0.75,
                    { 1, 2 },
                    2.2,
                    "fluid construction context"
                )
                helpers.write_file(
                    "native/fluid-context.json",
                    helpers.table_to_json({
                        selection_source = "LuaPlayer.selected native API event",
                        actual_pointer_input = false,
                        alt = player.game_view_settings.show_entity_info,
                        background = settings.get_player_settings(player)["no-alt-needed-fluid-background"].value,
                        detailed_radius_tiles = 15,
                        search_envelope_tiles = 50,
                        scene = "fluid construction context",
                    }),
                    false
                )
                after_ticks(1, function()
                    player.selected = nil
                    after_ticks(2, function()
                        local cleared = assert(storage.players[player.index]).fluid
                        assert(
                            not cleared.order or #cleared.order == 0,
                            "Selection loss retained the construction neighborhood"
                        )
                        done()
                    end)
                end)
            end)
        end)
    end)
end)
