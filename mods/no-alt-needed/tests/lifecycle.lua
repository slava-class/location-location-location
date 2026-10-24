local H = require("tests.helpers")
local Inspect = require("scripts.inspect")
local Presentation = require("scripts.presentation")
local Alt = require("scripts.native-alt")

describe("presentation lifecycle", function()
    ---@type LuaSurface
    local surface
    ---@type LuaPlayer
    local player
    local original_alt
    local function native_alt()
        return player.game_view_settings.show_entity_info
    end
    before_each(function()
        surface = H.surface()
        player = H.player(surface)
        original_alt = player.game_view_settings.show_entity_info
        player.clear_cursor()
    end)
    after_each(function()
        player.selected = nil
        player.clear_cursor()
        player.game_view_settings.show_entity_info = original_alt
        Presentation.clear_card(player)
        H.destroy_surface(surface)
    end)

    test("stationary recipe and inventory changes replace owned presentation", function()
        local machine = H.entity(surface, "assembling-machine-3")
        machine.set_recipe("iron-gear-wheel")
        ---@type NoAltNeededRenderState
        local state = {}
        Presentation.update(player, machine, Inspect.snapshot(machine, H.preferences(), false), state, true)
        local first = assert(state.objects)
        machine.set_recipe("iron-stick")
        after_ticks(20, function()
            Presentation.update(player, machine, Inspect.snapshot(machine, H.preferences(), false), state, true)
            assert(assert(assert(state.snapshot).recipe).name == "iron-stick")
            for _, object in ipairs(first) do
                assert(not object.valid)
            end
            local stable = assert(assert(state.objects)[1])
            Presentation.update(player, machine, Inspect.snapshot(machine, H.preferences(), false), state, true)
            assert(assert(state.objects)[1] == stable, "Unchanged snapshot should not allocate replacement renders")
            Presentation.clear(state, player)
        end)
    end)

    test("automatic furnace recipes come from the native machine", function()
        local furnace = H.entity(surface, "no-alt-needed-test-automatic-furnace")
        assert(furnace.insert({ name = "stone", count = 4 }) == 4)
        after_ticks(20, function()
            local recipe = assert(Inspect.recipe(furnace))
            assert(recipe.name == "no-alt-needed-test-automatic-smelting")
        end)
    end)

    test("target destruction and ghost revival retain no stale render objects", function()
        local ghost = H.entity(surface, "entity-ghost", { 6, 0 }, { inner_name = "assembling-machine-3" })
        ghost.set_recipe("iron-gear-wheel")
        ---@type NoAltNeededRenderState
        local state = {}
        Presentation.update(player, ghost, Inspect.snapshot(ghost, H.preferences(), false), state, true)
        local old = assert(state.objects)
        local _, revived = ghost.revive({ raise_revive = true })
        assert(revived and revived.valid and not ghost.valid)
        for _, object in ipairs(old) do
            assert(not object.valid)
        end
        Presentation.update(player, revived, Inspect.snapshot(revived, H.preferences(), false), state, true)
        assert(assert(assert(state.snapshot).recipe).name == "iron-gear-wheel")
        revived.destroy({ raise_destroy = true })
        Presentation.clear(state, player)
        assert(state.entity == nil and state.snapshot == nil and #state.objects == 0)
    end)

    test("repeated enable disable cleanup preserves factory state", function()
        local chest = H.entity(surface, "steel-chest")
        chest.insert({ name = "copper-plate", count = 19 })
        ---@type NoAltNeededRenderState
        local state = {}
        for _ = 1, 10 do
            Presentation.update(player, chest, Inspect.snapshot(chest, H.preferences(), false), state, true)
            local objects = assert(state.objects)
            Presentation.clear(state, player)
            for _, object in ipairs(objects) do
                assert(not object.valid)
            end
        end
        assert(assert(chest.get_inventory(defines.inventory.chest)).get_item_count("copper-plate") == 19)
        assert(#state.objects == 0 and state.entity == nil)
    end)

    test("auto ALT preserves both initial states and releases its own lease", function()
        assert(player.cursor_stack).set_stack({ name = "blueprint", count = 1 })
        for _, initially_on in ipairs({ false, true }) do
            player.game_view_settings.show_entity_info = initially_on
            local state = {}
            Alt.update(player, state, true)
            assert(player.game_view_settings.show_entity_info)
            Alt.update(player, state, false)
            assert(player.game_view_settings.show_entity_info == initially_on)
        end
    end)

    test("manual ALT choice wins through a continuous relevant-tool session", function()
        player.game_view_settings.show_entity_info = false
        assert(player.cursor_stack).set_stack({ name = "blueprint", count = 1 })
        local state = {}
        Alt.update(player, state, true)
        player.game_view_settings.show_entity_info = false
        Alt.manual(state) -- Lease semantics only; real key-event delivery is a native-client gate.
        Alt.update(player, state, true)
        assert(not native_alt())
        assert(player.cursor_stack).set_stack({ name = "deconstruction-planner", count = 1 })
        Alt.update(player, state, true)
        assert(not native_alt())
        player.clear_cursor()
        Alt.update(player, state, true)
        assert(player.cursor_stack).set_stack({ name = "blueprint", count = 1 })
        Alt.update(player, state, true)
        assert(native_alt())
        Alt.release(player, state)
        assert(not native_alt())
    end)

    test("observable external ALT changes relinquish ownership", function()
        player.game_view_settings.show_entity_info = false
        assert(player.cursor_stack).set_stack({ name = "blueprint", count = 1 })
        local state = {}
        Alt.update(player, state, true)
        player.game_view_settings.show_entity_info = false
        Alt.update(player, state, true)
        player.game_view_settings.show_entity_info = true
        player.clear_cursor()
        Alt.update(player, state, true)
        assert(player.game_view_settings.show_entity_info, "A later external choice must not be undone")
    end)
end)
