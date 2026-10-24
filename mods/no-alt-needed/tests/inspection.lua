local H = require("tests.helpers")
local Inspect = require("scripts.inspect")
local Presentation = require("scripts.presentation")

local function detail(snapshot, key)
    for _, line in ipairs(snapshot.details) do
        if line[1] == "no-alt-needed." .. key then
            return line
        end
    end
    return nil
end

local function has_parameter(snapshot, field, value)
    for _, line in ipairs(snapshot.details) do
        if
            line[1] == "no-alt-needed.parameter"
            and type(line[3]) == "table"
            and line[3][1] == "no-alt-needed.field-" .. field
        then
            local shown = line[4]
            if type(value) == "boolean" then
                if type(shown) == "table" and shown[1] == "no-alt-needed." .. tostring(value) then
                    return true
                end
            elseif shown == value then
                return true
            end
        end
    end
    return false
end

describe("exact inspection", function()
    ---@type LuaSurface
    local surface
    before_each(function()
        surface = H.surface()
    end)
    after_each(function()
        H.destroy_surface(surface)
    end)

    test("recipe identity is not its first product", function()
        local machine = H.entity(surface, "assembling-machine-3")
        machine.set_recipe("no-alt-needed-test-gears-a")
        local first = assert(Inspect.recipe(machine))
        machine.set_recipe("no-alt-needed-test-gears-b")
        local second = assert(Inspect.recipe(machine))
        assert(first.name ~= second.name and first.name ~= "iron-gear-wheel")
        assert(second.name == "no-alt-needed-test-gears-b" and second.quality == "normal")
        machine.set_recipe(nil)
        assert(Inspect.recipe(machine) == nil)
    end)

    test("recipe rendering preserves resolved native size and shift", function()
        local player = H.player(surface)
        for index, name in ipairs({ "assembling-machine-3", "no-alt-needed-test-farm-10" }) do
            for ghost_index, ghost in ipairs({ false, true }) do
                local position = { index * 16, ghost_index * 16 }
                local entity = ghost and H.entity(surface, "entity-ghost", position, { inner_name = name })
                    or H.entity(surface, name, position)
                entity.set_recipe("iron-gear-wheel")
                local specification = Inspect.prototype(entity).icon_draw_specification
                ---@type NoAltNeededRenderState
                local state = {}
                Presentation.recipe(player, entity, Inspect.recipe(entity), state)
                local found = false
                for _, object in ipairs(assert(state.objects)) do
                    if object.type == "sprite" and object.sprite == "recipe/iron-gear-wheel" then
                        found = true
                        assert(
                            object.x_scale == specification.scale * 0.9 and object.y_scale == specification.scale * 0.9,
                            "Hover must retain the native ALT icon fill at the resolved prototype scale"
                        )
                        local offset, shift = assert(object.target.offset), specification.shift
                        assert((offset[1] or offset.x) == (shift[1] or shift.x))
                        assert((offset[2] or offset.y) == (shift[2] or shift.y))
                    end
                end
                assert(found, "The configured recipe must be visible on both machines and ghosts")
                Presentation.clear(state, player)
            end
        end
    end)

    test("ghost recipe and requested modules retain separate quality", function()
        local ghost = H.entity(surface, "entity-ghost", { 0, 0 }, { inner_name = "assembling-machine-3" })
        ghost.set_recipe("iron-gear-wheel")
        local quality = prototypes.quality.rare and "rare" or "normal"
        ghost.insert_plan = {
            {
                id = { name = "speed-module", quality = quality },
                items = { in_inventory = { { inventory = defines.inventory.crafter_modules, stack = 1, count = 1 } } },
            },
        }
        local snapshot = assert(Inspect.snapshot(ghost, H.preferences(), false))
        assert(assert(snapshot.recipe).name == "iron-gear-wheel")
        local requested = assert(H.group(snapshot, "module-requests"))
        assert(
            requested.entries[1].slot == 2 and requested.entries[1].quality == quality and requested.entries[1].request
        )
    end)

    test("module ingredients are not mislabelled as installation requests", function()
        local ghost = H.entity(surface, "entity-ghost", { 0, 0 }, { inner_name = "assembling-machine-3" })
        ghost.set_recipe("no-alt-needed-test-module-input")
        ghost.insert_plan = {
            {
                id = { name = "speed-module", quality = "normal" },
                items = {
                    in_inventory = {
                        { inventory = defines.inventory.crafter_input, stack = 0, count = 1 },
                        { inventory = defines.inventory.crafter_modules, stack = 1, count = 1 },
                    },
                },
            },
        }
        local snapshot = assert(Inspect.snapshot(ghost, H.preferences(), false))
        local requested = assert(H.group(snapshot, "module-requests"))
        assert(#requested.entries == 1, "Only installation requests belong in the module grid")
        assert(requested.entries[1].slot == 2 and requested.entries[1].inventory == defines.inventory.crafter_modules)
    end)

    test("large native module grids stay inside their machine regions", function()
        for index, slots in ipairs({ 10, 20, 30, 40 }) do
            local machine = H.entity(surface, "no-alt-needed-test-farm-" .. slots, { (index - 2) * 12, 12 })
            machine.set_recipe("iron-gear-wheel")
            local inventory = assert(machine.get_module_inventory())
            assert(#inventory == slots)
            for slot = 1, slots do
                inventory[slot].set_stack({ name = "speed-module", count = 1 })
            end
            local snapshot = assert(Inspect.snapshot(machine, H.preferences(), false))
            local group = assert(H.group(snapshot, "modules"))
            assert(#group.entries == slots)
            local geometry = Presentation.geometry(machine, snapshot)
            local checked_modules = false
            for _, layout in ipairs(geometry.groups) do
                if layout.group == group then
                    checked_modules = true
                    assert(
                        layout.group.bounded and not layout.overflow,
                        "The module grid must remain readable inside this large machine"
                    )
                    assert(layout.left >= geometry.box.left - 0.001)
                    assert(layout.left + layout.columns * layout.cell <= geometry.box.right + 0.001)
                    assert(layout.top >= geometry.box.top - 0.001)
                    assert(layout.top + layout.rows * layout.cell <= geometry.box.bottom + 0.001)
                    assert(layout.icon_size == 0.5, "A fitting native module grid must keep its authored icon scale")
                end
            end
            assert(checked_modules, "Module contents must have a visible layout")
        end
    end)

    test("lab contents preserve meaningful empty slots", function()
        local lab = H.entity(surface, "lab")
        local inventory = assert(lab.get_inventory(defines.inventory.lab_input))
        local inputs = assert(lab.prototype.lab_inputs)
        assert(inputs[3], "This native lab fixture needs at least three science slots")
        assert(inventory[1].set_stack({ name = assert(inputs[1]), count = 7 }))
        assert(inventory[3].set_stack({ name = inputs[3], count = 9 }))
        local contents = assert(H.group(Inspect.snapshot(lab, H.preferences(), false), "lab_input"))
        assert(contents.preserve_slots and #contents.entries == 2)
        assert(contents.entries[1].slot == 1 and contents.entries[2].slot == 3)
    end)

    test("storage contents and requested filters are not conflated", function()
        local chest = H.entity(surface, "steel-chest")
        chest.insert({ name = "iron-plate", count = 17 })
        local contents = assert(H.group(Inspect.snapshot(chest, H.preferences(), false), "chest"))
        assert(
            contents.entries[1].name == "iron-plate"
                and contents.entries[1].count == 17
                and not contents.entries[1].filter
        )
        local ghost = H.entity(surface, "entity-ghost", { 4, 0 }, { inner_name = "cargo-wagon" })
        ghost.set_inventory_filter(
            defines.inventory.cargo_wagon,
            3,
            { name = "copper-plate", quality = "normal", comparator = "=" }
        )
        local filtered = assert(H.group(Inspect.snapshot(ghost, H.preferences(), false), "cargo_wagon-filters"))
        assert(
            filtered.entries[1].slot == 3 and filtered.entries[1].name == "copper-plate" and filtered.entries[1].filter
        )
    end)

    test("resolved enlarged storage is not module-clamped", function()
        local ordinary = H.entity(surface, "steel-chest")
        local enlarged = H.entity(surface, "no-alt-needed-test-enlarged-storage", { 3, 0 })
        ordinary.insert({ name = "iron-plate", count = 1 })
        enlarged.insert({ name = "iron-plate", count = 1 })
        local ordinary_layout =
            assert(Presentation.geometry(ordinary, Inspect.snapshot(ordinary, H.preferences(), false)).groups[1])
        local layout =
            assert(Presentation.geometry(enlarged, Inspect.snapshot(enlarged, H.preferences(), false)).groups[1])
        assert(layout.cell > ordinary_layout.cell and not layout.group.bounded)
        assert(layout.icon_size == 2)
        assert(
            layout.left + layout.cell / 2 == 0.25 and layout.top + layout.cell / 2 == -1.25,
            "Single storage contents must respect the resolved ALT shift"
        )
        enlarged.insert({ name = "copper-plate", count = 1 })
        enlarged.insert({ name = "coal", count = 1 })
        local many =
            assert(Presentation.geometry(enlarged, Inspect.snapshot(enlarged, H.preferences(), false)).groups[1])
        assert(
            many.icon_size == 1.5 and many.columns == 2 and many.rows == 2,
            "Multiple storage contents must use the native many-item scale and compact grid"
        )
    end)

    test("inserter blacklist and quality filters remain distinct", function()
        local inserter = H.entity(surface, "inserter")
        inserter.use_filters = true
        inserter.inserter_filter_mode = "blacklist"
        inserter.set_filter(inserter.filter_slot_count, { name = "iron-plate", quality = "normal", comparator = ">=" })
        local snapshot = assert(Inspect.snapshot(inserter, H.preferences(), false))
        local filtered = assert(H.group(snapshot, "filters"))
        assert(snapshot.filter_mode == "blacklist")
        assert(filtered.entries[1].quality == "normal" and filtered.entries[1].comparator == "≥")
        local player = H.player(surface)
        local state = {}
        Presentation.update(player, inserter, snapshot, state, true)
        local blacklist, comparison = false, false
        for _, object in ipairs(state.objects) do
            blacklist = blacklist or (object.type == "sprite" and object.sprite == "utility/filter_blacklist")
            comparison = comparison or (object.type == "text" and object.text == "≥")
        end
        assert(blacklist and comparison, "Decluttering must preserve blacklist and non-equality semantics")
        inserter.inserter_filter_mode = "whitelist"
        inserter.set_filter(inserter.filter_slot_count, { name = "iron-plate", quality = "normal", comparator = "=" })
        Presentation.update(player, inserter, Inspect.snapshot(inserter, H.preferences(), false), state, true)
        local item = false
        for _, object in ipairs(state.objects) do
            assert(
                object.type ~= "text" and object.type ~= "rectangle",
                "Ordinary filters need no extra labels or frame"
            )
            if object.type == "sprite" then
                assert(object.sprite ~= "utility/filter_blacklist", "Changing filter mode must remove its old badge")
                item = item or object.sprite == "item/iron-plate"
            end
        end
        assert(item, "The configured filter itself must remain visible")
        Presentation.clear(state, player)
    end)

    test("splitter filters follow output lanes through rotation and priority changes", function()
        local player = H.player(surface)
        local directions =
            { defines.direction.north, defines.direction.east, defines.direction.south, defines.direction.west }
        local lanes = {
            [defines.direction.north] = { { -0.5, 0 }, { 0.5, 0 } },
            [defines.direction.east] = { { 0, -0.5 }, { 0, 0.5 } },
            [defines.direction.south] = { { 0.5, 0 }, { -0.5, 0 } },
            [defines.direction.west] = { { 0, 0.5 }, { 0, -0.5 } },
        }
        for index, ghost in ipairs({ false, true }) do
            for placement, direction in ipairs(directions) do
                local options = { direction = direction, inner_name = ghost and "splitter" or nil }
                local splitter =
                    H.entity(surface, ghost and "entity-ghost" or "splitter", { index * 4, placement * 4 }, options)
                assert(splitter.direction == direction, "The fixture must start in the requested orientation")
                splitter.splitter_input_priority = "left"
                splitter.splitter_filter = { name = "iron-plate", quality = "normal" }
                local specification = Inspect.prototype(splitter).icon_draw_specification
                local shift = specification.shift
                local shift_x, shift_y = assert(shift.x or shift[1]), assert(shift.y or shift[2])
                local state = {}
                for rotation = 1, 2 do
                    if rotation == 2 then
                        assert(splitter.rotate(), "The fixture must perform a native player-style rotation")
                    end
                    for side, priority in ipairs({ "left", "right" }) do
                        splitter.splitter_output_priority = priority
                        local input_priority = splitter.splitter_input_priority
                        Presentation.update(
                            player,
                            splitter,
                            Inspect.snapshot(splitter, H.preferences(), false),
                            state,
                            true
                        )
                        local count = 0
                        for _, object in ipairs(state.objects) do
                            if object.type == "sprite" and object.sprite == "item/iron-plate" then
                                count = count + 1
                                local target = object.target
                                local offset = assert(target.offset)
                                local expected = assert(lanes[splitter.direction][side])
                                assert(target.entity == splitter)
                                assert(
                                    math.abs((offset.x or offset[1]) - expected[1] - shift_x) < 0.000001
                                        and math.abs((offset.y or offset[2]) - expected[2] - shift_y) < 0.000001,
                                    string.format(
                                        "Wrong output lane: ghost=%s direction=%d requested=%s actual=%s "
                                            .. "offset=(%.6f,%.6f) expected=(%.6f,%.6f)",
                                        tostring(ghost),
                                        splitter.direction,
                                        priority,
                                        splitter.splitter_output_priority,
                                        offset.x or offset[1],
                                        offset.y or offset[2],
                                        expected[1] + shift_x,
                                        expected[2] + shift_y
                                    )
                                )
                                assert(math.abs(object.x_scale - specification.scale * 0.9) < 0.000001)
                            end
                        end
                        assert(count == 1, "Only the configured output gets a filter icon")
                        assert(
                            splitter.splitter_input_priority == input_priority
                                and splitter.splitter_output_priority == priority
                        )
                    end
                end
                splitter.splitter_filter = nil
                Presentation.update(player, splitter, Inspect.snapshot(splitter, H.preferences(), false), state, true)
                for _, object in ipairs(state.objects) do
                    assert(
                        object.type ~= "sprite" or object.sprite ~= "item/iron-plate",
                        "Cleared filter left a stale icon"
                    )
                end
                Presentation.clear(state, player)
            end
        end
    end)

    test("combinator operators signals and network choices are retained", function()
        local combinator = H.entity(surface, "arithmetic-combinator")
        local quality = prototypes.quality.rare and "rare" or "normal"
        local arithmetic = assert(combinator.get_or_create_control_behavior()) --[[@as LuaArithmeticCombinatorControlBehavior]]
        arithmetic.parameters = {
            first_signal = { type = "item", name = "iron-plate", quality = quality },
            first_signal_networks = { red = true, green = false },
            second_constant = 7,
            operation = "+",
            output_signal = { type = "virtual", name = "signal-A" },
        }
        local snapshot = assert(Inspect.snapshot(combinator, H.preferences(), false))
        assert(snapshot.operator == "+")
        assert(has_parameter(snapshot, "second_constant", "7"))
        assert(has_parameter(snapshot, "red", true) and has_parameter(snapshot, "green", false))
        local expected_signal = quality == "rare" and "[img=item/iron-plate][img=quality/rare]"
            or "[img=item/iron-plate]"
        assert(has_parameter(snapshot, "first_signal", expected_signal))
        assert(has_parameter(snapshot, "output_signal", "[img=virtual-signal/signal-A]"))
        local decider = H.entity(surface, "decider-combinator", { 4, 0 })
        local control = assert(decider.get_or_create_control_behavior()) --[[@as LuaDeciderCombinatorControlBehavior]]
        control.parameters = {
            conditions = { { first_signal = { type = "item", name = "iron-plate" }, comparator = ">", constant = 4 } },
            outputs = {
                { signal = { type = "virtual", name = "signal-A" }, copy_count_from_input = false, constant = 3 },
            },
            else_outputs = {},
        }
        local decision = assert(Inspect.snapshot(decider, H.preferences(), false))
        assert(has_parameter(decision, "comparator", ">"))
        assert(has_parameter(decision, "constant", "4") and has_parameter(decision, "constant", "3"))
        assert(has_parameter(decision, "copy_count_from_input", false))
    end)

    test("constant sections and selector operations preserve configured signals", function()
        local constant = H.entity(surface, "constant-combinator")
        local behavior = assert(constant.get_or_create_control_behavior()) --[[@as LuaConstantCombinatorControlBehavior]]
        behavior.enabled = false
        local section = assert(behavior.add_section("Inspection fixture"))
        section.multiplier, section.active = 2, false
        section.set_slot(1, { value = { type = "virtual", name = "signal-A", quality = "normal" }, min = -7 })
        local snapshot = assert(Inspect.snapshot(constant, H.preferences(), false))
        assert(detail(snapshot, "enabled")[2][1] == "no-alt-needed.false")
        local found = false
        for _, line in ipairs(snapshot.details) do
            if line[1] == "no-alt-needed.section" and line[3] == "Inspection fixture" then
                assert(line[4] == 2 and assert(line[5])[1] == "no-alt-needed.false")
                found = true
            end
        end
        assert(found, "Named disabled sections must remain inspectable")
        local signal = assert(detail(snapshot, "signal-count"))
        assert(signal[3] == -7, "Negative constant signal amounts must remain visible")
        local selector = H.entity(surface, "selector-combinator", { 4, 0 })
        local selection = assert(selector.get_or_create_control_behavior()) --[[@as LuaSelectorCombinatorControlBehavior]]
        selection.parameters = { operation = "select", select_max = false, index_constant = 3, index_comparator = ">=" }
        local selected = assert(Inspect.snapshot(selector, H.preferences(), false))
        assert(selected.operator == "select")
        assert(has_parameter(selected, "select_max", false) and has_parameter(selected, "index_constant", "3"))
        selection.parameters = { operation = "random", random_update_interval = 90 }
        local random = assert(Inspect.snapshot(selector, H.preferences(), false))
        assert(random.operator == "random" and has_parameter(random, "random_update_interval", "90"))
    end)

    test("fluid filters and actual amounts have different roles", function()
        local pump = H.entity(surface, "pump")
        assert(pump.set_fluid_filter(1, { fluid = "water" }))
        local empty = assert(Inspect.snapshot(pump, H.preferences(), false))
        assert(H.group(empty, "fluid-filters").entries[1].name == "water" and not H.group(empty, "fluids"))
        pump.set_fluid(1, { name = "water", amount = 30, temperature = 15 })
        local filled = assert(Inspect.snapshot(pump, H.preferences(), false))
        local contents = H.group(filled, "fluids").entries[1]
        assert(contents.name == "water" and contents.count == 30)
        assert(H.group(filled, "fluid-filters").entries[1].name == "water")
    end)

    test("ammunition icons do not depend on optional counts", function()
        local turret = H.entity(surface, "gun-turret")
        turret.insert({ name = "firearm-magazine", count = 2 })
        local magazine = assert(turret.get_inventory(defines.inventory.turret_ammo))[1]
        magazine.ammo = 3
        local ordinary = assert(Inspect.snapshot(turret, H.preferences(), false))
        assert(H.group(ordinary, "turret_ammo").entries[1].name == "firearm-magazine")
        assert(not detail(ordinary, "ammunition"))
        local counted = assert(Inspect.snapshot(turret, H.preferences({ ammo_counts = "normal" }), false))
        assert(detail(counted, "ammunition")[2] == assert(magazine.prototype.magazine_size) + 3)
        assert(H.group(counted, "turret_ammo").entries[1].name == "firearm-magazine")
        assert(H.group(Inspect.snapshot(turret, H.preferences({ ammo_counts = "always" }), true), "turret_ammo") == nil)
    end)

    test("robot cargo and repair inventories remain separate", function()
        local robot = H.entity(surface, "construction-robot")
        assert(robot.get_inventory(defines.inventory.robot_cargo)).insert({ name = "iron-plate", count = 2 })
        assert(robot.get_inventory(defines.inventory.robot_repair)).insert({ name = "repair-pack", count = 1 })
        local snapshot = assert(Inspect.snapshot(robot, H.preferences(), false))
        local cargo = H.group(snapshot, "robot_cargo").entries[1]
        local repair = H.group(snapshot, "robot_repair").entries[1]
        assert(cargo.name == "iron-plate" and cargo.count == 2)
        assert(repair.name == "repair-pack" and repair.count == 1)
    end)

    test("native suppression and ALT prevent duplicate ordinary layers", function()
        local hidden = H.entity(surface, "no-alt-needed-test-hidden-info")
        hidden.set_recipe("iron-gear-wheel")
        assert(Inspect.snapshot(hidden, H.preferences(), false) == nil)
        local quiet = H.entity(surface, "no-alt-needed-test-no-recipe-icon", { 4, 0 })
        quiet.set_recipe("iron-gear-wheel")
        assert(Inspect.recipe(quiet) == nil)
        local normal = H.entity(surface, "assembling-machine-3", { 8, 0 })
        normal.set_recipe("iron-gear-wheel")
        local alt = assert(Inspect.snapshot(normal, H.preferences(), true))
        assert(not alt.recipe and #alt.groups == 0 and #alt.details == 0)
    end)

    test("accumulator charge remains independent of ordinary hover", function()
        local accumulator = H.entity(surface, "accumulator")
        accumulator.energy = assert(accumulator.electric_buffer_size) / 2
        local disabled = assert(Inspect.snapshot(accumulator, H.preferences(), false))
        local enabled =
            assert(Inspect.snapshot(accumulator, H.preferences({ hover = false, electricity = "normal" }), false))
        assert(disabled.charge == nil and math.abs(assert(enabled.charge) - 0.5) < 0.000001)
        assert(assert(Inspect.snapshot(accumulator, H.preferences({ electricity = "normal" }), true)).charge == nil)
        assert(assert(Inspect.snapshot(accumulator, H.preferences({ electricity = "always" }), true)).charge)
    end)

    test("electrical information reports real network power in watts", function()
        H.entity(surface, "no-alt-needed-test-power-source", { -2, 0 })
        H.entity(surface, "no-alt-needed-test-power-load", { 2, 0 })
        local pole = H.entity(surface, "substation", { 0, 0 })
        after_ticks(60, function()
            local snapshot =
                assert(Inspect.snapshot(pole, H.preferences({ hover = false, electricity = "normal" }), false))
            local power = assert(snapshot.electricity, "Connected native network must be inspectable")
            assert(math.abs(power.production - 1000000) < 1, "One-megawatt source was reported in the wrong units")
            assert(math.abs(power.demand - 200000) < 1, "Two-hundred-kilowatt demand was reported in the wrong units")
            assert(math.abs(power.satisfaction - 1) < 0.000001)
            local disabled = assert(Inspect.snapshot(pole, H.preferences(), false))
            assert(disabled.electricity == nil)
            local alt = assert(Inspect.snapshot(pole, H.preferences({ electricity = "normal" }), true))
            assert(alt.electricity == nil)
        end)
    end)

    test("resource icons expose native extracted items and fluids", function()
        H.entity(surface, "no-alt-needed-test-ore", { 0, 0 }, { amount = 10000 })
        H.entity(surface, "no-alt-needed-test-oil", { 12, 0 }, { amount = 100000 })
        local drill = H.entity(surface, "no-alt-needed-test-drill", { 0, 0 })
        local pumpjack = H.entity(surface, "no-alt-needed-test-pumpjack", { 12, 0 })
        after_ticks(30, function()
            local ore = assert(
                H.group(
                    Inspect.snapshot(drill, H.preferences({ hover = false, resources = "normal" }), false),
                    "resources"
                )
            )
            assert(ore.entries[1].name == "iron-ore" and ore.entries[1].type == "item")
            local oil = assert(
                H.group(
                    Inspect.snapshot(pumpjack, H.preferences({ hover = false, resources = "always" }), true),
                    "resources"
                )
            )
            assert(oil.entries[1].name == "crude-oil" and oil.entries[1].type == "fluid")
            assert(not H.group(Inspect.snapshot(drill, H.preferences(), false), "resources"))
            assert(not H.group(Inspect.snapshot(drill, H.preferences({ resources = "normal" }), true), "resources"))
        end)
    end)

    test("flamethrower fuel remains available without ordinary hover", function()
        local turret = H.entity(surface, "flamethrower-turret")
        turret.set_fluid(1, { name = "light-oil", amount = 25 })
        local normal = assert(
            H.group(
                Inspect.snapshot(turret, H.preferences({ hover = false, resources = "normal" }), false),
                "resources"
            )
        )
        assert(normal.entries[1].name == "light-oil" and normal.entries[1].type == "fluid")
        local alt =
            assert(H.group(Inspect.snapshot(turret, H.preferences({ resources = "always" }), true), "resources"))
        assert(alt.entries[1].name == "light-oil")
        local ordinary = assert(Inspect.snapshot(turret, H.preferences({ resources = "normal" }), false))
        assert(H.group(ordinary, "fluids").entries[1].name == "light-oil")
        assert(not H.group(ordinary, "resources"), "The same fuel icon must not be drawn twice")
    end)

    if script.active_mods["space-age"] then
        test("Space Age collection cargo seeds and targeting are retained", function()
            local collector = H.entity(surface, "asteroid-collector")
            collector.set_filter(1, "metallic-asteroid-chunk")
            local filtered = H.group(Inspect.snapshot(collector, H.preferences(), false), "filters")
            assert(filtered and filtered.entries[1].type == "asteroid-chunk")
            local pod = H.entity(surface, "cargo-pod", { 8, 0 })
            assert(pod.get_inventory(defines.inventory.cargo_unit)).insert({ name = "iron-plate", count = 6 })
            local cargo = assert(H.group(Inspect.snapshot(pod, H.preferences(), false), "cargo_unit"))
            assert(cargo.entries[1].name == "iron-plate" and cargo.entries[1].count == 6)
            local turret = H.entity(surface, "gun-turret", { 16, 0 })
            turret.set_priority_target(1, "small-biter")
            local targets = assert(H.group(Inspect.snapshot(turret, H.preferences(), false), "targets"))
            assert(targets.entries[1].name == "small-biter" and targets.entries[1].type == "entity")
            local tower = H.entity(surface, "agricultural-tower", { 24, 0 })
            assert(tower.get_inventory(defines.inventory.agricultural_tower_input)).insert({
                name = "yumako-seed",
                count = 1,
            })
            local seeds = assert(
                H.group(
                    Inspect.snapshot(tower, H.preferences({ hover = false, resources = "normal" }), false),
                    "resources"
                )
            )
            assert(seeds.entries[1].name == "yumako-seed" and seeds.entries[1].quality == "normal")
        end)
    end
end)
