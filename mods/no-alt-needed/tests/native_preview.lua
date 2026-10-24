local H = require("tests.helpers")
local Inspect = require("scripts.inspect")
local Presentation = require("scripts.presentation")
local Experiments = require("scripts.experiments")

tags("native-ui")
describe("native presentation", function()
    ---@type LuaSurface
    local surface
    ---@type LuaPlayer
    local player
    local selection_updates
    before_each(function()
        player = assert(game.connected_players[1], "Native presentation requires a real connected client")
        selection_updates = player.game_view_settings.update_entity_selection
        player.game_view_settings.update_entity_selection = false
        surface = H.surface()
        H.player(surface)
        player.opened = nil
        player.game_view_settings.show_entity_info = false
        H.setting(player, "hover", true)
        H.setting(player, "nearby-recipes", true)
        H.setting(player, "experiment-nearby-focus", "retain")
        H.setting(player, "recipe-radius", 6)
        H.setting(player, "resources", "off")
        H.setting(player, "electricity", "off")
        H.setting(player, "ammo-counts", "off")
        H.setting(player, "auto-alt", false)
    end)
    after_each(function()
        Experiments.close(player)
        player.selected = nil
        player.opened = nil
        player.clear_cursor()
        player.game_view_settings.update_entity_selection = selection_updates
        H.destroy_surface(surface)
    end)

    test("hover nearby recipes and cleanup", function()
        local focused = H.entity(surface, "assembling-machine-3", { 0, 0 })
        H.setting(player, "recipe-radius", 12)
        focused.set_recipe("iron-gear-wheel")
        assert(focused.get_module_inventory()).insert({ name = "speed-module", count = 2 })
        local neighbor = H.entity(surface, "assembling-machine-3", { 12, 0 })
        neighbor.set_recipe("iron-gear-wheel")
        local outside = H.entity(surface, "assembling-machine-3", { 16, 0 })
        outside.set_recipe("iron-gear-wheel")
        H.select_when_visible(player, focused, function()
            after_ticks(30, function()
                local state = assert(storage.players[player.index])
                assert(assert(assert(state.exact.snapshot, H.context(player)).recipe).name == "iron-gear-wheel")
                local recipes = {}
                for _, object in ipairs(rendering.get_all_objects(script.mod_name)) do
                    if
                        object.surface == surface
                        and object.type == "sprite"
                        and object.sprite == "recipe/iron-gear-wheel"
                    then
                        local target = assert(object.target.entity)
                        assert(not recipes[target.unit_number], "Hover must not duplicate the nearby recipe")
                        recipes[target.unit_number] = true
                    end
                end
                assert(recipes[focused.unit_number] and recipes[neighbor.unit_number])
                assert(not recipes[outside.unit_number], "Recipes outside the configured radius must stay hidden")
                H.capture(
                    player,
                    surface,
                    "native/hover-nearby.png",
                    1600,
                    1000,
                    0.75,
                    { 8, 0 },
                    1,
                    "hover nearby recipes and cleanup"
                )
                after_ticks(1, function()
                    focused.set_recipe("copper-cable")
                    after_ticks(20, function()
                        local updated = assert(storage.players[player.index])
                        assert(
                            assert(assert(updated.exact.snapshot).recipe).name == "copper-cable",
                            "Stationary recipe changes must refresh"
                        )
                        player.selected = nil
                        after_ticks(2, function()
                            assert(#state.exact.objects == 0, "Exact inspection must clear immediately")
                            assert(next(state.nearby.entries) ~= nil, "Retained recipes must survive the gap")
                            H.setting(player, "experiment-nearby-focus", "selection")
                            after_ticks(2, function()
                                assert(
                                    next(state.nearby.entries) == nil,
                                    "Live focus changes must clear the retained layer"
                                )
                            end)
                        end)
                    end)
                end)
            end)
        end)
    end)

    test("configuration and large module geometry", function()
        local machine = H.entity(surface, "no-alt-needed-test-farm-40", { 0, 0 })
        machine.set_recipe("iron-gear-wheel")
        local inventory = assert(machine.get_module_inventory())
        for slot = 1, #inventory do
            inventory[slot].set_stack({ name = "speed-module", count = 1 })
        end
        H.select_when_visible(player, machine, function()
            after_ticks(30, function()
                local state = assert(storage.players[player.index])
                assert(
                    state.exact.snapshot and #H.group(state.exact.snapshot, "modules").entries == 40,
                    H.context(player)
                )
                local geometry = Presentation.geometry(machine, state.exact.snapshot)
                for _, layout in ipairs(geometry.groups) do
                    assert(not layout.overflow, "The large native fixture must have enough space for all module slots")
                end
                H.capture(
                    player,
                    surface,
                    "native/module-geometry.png",
                    1600,
                    1000,
                    0.75,
                    { 0, 0 },
                    2,
                    "configuration and large module geometry"
                )
                after_ticks(2, function()
                    local combinator = H.entity(surface, "arithmetic-combinator", { 6, 0 })
                    local control = assert(combinator.get_or_create_control_behavior()) --[[@as LuaArithmeticCombinatorControlBehavior]]
                    control.parameters = {
                        first_signal = { name = "iron-plate" },
                        second_constant = 2,
                        operation = "*",
                        output_signal = { type = "virtual", name = "signal-A" },
                    }
                    player.selected = combinator
                    after_ticks(2, function()
                        assert(
                            player.gui.left.no_alt_needed_context,
                            "Public circuit parameters need their context card"
                        )
                        assert(assert(Inspect.snapshot(combinator, H.preferences(), false)).operator == "*")
                        player.opened = combinator
                        assert(player.opened == combinator, "Native panel fixture must be within the player's reach")
                        after_ticks(2, function()
                            assert(
                                #assert(storage.players[player.index]).exact.objects == 0,
                                "Opened panels must clear world inspection"
                            )
                            assert(not player.gui.left.no_alt_needed_context)
                        end)
                    end)
                end)
            end)
        end)
    end)

    test("live experiments preserve world inspection and canonical preferences", function()
        local anchor = H.entity(surface, "transport-belt", { -4, 0 })
        local machine = H.entity(surface, "assembling-machine-3", { 0, 0 })
        machine.set_recipe("iron-gear-wheel")
        H.entity(surface, "substation", { 4, 4 })
        local supply = H.entity(surface, "electric-energy-interface", { 9, 7 })
        supply.electric_buffer_size, supply.power_production, supply.energy = 1000000000, 1000000000, 1000000000
        ---@type NoAltNeededExperimentsFrame
        local frame
        local function dispatch(event, element)
            assert(script.get_event_handler(event))({
                name = event,
                tick = game.tick,
                player_index = player.index,
                element = element,
                prototype_name = "no-alt-needed-experiments",
            })
        end
        ---@return integer
        local function visible_recipe()
            local count = 0
            for _, object in ipairs(rendering.get_all_objects(script.mod_name)) do
                if
                    object.surface == surface
                    and object.type == "sprite"
                    and object.sprite == "recipe/iron-gear-wheel"
                then
                    assert(object.target.entity == machine)
                    count = count + 1
                end
            end
            return count
        end
        local function choose_focus(value)
            local control = assert(frame.body.controls["no-alt-needed-experiment-nearby-focus"])
            for index, choice in ipairs(assert(prototypes.mod_setting[control.name].allowed_values)) do
                if choice == value then
                    control.selected_index = index
                    dispatch(defines.events.on_gui_selection_state_changed, control)
                    return
                end
            end
            error("Missing declared focus choice")
        end
        H.select_when_visible(player, anchor, function()
            after_ticks(20, function()
                assert(visible_recipe() == 1)
                dispatch(defines.events.on_lua_shortcut)
                frame = assert(player.gui.screen.no_alt_needed_experiments) --[[@as NoAltNeededExperimentsFrame]]
                assert(player.opened == nil, "The live panel must not block world inspection")
                player.selected = nil
                after_ticks(2, function()
                    assert(visible_recipe() == 1)
                    choose_focus("selection")
                    after_ticks(2, function()
                        assert(visible_recipe() == 0, "The live choice must change actual retained presentation")
                        H.setting(player, "experiment-nearby-focus", "grace")
                        after_ticks(2, function()
                            local focus = assert(frame.body.controls["no-alt-needed-experiment-nearby-focus"])
                            assert(
                                assert(prototypes.mod_setting[focus.name].allowed_values)[focus.selected_index]
                                    == "grace"
                            )
                            player.selected = anchor
                            local nearby = assert(frame.body.controls["no-alt-needed-nearby-recipes"])
                            nearby.state = false
                            dispatch(defines.events.on_gui_checked_state_changed, nearby)
                            after_ticks(2, function()
                                assert(visible_recipe() == 0)
                                dispatch(defines.events.on_gui_click, frame.header.close)
                                assert(not frame.valid, "Closing must destroy the actual panel")
                                dispatch(defines.events.on_lua_shortcut)
                                frame = assert(player.gui.screen.no_alt_needed_experiments) --[[@as NoAltNeededExperimentsFrame]]
                                nearby = assert(frame.body.controls["no-alt-needed-nearby-recipes"])
                                assert(not nearby.state, "Closing and reopening must preserve canonical preferences")
                                nearby.state = true
                                dispatch(defines.events.on_gui_checked_state_changed, nearby)
                                after_ticks(2, function()
                                    assert(visible_recipe() == 1 and player.opened == nil)
                                    H.capture(
                                        player,
                                        surface,
                                        "native/experiments.png",
                                        1600,
                                        1000,
                                        0.75,
                                        { 1, 0 },
                                        2,
                                        "live experiments preserve world inspection and canonical preferences"
                                    )
                                end)
                            end)
                        end)
                    end)
                end)
            end)
        end)
    end)
end)
