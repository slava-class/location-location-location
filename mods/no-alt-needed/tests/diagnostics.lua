local H = require("tests.helpers")
local Capacity = require("scripts.capacity")
local Diagnostics = require("scripts.connection-diagnostics")
local Warnings = require("scripts.warnings")
local Capabilities = require("scripts.capabilities")

---@type LuaSurface
local surface
---@type LuaPlayer
local player
---@type LuaForce
local force
---@type table
local original
---@type table
local state
---@type table
local capacity
---@type NoAltNeededPreferences
local options
---@type table
local capabilities
local function view(selected, tick)
    return {
        selected = selected,
        surface = surface,
        position = player.position,
        tick = tick or game.tick,
        alt = true,
        blocked = false,
        visible = function(entity)
            return entity.valid and entity.force == player.force and entity.surface == surface
        end,
    }
end
local function diagnose(entity)
    local pickup, drop = Diagnostics.endpoints(entity)
    return Diagnostics.snapshot({ entity = entity, pickup = pickup, drop = drop }, options, true, force)
end
---@param complete fun()
local function run(ticks, selected, complete)
    async(ticks + 180)
    local remaining = ticks
    local function step()
        Warnings.update(player, state, view(selected), options, capabilities, 0)
        assert(
            state.work.queries <= 1 and state.work.discoveries <= 16 and state.work.snapshots <= 9,
            "Warning work exceeded its per-tick limits"
        )
        local scan = state.scan
        ---@cast scan { cell: integer, pending_index: integer }?
        local cell, pending_index = scan and scan.cell, scan and scan.pending_index
        Warnings.update(player, state, view(selected), options, capabilities, 0)
        if scan then
            assert(
                scan.cell == cell and scan.pending_index == pending_index,
                "Repeated same-tick notifications must not spend another discovery budget"
            )
        end
        remaining = remaining - 1
        if remaining == 0 then
            complete()
            done()
        else
            after_ticks(1, step)
        end
    end
    after_ticks(1, step)
end

describe("capacity and connections", function()
    before_each(function()
        surface = H.surface()
        player = assert(game.get_player(1))
        force = player.force --[[@as LuaForce]]
        original = {
            surface = player.surface,
            position = player.position,
            opened = player.opened,
            hand = force.inserter_stack_size_bonus,
            belt = force.belt_stack_size_bonus,
        }
        H.player(surface)
        player.opened = nil
        H.entity(surface, "no-alt-needed-test-radar", { 40, 40 })
        state, capacity = {}, {}
        options = H.preferences({ warnings = "always", warning_fluids = "full" })
        capabilities = Capabilities.read()
    end)
    after_each(function()
        Warnings.clear(state)
        Capacity.clear(capacity)
        force.inserter_stack_size_bonus = original.hand
        force.belt_stack_size_bonus = original.belt
        player.selected = nil
        player.teleport(original.position, original.surface)
        player.opened = original.opened
        H.destroy_surface(surface)
    end)

    test("capacity follows native transfers research hand limits and ghosts", function()
        local inserter = H.entity(surface, "no-alt-needed-test-inserter")
        local input = H.entity(surface, "steel-chest", inserter.pickup_position)
        local output = H.entity(surface, "steel-chest", inserter.drop_position)
        input.insert({ name = "iron-plate", count = 1000 })
        force.inserter_stack_size_bonus = 0
        local base = Capacity.snapshot(inserter, capacity, capabilities)
        assert(base.value and not base.reason and not base.approximate)
        force.inserter_stack_size_bonus = 3
        local researched = Capacity.snapshot(inserter, capacity, capabilities)
        assert(researched.value > base.value * 3.5, "Hand-size research must change configured capacity")
        inserter.inserter_stack_size_override = 2
        local limited = Capacity.snapshot(inserter, capacity, capabilities)
        local limited_rate = assert(limited.value)
        assert(math.abs(limited_rate / base.value - 2) < 0.01)
        local ghost = H.entity(surface, "entity-ghost", { 8, 0 }, { inner_name = inserter.name })
        local pickup = inserter.pickup_position --[[@as {x:number,y:number}]]
        local drop = inserter.drop_position --[[@as {x:number,y:number}]]
        H.entity(surface, "steel-chest", { 8 + pickup.x, pickup.y })
        H.entity(surface, "steel-chest", { 8 + drop.x, drop.y })
        assert(
            Capacity.snapshot(ghost, {}, capabilities).value == researched.value,
            "Ghost must retain configured capacity"
        )
        async(900)
        after_ticks(60, function()
            local before = output.get_item_count("iron-plate")
            after_ticks(600, function()
                local transferred = output.get_item_count("iron-plate") - before
                assert(
                    math.abs(transferred - limited_rate * 10) <= 4,
                    "Native transfer count differs from the displayed capacity: "
                        .. transferred
                        .. " vs "
                        .. limited_rate * 10
                )
                done()
            end)
        end)
    end)

    test("custom reach quality and unsupported belt stacks stay explicit", function()
        local inserter = H.entity(surface, "no-alt-needed-test-inserter")
        inserter.pickup_position = { 0, 3 }
        inserter.drop_position = { 0, -3 }
        H.entity(surface, "steel-chest", inserter.pickup_position)
        H.entity(surface, "steel-chest", inserter.drop_position)
        local normal = Capacity.snapshot(inserter, capacity, capabilities)
        assert(normal.value and normal.value > 0 and not normal.reason)
        local legendary = prototypes.quality["legendary"] --[[@as LuaQualityPrototype?]]
        if legendary then
            local quality = H.entity(surface, "no-alt-needed-test-inserter", { 10, 0 }, { quality = "legendary" })
            quality.pickup_position, quality.drop_position = { 10, 3 }, { 10, -3 }
            H.entity(surface, "steel-chest", quality.pickup_position)
            H.entity(surface, "steel-chest", quality.drop_position)
            assert(Capacity.snapshot(quality, {}, capabilities).value > normal.value, "Quality must affect capacity")
        end
        local belt_inserter = H.entity(surface, "no-alt-needed-test-inserter", { -10, 0 })
        local belt = H.entity(surface, "transport-belt", belt_inserter.pickup_position)
        H.entity(surface, "steel-chest", belt_inserter.drop_position)
        force.belt_stack_size_bonus = 3
        local line = belt.get_transport_line(defines.transport_line.left_line)
        assert(line.insert_at(0.5, { name = "iron-plate", count = 3 }, 3))
        assert(line[1].count == 3, "Fixture must contain a real native belt stack")
        assert(Capacity.snapshot(belt_inserter, {}, capabilities).reason == "stacking")
        assert(
            not Capacity.snapshot(inserter, capacity, capabilities).reason,
            "Stacking must not disable inventory-to-inventory capacity"
        )
    end)

    test("profile inserters match real inventory transfers", function()
        local fixtures = {}
        for index, name in ipairs({
            "burner-inserter",
            "inserter",
            "fast-inserter",
            "long-handed-inserter",
            "bulk-inserter",
        }) do
            local x = (index - 3) * 20
            local inserter = H.entity(surface, name, { x, 0 })
            inserter.inserter_stack_size_override = 1
            local input = H.entity(surface, "steel-chest", inserter.pickup_position)
            local output = H.entity(surface, "steel-chest", inserter.drop_position)
            assert(input.insert({ name = "iron-plate", count = 1000 }) == 1000)
            if inserter.burner then
                assert(inserter.burner.inventory.insert({ name = "coal", count = 50 }) == 50)
            end
            H.entity(surface, "substation", { x + 4, 3 })
            local supply = H.entity(surface, "electric-energy-interface", { x + 4, 7 })
            supply.electric_buffer_size, supply.power_production, supply.energy = 1000000000, 1000000000, 1000000000
            fixtures[#fixtures + 1] = { inserter = inserter, output = output }
        end
        async(900)
        after_ticks(60, function()
            for _, fixture in ipairs(fixtures) do
                local result = Capacity.snapshot(fixture.inserter, {}, capabilities)
                assert(result.value and not result.reason and not result.approximate)
                fixture.rate = result.value
                fixture.before = fixture.output.get_item_count("iron-plate")
            end
            after_ticks(600, function()
                for _, fixture in ipairs(fixtures) do
                    local actual = fixture.output.get_item_count("iron-plate") - fixture.before
                    assert(
                        math.abs(actual - fixture.rate * 10) <= 2,
                        fixture.inserter.name
                            .. ": "
                            .. actual
                            .. " transferred vs "
                            .. fixture.rate * 10
                            .. " estimated"
                    )
                end
                done()
            end)
        end)
    end)

    test("belt geometry estimates match unobstructed native delivery", function()
        force.belt_stack_size_bonus = 0
        local fixtures = {}
        for index, shape in ipairs({ "straight", "crosswise", "curve", "underground" }) do
            local x = (index - 2.5) * 20
            local inserter = H.entity(surface, "no-alt-needed-test-inserter", { x, 20 })
            inserter.inserter_stack_size_override = 1
            local input = H.entity(surface, "steel-chest", inserter.pickup_position)
            assert(input.insert({ name = "iron-plate", count = 1000 }) == 1000)
            local drop = inserter.drop_position --[[@as {x:number,y:number}]]
            local belt = H.entity(surface, shape == "underground" and "underground-belt" or "transport-belt", drop, {
                direction = shape == "crosswise" and defines.direction.east or defines.direction.north,
                type = shape == "underground" and "input" or nil,
            })
            if shape == "curve" then
                H.entity(surface, "transport-belt", { drop.x - 1, drop.y }, { direction = defines.direction.east })
                H.entity(surface, "transport-belt", { drop.x, drop.y - 1 }, { direction = defines.direction.north })
            elseif shape == "underground" then
                H.entity(surface, "underground-belt", { drop.x, drop.y - 4 }, {
                    direction = defines.direction.north,
                    type = "output",
                })
            end
            fixtures[#fixtures + 1] = { inserter = inserter, belt = belt, shape = shape, count = 0 }
        end
        local function drain(fixture)
            local count = 0
            for index = 1, fixture.belt.get_max_transport_line_index() do
                local line = fixture.belt.get_transport_line(index)
                if line.valid then
                    count = count + line.get_item_count("iron-plate")
                    line.clear()
                end
            end
            return count
        end
        async(900)
        after_ticks(60, function()
            for _, fixture in ipairs(fixtures) do
                assert(fixture.inserter.drop_target == fixture.belt, "Fixture must exercise a native belt endpoint")
                if fixture.shape == "curve" then
                    assert(fixture.belt.belt_shape ~= "straight", "Fixture must have a genuinely turned belt")
                end
                local result = Capacity.snapshot(fixture.inserter, {}, capabilities)
                if result.reason then
                    assert(result.reason == "stacking" and capabilities.stacking_loaders)
                else
                    fixture.rate = assert(result.value)
                end
                drain(fixture)
            end
            local elapsed = 0
            local function step()
                for _, fixture in ipairs(fixtures) do
                    fixture.count = fixture.count + drain(fixture)
                end
                elapsed = elapsed + 1
                if elapsed < 600 then
                    after_ticks(1, step)
                    return
                end
                for _, fixture in ipairs(fixtures) do
                    if fixture.rate then
                        assert(
                            math.abs(fixture.count - fixture.rate * 10) <= 2,
                            fixture.shape
                                .. ": "
                                .. fixture.count
                                .. " delivered vs "
                                .. fixture.rate * 10
                                .. " estimated"
                        )
                    end
                end
                done()
            end
            after_ticks(1, step)
        end)
    end)

    test("valid endpoints are independent of stock and missing endpoints refresh", function()
        local inserter = H.entity(surface, "no-alt-needed-test-inserter")
        local input = H.entity(surface, "steel-chest", inserter.pickup_position)
        local output = H.entity(surface, "steel-chest", inserter.drop_position)
        local elapsed, first = 0, nil
        async(240)
        local function step()
            elapsed = elapsed + 1
            Warnings.update(player, state, view(inserter), options, capabilities, 0)
            if elapsed == 30 then
                assert(#diagnose(inserter) == 0, "Empty but connected inventories are not failures")
                output.destroy()
            elseif elapsed == 32 then
                local missing = diagnose(inserter)
                assert(#missing == 1 and missing[1].role == "drop", helpers.table_to_json(missing))
                input.destroy()
            elseif elapsed == 34 then
                assert(#diagnose(inserter) == 2)
            elseif elapsed == 60 then
                local record = state.records[inserter.unit_number] --[[@as NoAltNeededWarningRecord]]
                local objects = assert(record.objects)
                assert(
                    #objects == 2,
                    helpers.table_to_json({
                        objects = #objects,
                        snapshot = record.snapshot,
                        completed = state.completed,
                        reach = capabilities.ground_reach,
                        resolution = player.display_resolution,
                        cells = state.scan and #state.scan.cells,
                        cell = state.scan and state.scan.cell,
                    })
                )
                first = objects[1].id
            elseif elapsed == 110 then
                assert(
                    state.records[inserter.unit_number].objects[1].id == first,
                    "Unchanged warnings must retain render objects"
                )
                H.entity(surface, "steel-chest", inserter.pickup_position)
                H.entity(surface, "steel-chest", inserter.drop_position)
            elseif elapsed == 140 then
                assert(
                    #state.records[inserter.unit_number].objects == 0,
                    "Unnotified native connection changes must clear warnings"
                )
                done()
                return
            end
            after_ticks(1, step)
        end
        after_ticks(1, step)
    end)

    test("ground handoffs survive ignored hosts and fluid drills have no item warning", function()
        after_ticks(30, function()
            local sender = H.entity(surface, "no-alt-needed-test-inserter")
            local pickup = sender.pickup_position --[[@as {x:number,y:number}]]
            local drop = sender.drop_position --[[@as {x:number,y:number}]]
            local origin = sender.position --[[@as {x:number,y:number}]]
            local receiver = H.entity(surface, "fast-inserter", {
                drop.x - (pickup.x - origin.x),
                drop.y - (pickup.y - origin.y),
            })
            H.entity(surface, "steel-chest", receiver.drop_position)
            local drill = H.entity(surface, "no-alt-needed-test-drill", { 15, 0 })
            local pumpjack = H.entity(surface, "no-alt-needed-test-pumpjack", { 25, 0 })
            local drill_markers = diagnose(drill)
            local item_outputs = 0
            for _, marker in ipairs(drill_markers) do
                if marker.role == "drop" then
                    item_outputs = item_outputs + 1
                end
            end
            assert(item_outputs == 1, "An unserved item-producing drill must warn at its output")
            for _, marker in ipairs(diagnose(pumpjack)) do
                assert(marker.role == "fluid", "Fluid-only drill has no item endpoint")
            end
            options.warning_ignored[sender.name] = true
            run(120, sender, function()
                assert(not state.records[sender.unit_number].objects, "Ignored host must not display that warning")
                assert(
                    #state.records[receiver.unit_number].snapshot == 0,
                    "A ground handoff is a legitimate connection"
                )
                options.warning_ignored = {}
                sender.destroy()
                Warnings.update(player, state, view(receiver, game.tick + 16), options, capabilities, 0)
                local markers = assert(state.records[receiver.unit_number].snapshot) --[[@as table[] ]]
                assert(
                    #markers == 1 and markers[1].role == "pickup",
                    "Destroyed handoff peer must not keep a stale connection"
                )
            end)
        end)
    end)

    test("fluid diagnostics distinguish connection obstruction and mismatch", function()
        local pump = H.entity(surface, "pump")
        assert(pump.set_fluid_filter(1, { fluid = "water" }))
        local connections = assert(pump.get_fluid_box_pipe_connections(1))
        local connection = assert(connections[1])
        local position = connection.position --[[@as {x:number,y:number}]]
        local target = connection.target_position --[[@as {x:number,y:number}]]
        local origin = pump.position --[[@as {x:number,y:number}]]
        ---@return string
        local function at_port()
            for _, marker in ipairs(diagnose(pump)) do
                if marker.x == position.x - origin.x and marker.y == position.y - origin.y then
                    return marker.status
                end
            end
            error("Expected native port diagnosis")
        end
        assert(at_port() == "missing")
        local obstruction = H.entity(surface, "steel-chest", connection.target_position)
        assert(at_port() == "obstructed")
        obstruction.destroy()
        local pipe = H.entity(surface, "pipe", connection.target_position)
        assert(at_port() == "connected")
        pipe.destroy()
        local wrong = H.entity(surface, "pump", connection.target_position, { direction = defines.direction.east })
        assert(at_port() == "fluid-obstruction")
        wrong.destroy()
        local dx = target.x - position.x
        local dy = target.y - position.y
        local incompatible = H.entity(surface, "pump", {
            target.x + dx * 0.5,
            target.y + dy * 0.5,
        })
        assert(incompatible.set_fluid_filter(1, { fluid = "crude-oil" }))
        assert(at_port() == "mismatch", helpers.table_to_json(diagnose(pump)))
    end)

    test("warning modes budgets and cleanup preserve player isolation", function()
        local inserter = H.entity(surface, "no-alt-needed-test-inserter")
        for y = -8, 8, 2 do
            for x = 4, 20, 2 do
                H.entity(surface, "no-alt-needed-test-inserter", { x, y })
            end
        end
        run(180, inserter, function()
            assert(#state.order >= 50, "Dense native scene must actually exercise discovery")
            local record = state.records[inserter.unit_number]
            local objects = assert(record.objects)
            assert(#objects == 2, "Both missing endpoints must actually render in the dense scene")
            for _, object in ipairs(objects) do
                assert(#object.players == 1 and object.players[1].index == player.index)
            end
            local context = view(inserter, game.tick + 16)
            options.warnings, context.alt = "alt", false
            assert(not Warnings.update(player, state, context, options, capabilities, 0))
            for _, object in ipairs(objects) do
                assert(not object.valid, "Disabling warnings must destroy the visible markers")
            end
            options.warnings = "hover"
            context.alt = true
            assert(Warnings.update(player, state, context, options, capabilities, 0))
            context.selected = nil
            assert(not Warnings.update(player, state, context, options, capabilities, 0))
            options.warnings, context.selected, context.blocked = "always", inserter, true
            assert(not Warnings.update(player, state, context, options, capabilities, 0))
        end)
    end)

    test("capacity label stays centred and clears independently of warnings", function()
        local inserter = H.entity(surface, "no-alt-needed-test-inserter")
        local context = view(inserter)
        assert(Capacity.update(player, capacity, context, true, capabilities, -2))
        assert(
            capacity.object.target.offset[1] == 0 and capacity.object.target.offset[2] < -2,
            helpers.table_to_json({
                actual = capacity.object.target.offset,
                expected = capacity.offset,
                zoom = player.zoom,
            })
        )
        local object = assert(capacity.object) --[[@as LuaRenderObject]]
        assert(not Capacity.update(player, capacity, context, false, capabilities))
        assert(not object.valid and next(capacity) == nil)
        local ghost = H.entity(surface, "entity-ghost", { 5, 0 }, { inner_name = inserter.name })
        Warnings.update(player, state, view(ghost), options, capabilities, 0)
        assert(not state.records[ghost.unit_number], "Ghosts must not receive fault warnings")
    end)
end)
