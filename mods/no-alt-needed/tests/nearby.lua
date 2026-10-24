local H = require("tests.helpers")
local Nearby = require("scripts.nearby")
local Inspect = require("scripts.inspect")
local Presentation = require("scripts.presentation")

describe("nearby recipe semantics", function()
    ---@type LuaSurface
    local surface
    before_each(function()
        surface = H.surface()
    end)
    after_each(function()
        H.destroy_surface(surface)
    end)

    test("large footprints are included at the exact edge", function()
        local machine = H.entity(surface, "no-alt-needed-test-farm-40", { 10, 0 })
        local edge = assert(assert(machine.bounding_box.left_top).x)
        assert(Nearby.includes(machine, { x = edge - 6, y = 0 }, 6))
        assert(not Nearby.includes(machine, { x = edge - 6 - 1 / 64, y = 0 }, 6))
        assert(Nearby.includes(machine, { x = 10, y = 0 }, 1))
    end)

    test("the boundary is circular rather than a square query", function()
        local machine = H.entity(surface, "assembling-machine-3", { 10, 10 })
        local corner = assert(machine.bounding_box.left_top)
        local x, y = assert(corner.x), assert(corner.y)
        assert(not Nearby.includes(machine, { x = x - 5, y = y - 5 }, 6))
        assert(Nearby.includes(machine, { x = x - 4, y = y - 4 }, 6))
    end)

    test("nearby presentation shows recipes without module contents", function()
        local player = H.player(surface)
        local belt = H.entity(surface, "transport-belt", { 0, 0 })
        local machine = H.entity(surface, "assembling-machine-3", { 4, 0 })
        machine.set_recipe("iron-gear-wheel")
        assert(machine.get_module_inventory()).insert({ name = "speed-module", count = 2 })
        local state = {}
        Nearby.update(player, state, {
            selected = belt,
            surface = surface,
            tick = game.tick,
            alt = false,
            blocked = false,
            visible = function()
                return true
            end,
        }, H.preferences(), 1)
        ---@type NoAltNeededRenderState
        local hovered = {}
        Presentation.update(player, machine, Inspect.snapshot(machine, H.preferences(), false), hovered, true)
        ---@type LuaRenderObject?
        local hovered_recipe
        for _, object in ipairs(assert(hovered.objects)) do
            if object.type == "sprite" and object.sprite == "recipe/iron-gear-wheel" then
                hovered_recipe = object
            end
        end
        assert(hovered_recipe, "The hovered machine must show its recipe")
        local hovered_offset = assert(hovered_recipe.target.offset)
        local recipe_count = 0
        for _, entry in pairs(state.entries) do
            for _, object in ipairs(entry.render.objects) do
                if object.type == "sprite" then
                    assert(object.sprite ~= "item/speed-module", "Nearby presentation must not spread module grids")
                    if object.sprite == "recipe/iron-gear-wheel" then
                        recipe_count = recipe_count + 1
                        assert(
                            object.x_scale == hovered_recipe.x_scale and object.y_scale == hovered_recipe.y_scale,
                            "Moving onto a nearby machine must not resize its recipe"
                        )
                        local nearby_offset = assert(object.target.offset)
                        assert(
                            (nearby_offset[1] or nearby_offset.x) == (hovered_offset[1] or hovered_offset.x)
                                and (nearby_offset[2] or nearby_offset.y) == (hovered_offset[2] or hovered_offset.y),
                            "Moving onto a nearby machine must not shift its recipe"
                        )
                    end
                end
            end
        end
        assert(recipe_count == 1, "The neighbouring machine's actual recipe must be visible once")
        Nearby.clear(state)
        Presentation.clear(hovered, player)
    end)

    test("moving and rotating a real target recomputes footprint inclusion", function()
        local machine = H.entity(surface, "assembling-machine-3", { 5, 0 })
        assert(Nearby.includes(machine, { x = 0, y = 0 }, 6))
        assert(machine.teleport({ 20, 0 }))
        machine.direction = defines.direction.east
        assert(not Nearby.includes(machine, { x = 0, y = 0 }, 6))
    end)

    test("retained focus keeps recipes visible across empty gaps and changed anchors", function()
        local player = H.player(surface)
        local first = H.entity(surface, "transport-belt", { -9, 0 })
        local second = H.entity(surface, "transport-belt", { 9, 0 })
        local machines = {}
        for x = -2, 2 do
            for y = -2, 2 do
                local machine = H.entity(surface, "assembling-machine-3", { x * 3, y * 3 })
                machine.set_recipe("iron-gear-wheel")
                machines[#machines + 1] = machine
            end
        end
        local state = {}
        local view = {
            selected = first,
            surface = surface,
            tick = game.tick,
            alt = false,
            blocked = false,
            visible = function()
                return true
            end,
        }
        local preferences = H.preferences({ radius = 18, nearby_focus = "retain" })
        local function observe()
            local visible = {}
            for _, object in ipairs(rendering.get_all_objects(script.mod_name)) do
                if
                    object.surface == surface
                    and object.type == "sprite"
                    and object.sprite == "recipe/iron-gear-wheel"
                then
                    local target = assert(object.target.entity)
                    assert(not visible[target.unit_number], "Duplicate recipe on the same machine")
                    visible[target.unit_number] = true
                end
            end
            for _, machine in ipairs(machines) do
                assert(visible[machine.unit_number], "A recipe disappeared while crossing the factory")
            end
        end
        for _ = 1, 3 do
            Nearby.update(player, state, view, preferences, 1)
            view.tick = view.tick + 1
        end
        observe()
        view.selected = nil
        Nearby.update(player, state, view, preferences, 1)
        observe()
        view.tick = view.tick + 120
        Nearby.update(player, state, view, preferences, 1)
        observe()
        view.selected = second
        Nearby.update(player, state, view, preferences, 1)
        observe()
        Nearby.clear(state)
    end)

    test("live focus choices preserve gaps expire grace and release immediate selection", function()
        local player = H.player(surface)
        local anchor = H.entity(surface, "transport-belt")
        local machine = H.entity(surface, "assembling-machine-3", { 4, 0 })
        machine.set_recipe("iron-gear-wheel")
        local state = {}
        local preferences = H.preferences({ nearby_focus = "retain" })
        local view = {
            surface = surface,
            alt = false,
            blocked = false,
            visible = function()
                return true
            end,
        }
        ---@return integer
        local function observe(tick, selected)
            view.tick, view.selected = game.tick + tick, selected
            Nearby.update(player, state, view, preferences, 1)
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
        assert(observe(0, anchor) == 1)
        assert(observe(1000, nil) == 1, "Retained focus must survive a long gap")
        preferences.nearby_focus = "grace"
        assert(observe(1001, nil) == 1)
        assert(observe(1020, nil) == 1, "Grace must not expire before twenty ticks")
        assert(observe(1021, nil) == 0, "Expired grace must release the recipe")
        assert(observe(1022, anchor) == 1)
        preferences.nearby_focus = "selection"
        assert(observe(1023, nil) == 0, "Selection mode must hide immediately")
        preferences.nearby_focus = "retain"
        assert(observe(1024, nil) == 0, "Changing modes must not resurrect a cleared focus")
        assert(observe(1025, anchor) == 1)
        preferences.nearby = false
        assert(observe(1026, anchor) == 0, "Disabling nearby recipes must clear retained presentation")
    end)

    test("retained focus respects visibility panels ALT surface and anchor removal", function()
        local player = H.player(surface)
        local anchor = H.entity(surface, "transport-belt")
        local machine = H.entity(surface, "assembling-machine-3", { 4, 0 })
        machine.set_recipe("iron-gear-wheel")
        local other = H.surface()
        local state = {}
        local preferences = H.preferences({ nearby_focus = "retain" })
        local visible = true
        local view = {
            surface = surface,
            tick = game.tick,
            alt = false,
            blocked = false,
            visible = function()
                return visible
            end,
        }
        ---@return integer
        local function count()
            local result = 0
            for _, object in ipairs(rendering.get_all_objects(script.mod_name)) do
                if
                    object.surface == surface
                    and object.type == "sprite"
                    and object.sprite == "recipe/iron-gear-wheel"
                then
                    result = result + 1
                end
            end
            return result
        end
        for _, obstruct in ipairs({
            function()
                view.alt = true
            end,
            function()
                view.blocked = true
            end,
            function()
                visible = false
            end,
            function()
                view.surface = other
            end,
            function()
                anchor.destroy()
            end,
        }) do
            view.selected = anchor
            Nearby.update(player, state, view, preferences, 1)
            assert(count() == 1)
            view.selected = nil
            obstruct()
            assert(not Nearby.update(player, state, view, preferences, 1))
            assert(count() == 0, "Retained focus must not bypass a context or visibility barrier")
            view.surface, view.alt, view.blocked, visible = surface, false, false, true
            Nearby.update(player, state, view, preferences, 1)
            assert(count() == 0, "Cleared focus must wait for another valid selection")
        end
        H.destroy_surface(other)
    end)
end)
