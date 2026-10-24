local H = require("tests.helpers")
local Pointer = require("scripts.pointer")
local Nearby = require("scripts.nearby")

describe("empty ground pointer", function()
    ---@type LuaSurface
    local surface
    ---@type LuaPlayer
    local player
    ---@type LuaEntity
    local radar
    ---@type table
    local state
    ---@type table
    local view
    local original, zoom, original_focus
    before_each(function()
        surface = H.surface()
        player = H.player(surface)
        original_focus = settings.get_player_settings(player)["no-alt-needed-experiment-nearby-focus"].value
        H.setting(player, "experiment-nearby-focus", "selection")
        zoom = player.zoom
        player.zoom = 2
        radar = H.entity(surface, "radar", { 0, -40 })
        H.entity(surface, "substation", { 0, -36 })
        local supply = H.entity(surface, "electric-energy-interface", { 3, -40 })
        supply.electric_buffer_size, supply.power_production, supply.energy = 1000000000, 1000000000, 1000000000
        state = {}
        view = { surface = surface, position = player.position, tick = game.tick, alt = false, blocked = false }
        original = script.get_event_handler(defines.events.on_selected_entity_changed)
        script.on_event(defines.events.on_selected_entity_changed, function()
            Pointer.select(player, state)
        end)
    end)
    after_each(function()
        Pointer.clear(state)
        player.zoom = zoom
        script.on_event(defines.events.on_selected_entity_changed, original)
        H.destroy_surface(surface)
        H.setting(player, "experiment-nearby-focus", original_focus)
    end)
    local function fill()
        for _ = 1, 40 do
            Pointer.update(player, state, view, true)
            view.tick = view.tick + 1
        end
    end
    local function count()
        return surface.count_entities_filtered({ type = "simple-entity-with-owner" })
    end
    local function visible()
        return true
    end
    local function visible_test(name, run)
        test(name, function()
            H.select_when_visible(player, radar, function()
                player.selected = nil
                after_ticks(60, function()
                    local force = player.force --[[@as LuaForce]]
                    assert(force.is_chunk_visible(surface, { -1, 0 }) and force.is_chunk_visible(surface, { 0, 0 }))
                    run()
                end)
            end)
        end)
    end

    visible_test("native ground selection clears helpers without changing their population", function()
        async(400)
        fill()
        local before = count()
        assert(before > 0 and before <= 1024)
        player.game_view_settings.show_entity_tooltip = true
        player.update_selected_entity({ -7, 7 })
        assert(not player.selected and state.point)
        assert(math.abs(state.point.x + 7) <= state.size / 2 and math.abs(state.point.y - 7) <= state.size / 2)
        assert(player.game_view_settings.show_entity_tooltip)
        assert(count() == before)
        local step = 0
        local function move()
            step = step + 1
            view.tick = game.tick
            Pointer.update(player, state, view, true)
            local x = step <= 150 and -7 or (step % 2 == 0 and -7 or 7)
            player.update_selected_entity({ x, 7 })
            assert(
                not player.selected
                    and math.abs(state.point.x - x) <= state.size / 2
                    and math.abs(state.point.y - 7) <= state.size / 2,
                helpers.table_to_json({
                    step = step,
                    target_x = x,
                    point = state.point,
                    size = state.size,
                    selected = player.selected and player.selected.name,
                })
            )
            assert(
                count() == before,
                "Helper population changed: "
                    .. helpers.table_to_json({ step = step, before = before, current = count() })
            )
            if step < 250 then
                after_ticks(1, move)
            else
                done()
            end
        end
        after_ticks(1, move)
    end)

    visible_test("real entities building mining blueprints and deconstruction ignore helpers", function()
        fill()
        assert(surface.can_place_entity({ name = "wooden-chest", position = { 1.5, 1.5 }, force = player.force }))
        local chest = H.entity(surface, "wooden-chest", { 1.5, 1.5 })
        player.update_selected_entity(chest.position)
        assert(player.selected == chest and not state.point, "Real entities must win native hit-testing")
        for _, entity in pairs(state.cells) do
            assert(not entity.minable_flag and not entity.destructible)
            local copy = entity.clone({ position = { 40, 0 }, surface = surface, force = player.force })
            assert(not copy or not copy.valid, "Cloning a factory must not leave unowned selection helpers")
        end
        local inventory = game.create_inventory(1)
        inventory[1].set_stack({ name = "blueprint" })
        inventory[1].create_blueprint({ surface = surface, force = player.force, area = { { -20, -20 }, { 20, 20 } } })
        local entities = assert(inventory[1].get_blueprint_entities())
        assert(#entities == 1 and entities[1].name == "wooden-chest")
        surface.deconstruct_area({ area = { { -20, -20 }, { 20, 20 } }, force = player.force, player = player })
        assert(chest.to_be_deconstructed())
        for _, entity in pairs(state.cells) do
            assert(not entity.to_be_deconstructed(), "Helpers must never enter deconstruction orders")
        end
        chest.cancel_deconstruction(player.force)
        assert(player.mine_entity(chest, true), "Helpers must not prevent mining a real entity")
        inventory.destroy()
    end)

    visible_test("viewport changes are bounded and disabled contexts remove every helper", function()
        Pointer.update(player, state, view, true)
        assert(count() <= 32, "Initial population must be distributed across ticks")
        fill()
        player.zoom = 0.5
        view.position, view.tick = { x = 40, y = 40 }, view.tick + 15
        fill()
        assert(state.size > 2 and count() <= 1024)
        for _, entity in pairs(state.cells) do
            assert(entity.render_player == player)
            assert(entity.name == "no-alt-needed-pointer-" .. state.size)
        end
        view.blocked = true
        assert(not Pointer.update(player, state, view, true))
        assert(count() == 0 and not state.point)
        view.blocked = false
        fill()
        view.alt = true
        assert(not Pointer.update(player, state, view, true) and count() == 0)
        view.alt = false
        fill()
        assert(not Pointer.update(player, state, view, false) and count() == 0)
    end)

    visible_test("sampled ground focus moves recipe coverage without a helper anchor", function()
        local left = H.entity(surface, "assembling-machine-3", { -10, 0 })
        local right = H.entity(surface, "assembling-machine-3", { 10, 0 })
        left.set_recipe("iron-gear-wheel")
        right.set_recipe("copper-cable")
        local nearby = {}
        view.visible, view.pointer = visible, { x = -7, y = 1 }
        local preferences = H.preferences({ nearby_focus = "pointer", radius = 4 })
        assert(Nearby.update(player, nearby, view, preferences, 1))
        local function only(expected)
            local found = 0
            for _, entry in pairs(nearby.entries) do
                assert(entry.entity == expected)
                found = found + 1
            end
            assert(found == 1)
        end
        only(left)
        view.pointer = { x = 7, y = 1 }
        Nearby.update(player, nearby, view, preferences, 1)
        only(right)
        view.blocked = true
        assert(not Nearby.update(player, nearby, view, preferences, 1))
        assert(next(nearby.entries) == nil)
    end)
end)
