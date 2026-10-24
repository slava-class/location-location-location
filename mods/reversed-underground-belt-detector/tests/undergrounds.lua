describe("reversed underground warnings", function()
    local undergrounds = require("reversed_underground_belt_detector.undergrounds")
    local appearance = require("reversed_underground_belt_detector.appearance")
    local preferences = require("reversed_underground_belt_detector.underground_preferences")
    local planner = require("reversed_underground_belt_detector.warning_planner")
    local surface, player, force
    local extra_surfaces = {}
    local message = { "reversed-underground-belt-detector.warning" }
    local alert_setting = preferences.alert_setting
    local directions = {
        { defines.direction.east, 1, 0 },
        { defines.direction.south, 0, 1 },
        { defines.direction.west, -1, 0 },
        { defines.direction.north, 0, -1 },
    }
    ticks_between_tests(1)

    local function generate_alerts(enabled)
        settings.get_player_settings(player)[alert_setting] = { value = enabled }
    end

    local function set_overlay(mode)
        settings.get_player_settings(player)[preferences.overlay_setting] = { value = mode }
    end

    local function alerts(entity)
        local result = player.get_alerts({ surface = surface, type = defines.alert_type.custom })
        local found, matching = result[surface.index], {}
        for _, alert in pairs(found and found[defines.alert_type.custom] or {}) do
            if alert.target == entity and type(alert.message) == "table" and alert.message[1] == message[1] then
                matching[#matching + 1] = alert
            end
        end
        return matching
    end

    local function line(spec, reversed, origin, name, length, target)
        local direction, dx, dy = spec[1], spec[2], spec[3]
        local underground_direction = reversed and (direction + 8) % 16 or direction
        local entities = {}
        local gap = length or 4
        for index, distance in ipairs({ -1, 0, gap, gap + 1 }) do
            local underground = index == 2 or index == 3
            entities[index] = assert((target or surface).create_entity({
                name = underground and (name or "underground-belt") or "transport-belt",
                position = { origin[1] + distance * dx, origin[2] + distance * dy },
                direction = underground and underground_direction or direction,
                type = underground and ((index == 2) ~= reversed and "input" or "output") or nil,
                force = force,
                raise_built = true,
            }))
        end
        assert(entities[2].underground_belt_neighbour == entities[3], "Fixture must form a connected pair")
        return entities
    end

    local function create_mouth(x, y, direction, role, target)
        return assert((target or surface).create_entity({
            name = "underground-belt",
            position = { x, y },
            direction = direction,
            type = role,
            force = force,
            raise_built = true,
        }))
    end

    local function feed(x, y, direction, target)
        return assert((target or surface).create_entity({
            name = "transport-belt",
            position = { x, y },
            direction = direction,
            force = force,
            raise_built = true,
        }))
    end

    local function grid(count, target, columns)
        columns = columns or 8
        local rows, result = math.ceil(count / columns), {}
        for index = 0, count - 1 do
            result[#result + 1] = line(directions[1], true, {
                (index % columns) * 8 - columns * 4,
                math.floor(index / columns) * 4 - rows * 2,
            }, nil, nil, target)
        end
        return result
    end

    local function extra_surface(name)
        local target = game.create_surface(name, { width = 512, height = 256, water = 0, seed = 42 })
        extra_surfaces[#extra_surfaces + 1] = target
        target.request_to_generate_chunks({ 0, 0 }, 8)
        target.force_generate_chunk_requests()
        for _, entity in pairs(target.find_entities()) do
            entity.destroy()
        end
        local tiles = {}
        for x = -204, 204 do
            for y = -84, 84 do
                tiles[#tiles + 1] = { name = "lab-dark-1", position = { x, y } }
            end
        end
        target.set_tiles(tiles)
        return target
    end

    local function manage(entities, restore, item)
        local event = restore and defines.events.on_player_alt_selected_area or defines.events.on_player_selected_area
        undergrounds.events[event]({
            name = event,
            player_index = player.index,
            entities = entities,
            item = item or planner.name,
            surface = surface,
        })
    end

    local function acknowledged(entity)
        local warning = assert(storage.reversed_underground_belt_detector.warnings[entity.unit_number])
        assert(warning.acknowledged and not warning.sprite.visible and not warning.span and not warning.steady)
        assert(#alerts(entity) == 0, "Intentional connections must not renew map alerts")
        return warning
    end

    before_all(function()
        surface = game.create_surface("underground-warning-tests", { width = 128, height = 128, water = 0 })
        surface.request_to_generate_chunks({ 0, 0 }, 2)
        surface.force_generate_chunk_requests()
        local tiles = {}
        for x = -32, 32 do
            for y = -32, 32 do
                tiles[#tiles + 1] = { name = "lab-dark-1", position = { x, y } }
            end
        end
        surface.set_tiles(tiles)
        force = game.create_force("underground-warning-team")
    end)
    before_each(function()
        player = game.get_player(1)
        generate_alerts(true)
        player.set_controller({ type = defines.controllers.god })
        player.force = force
        player.teleport({ 0, 10 }, surface)
        player.cursor_stack.clear()
        player.clear_selected_entity()
        set_overlay("pulsing")
        force.chart(surface, { { -32, -32 }, { 32, 32 } })
    end)
    after_each(function()
        generate_alerts(false)
        player.cursor_stack.clear()
        player.teleport({ 0, 10 }, surface)
        for _, target in ipairs(extra_surfaces) do
            if target.valid then
                for _, entity in pairs(target.find_entities()) do
                    entity.destroy({ raise_destroy = true })
                end
                game.delete_surface(target)
            end
        end
        extra_surfaces = {}
        for _, entity in pairs(surface.find_entities()) do
            entity.destroy({ raise_destroy = true })
        end
        player.force = game.forces.player
    end)

    test("flags both ends of a reversed pair in all four directions, not correctly oriented pairs", function()
        local reversed, correct = {}, {}
        for index, spec in ipairs(directions) do
            reversed[index] = line(spec, true, { -16 + index * 7, -12 })
            correct[index] = line(spec, false, { -16 + index * 7, 12 })
        end
        after_ticks(61, function()
            for index = 1, 4 do
                local warnings = storage.reversed_underground_belt_detector.warnings
                local expected_orientation = ({ 0.75, 0, 0.25, 0.5 })[index]
                local input = assert(warnings[reversed[index][3].unit_number])
                local output = assert(warnings[reversed[index][2].unit_number])
                assert(#input.span == 3 and not output.span, "Each underground tile needs exactly one muted arrow")
                for step, sprite in ipairs(input.span) do
                    assert(sprite.valid and sprite.orientation == expected_orientation)
                    assert(sprite.color.a < input.sprite.color.a and sprite.x_scale < input.sprite.x_scale)
                    local target = sprite.target
                    assert(target.entity == reversed[index][3])
                    assert(target.offset[1] == -directions[index][2] * step)
                    assert(target.offset[2] == -directions[index][3] * step)
                end
                for _, endpoint in ipairs({ 2, 3 }) do
                    assert(warnings[reversed[index][endpoint].unit_number].sprite.orientation == expected_orientation)
                    assert(not warnings[correct[index][endpoint].unit_number])
                    assert(
                        #alerts(reversed[index][endpoint]) == 1,
                        "Reversed underground must have one warning per end"
                    )
                    assert(#alerts(correct[index][endpoint]) == 0, "Correct underground must not be warned")
                end
            end
        end)
    end)

    test(
        "detects reversed directions and endpoint roles from one attached surface belt in every orientation",
        function()
            local target = extra_surface("underground-role-matrix")
            -- Facing inputs are normalized by native placement into a correct pair.
            local cases = {
                { false, "input", false, "input" },
                { false, "input", true, "output" },
                { true, "output", false, "input" },
                { true, "output", true, "input" },
                { true, "output", false, "output" },
                { true, "output", true, "output" },
            }
            local connections = {}
            for row, case in ipairs(cases) do
                for column, spec in ipairs(directions) do
                    local direction, dx, dy = spec[1], spec[2], spec[3]
                    local reverse = (direction + 8) % 16
                    local x, y = -60 + column * 24, -80 + row * 20
                    local first = create_mouth(x, y, case[1] and reverse or direction, case[2], target)
                    local second =
                        create_mouth(x + 4 * dx, y + 4 * dy, case[3] and reverse or direction, case[4], target)
                    feed(x - dx, y - dy, direction, target)
                    connections[#connections + 1] = { first, second, case = row, direction = direction }
                end
            end
            after_ticks(2, function()
                local warnings = storage.reversed_underground_belt_detector.warnings
                for _, connection in ipairs(connections) do
                    for index, entity in ipairs(connection) do
                        local other = connection[3 - index]
                        local warning = assert(
                            warnings[entity.unit_number],
                            "Missing case "
                                .. connection.case
                                .. " direction "
                                .. connection.direction
                                .. " endpoint "
                                .. index
                                .. " actual "
                                .. entity.belt_to_ground_type
                                .. "/"
                                .. entity.direction
                                .. " other "
                                .. other.belt_to_ground_type
                                .. "/"
                                .. other.direction
                                .. " native "
                                .. tostring(entity.underground_belt_neighbour ~= nil)
                                .. "/"
                                .. tostring(other.underground_belt_neighbour ~= nil)
                        )
                        assert(warning.partner_id == connection[3 - index].unit_number)
                        assert(warning.sprite.orientation == entity.direction / 16, "Arrows must show actual direction")
                        if not entity.underground_belt_neighbour then
                            assert(not warning.span, "A possible connection must not pretend to have a native span")
                        end
                    end
                end
            end)
        end
    )

    test("detects the crossing layout without warning its perpendicular underground pair", function()
        local first = create_mouth(-8, 0, defines.direction.west, "output")
        local second = create_mouth(-4, 0, defines.direction.west, "output")
        local top = create_mouth(-4, -1, defines.direction.north, "output")
        local bottom = create_mouth(-4, 1, defines.direction.north, "input")
        assert(top.underground_belt_neighbour == bottom)
        feed(-9, 0, defines.direction.east)
        for y = -3, 3 do
            feed(-5, y, defines.direction.south)
            feed(-3, y, defines.direction.north)
        end
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            assert(warnings[first.unit_number] and warnings[second.unit_number])
            assert(#alerts(first) == 1 and #alerts(second) == 1)
            assert(not warnings[top.unit_number] and not warnings[bottom.unit_number])
            assert(not warnings[first.unit_number].span and not warnings[second.unit_number].span)
        end)
    end)

    test("tracks construction and removal of the evidence for an unpaired candidate", function()
        local first = create_mouth(-8, 0, defines.direction.west, "output")
        after_ticks(2, function()
            local belt = feed(-9, 0, defines.direction.east)
            after_ticks(2, function()
                assert(not storage.reversed_underground_belt_detector.warnings[first.unit_number])
                local second = create_mouth(-4, 0, defines.direction.west, "output")
                local second_id = second.unit_number
                after_ticks(2, function()
                    local warnings = storage.reversed_underground_belt_detector.warnings
                    assert(warnings[first.unit_number] and warnings[second_id])
                    belt.destroy({ raise_destroy = true })
                    after_ticks(2, function()
                        assert(not warnings[first.unit_number] and not warnings[second_id])
                        feed(-9, 0, defines.direction.east)
                        after_ticks(2, function()
                            assert(warnings[first.unit_number] and warnings[second_id])
                            second.destroy({ raise_destroy = true })
                            after_ticks(2, function()
                                assert(not warnings[first.unit_number] and not warnings[second_id])
                                assert(storage.reversed_underground_belt_detector.validation_count == 0)
                            end)
                        end)
                    end)
                end)
            end)
        end)
    end)

    test("does not infer a connection from hood-adjacent belts or mouths paired elsewhere", function()
        local back = create_mouth(-12, -8, defines.direction.east, "output")
        local other = create_mouth(-8, -8, defines.direction.west, "output")
        feed(-13, -8, defines.direction.east)
        local isolated = create_mouth(-12, 8, defines.direction.west, "output")
        feed(-13, 8, defines.direction.east)
        local paired = create_mouth(-8, 8, defines.direction.west, "output")
        local partner = create_mouth(-6, 8, defines.direction.west, "input")
        assert(paired.underground_belt_neighbour == partner)
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            for _, entity in ipairs({ back, other, isolated, paired, partner }) do
                assert(not warnings[entity.unit_number], "Adjacency must not override actual mouth or pairing geometry")
            end
        end)
    end)

    test("leaves competing possible connections unclassified", function()
        local first = create_mouth(-8, 0, defines.direction.west, "output")
        local middle = create_mouth(-5, 0, defines.direction.west, "output")
        local last = create_mouth(-2, 0, defines.direction.west, "output")
        feed(-9, 0, defines.direction.east)
        feed(-6, 0, defines.direction.east)
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            assert(
                not warnings[first.unit_number] and not warnings[middle.unit_number] and not warnings[last.unit_number]
            )
        end)
    end)

    test("relinks warnings to the new surface-fed pair and clears the former partner", function()
        local entities = line(directions[1], true, { -8, 0 })
        after_ticks(2, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            local old_span = warnings[entities[3].unit_number].span
            local replacement = create_mouth(-6, 0, defines.direction.west, "input")
            after_ticks(2, function()
                assert(entities[2].underground_belt_neighbour == replacement)
                assert(warnings[entities[2].unit_number].partner_id == replacement.unit_number)
                assert(warnings[replacement.unit_number].partner_id == entities[2].unit_number)
                assert(not warnings[entities[3].unit_number])
                for _, sprite in ipairs(old_span) do
                    assert(not sprite.valid, "The former span must not survive relinking")
                end
            end)
        end)
    end)

    test("surveys and reloads unpaired warnings and clears them after the intended connection is corrected", function()
        create_mouth(-8, 0, defines.direction.west, "output")
        create_mouth(-4, 0, defines.direction.west, "output")
        feed(-9, 0, defines.direction.east)
        undergrounds.on_configuration_changed()
        after_ticks(2, function()
            assert(table_size(storage.reversed_underground_belt_detector.warnings) == 2)
        end)
    end).after_reload_mods(function()
        surface = game.surfaces["underground-warning-tests"]
        force = game.forces["underground-warning-team"]
        player = game.get_player(1)
        local first = assert(surface.find_entity("underground-belt", { -7.5, 0.5 }))
        local second = assert(surface.find_entity("underground-belt", { -3.5, 0.5 }))
        local warnings = storage.reversed_underground_belt_detector.warnings
        assert(warnings[first.unit_number] and warnings[second.unit_number])
        first.destroy({ raise_destroy = true })
        second.destroy({ raise_destroy = true })
        local input = create_mouth(-8, 0, defines.direction.east, "input")
        local output = create_mouth(-4, 0, defines.direction.east, "output")
        assert(input.underground_belt_neighbour == output)
        after_ticks(2, function()
            assert(not next(warnings), "Correcting both role and direction must clear the possible-connection warning")
        end)
    end)

    test("requires a compatible connection and attached surface flow rather than flagging isolated mouths", function()
        local missing = line(directions[1], true, { -12, -8 })
        missing[1].destroy({ raise_destroy = true })
        missing[4].destroy({ raise_destroy = true })
        local turning = line(directions[1], true, { -12, 0 })
        turning[1].direction = defines.direction.north
        turning[4].direction = defines.direction.south
        local unpaired = line(directions[1], true, { -12, 8 })
        unpaired[3].destroy({ raise_destroy = true })
        after_ticks(61, function()
            assert(#alerts(missing[2]) == 0 and #alerts(missing[3]) == 0)
            assert(#alerts(turning[2]) == 0 and #alerts(turning[3]) == 0)
            assert(#alerts(unpaired[2]) == 0)
        end)
    end)

    test(
        "building the first exterior belt detects the pair and removing the last clears only owned warnings",
        function()
            async(240)
            local entities = line(directions[1], true, { -8, 0 })
            entities[1].destroy({ raise_destroy = true })
            entities[4].destroy({ raise_destroy = true })
            after_ticks(61, function()
                assert(#alerts(entities[2]) == 0)
                entities[4] = assert(surface.create_entity({
                    name = "transport-belt",
                    position = { -3, 0 },
                    direction = defines.direction.east,
                    force = force,
                    raise_built = true,
                }))
                after_ticks(61, function()
                    assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
                    local sprite = storage.reversed_underground_belt_detector.warnings[entities[2].unit_number].sprite
                    local span = storage.reversed_underground_belt_detector.warnings[entities[3].unit_number].span
                    player.add_custom_alert(
                        entities[2],
                        { type = "item", name = "iron-plate" },
                        "Unrelated alert",
                        true
                    )
                    entities[4].destroy({ raise_destroy = true })
                    after_ticks(61, function()
                        assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 0)
                        assert(not sprite.valid, "Resolved warnings must disappear from the world")
                        for _, object in ipairs(span) do
                            assert(not object.valid, "Resolving a warning must remove its entire underground span")
                        end
                        local remaining = player.get_alerts({
                            entity = entities[2],
                            type = defines.alert_type.custom,
                            message = "Unrelated alert",
                        })
                        assert(
                            remaining[surface.index][defines.alert_type.custom][1],
                            "Other custom alerts must survive"
                        )
                        done()
                    end)
                end)
            end)
        end
    )

    for _, action in ipairs({ "rotate exterior", "remove exterior evidence", "remove mouth" }) do
        test("clears both mouths and span promptly after " .. action, function()
            async(180)
            local entities = line(directions[1], true, { -8, 0 })
            local untouched = line(directions[1], true, { -8, 12 })
            after_ticks(61, function()
                local delay = (61 - game.tick % 60) % 60
                after_ticks(delay == 0 and 60 or delay, function()
                    local warnings = storage.reversed_underground_belt_detector.warnings
                    local left_id, right_id = entities[2].unit_number, entities[3].unit_number
                    local left, right = warnings[left_id].sprite, warnings[right_id].sprite
                    local span = warnings[right_id].span
                    if action == "rotate exterior" then
                        entities[1].direction = defines.direction.west
                        script.get_event_handler(defines.events.on_player_rotated_entity)({
                            entity = entities[1],
                            player_index = player.index,
                            tick = game.tick,
                            name = defines.events.on_player_rotated_entity,
                            previous_direction = defines.direction.east,
                        })
                    elseif action == "remove exterior evidence" then
                        entities[1].destroy({ raise_destroy = true })
                        entities[4].destroy({ raise_destroy = true })
                    elseif action == "remove mouth" then
                        entities[2].destroy({ raise_destroy = true })
                    end
                    after_ticks(2, function()
                        assert(not left.valid and not right.valid, "Both mouth warnings must clear within two ticks")
                        for _, sprite in ipairs(span) do
                            assert(not sprite.valid, "The span must clear with the mouths")
                        end
                        assert(not warnings[left_id] and not warnings[right_id])
                        assert(warnings[untouched[2].unit_number].sprite.valid, "An unrelated pair must remain flagged")
                        done()
                    end)
                end)
            end)
        end)
    end

    test("replaces saved owned messages without clearing foreign alerts", function()
        async(180)
        local entities = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
            player.add_custom_alert(entities[2], { type = "item", name = "underground-belt" }, message, true)
            player.add_custom_alert(entities[3], { type = "item", name = "iron-plate" }, "Unrelated alert", true)
            undergrounds.on_configuration_changed()
            after_ticks(61, function()
                assert(#alerts(entities[2]) == 1)
                assert(#alerts(entities[3]) == 0)
                local found = player.get_alerts({ type = defines.alert_type.custom })
                local preserved = false
                for _, alert in pairs(found[surface.index][defines.alert_type.custom]) do
                    preserved = preserved or (alert.target == entities[3] and alert.message == "Unrelated alert")
                end
                assert(preserved, "Namespace cleanup must retain another mod's alerts")
                done()
            end)
        end)
    end)

    test(
        "rotating the underground back into the belt flow clears both warnings without rotating other belts",
        function()
            async(180)
            local entities = line(directions[1], true, { -8, 0 })
            after_ticks(61, function()
                assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
                assert(entities[2].rotate())
                assert(
                    entities[2].direction == defines.direction.east and entities[3].direction == defines.direction.east
                )
                after_ticks(61, function()
                    assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 0)
                    assert(
                        entities[1].direction == defines.direction.east
                            and entities[4].direction == defines.direction.east
                    )
                    done()
                end)
            end)
        end
    )

    test("rotation of ordinary belts into opposing flow detects an existing underground pair", function()
        async(180)
        local entities = line(directions[1], true, { -8, 0 }, "fast-underground-belt")
        entities[4].direction = defines.direction.west
        after_ticks(61, function()
            assert(#alerts(entities[2]) == 0)
            local previous = entities[4].direction
            entities[4].direction = defines.direction.east
            script.get_event_handler(defines.events.on_player_rotated_entity)({
                name = defines.events.on_player_rotated_entity,
                tick = game.tick,
                player_index = player.index,
                entity = entities[4],
                previous_direction = previous,
            })
            after_ticks(61, function()
                assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
                done()
            end)
        end)
    end)

    test("force changes hide warnings from former teammates and foreign belts do not establish flow", function()
        async(180)
        local own = line(directions[1], true, { -8, -4 })
        local foreign = line(directions[1], true, { -8, 4 })
        foreign[1].force = game.forces.player
        foreign[4].force = game.forces.player
        after_ticks(61, function()
            assert(#alerts(own[2]) == 1 and #alerts(foreign[2]) == 0)
            player.force = game.forces.player
            after_ticks(61, function()
                assert(#alerts(own[2]) == 0 and #alerts(own[3]) == 0)
                done()
            end)
        end)
    end)

    test("keeps another custom alert on a reversed endpoint and resumes its own alert when that clears", function()
        async(180)
        local entities = line(directions[1], true, { -8, 0 })
        player.add_custom_alert(entities[2], { type = "item", name = "iron-plate" }, "Unrelated alert", true)
        after_ticks(61, function()
            assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 1)
            local found = player.get_alerts({ type = defines.alert_type.custom })
            local preserved = false
            for _, alert in pairs(found[surface.index][defines.alert_type.custom]) do
                if alert.target == entities[2] and alert.message == "Unrelated alert" then
                    preserved = true
                end
            end
            assert(preserved, "Refreshing warnings must not replace another custom alert on the same belt")
            assert(storage.reversed_underground_belt_detector.warnings[entities[2].unit_number].sprite.valid)
            player.remove_alert({ message = "Unrelated alert" })
            after_ticks(61, function()
                assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
                done()
            end)
        end)
    end)

    test(
        "reversing an already flagged pair updates mouth arrows and replaces the muted span in the new flow",
        function()
            async(180)
            local entities = line(directions[1], true, { -8, 0 })
            after_ticks(61, function()
                local warnings = storage.reversed_underground_belt_detector.warnings
                local previous = warnings[entities[3].unit_number].span
                assert(entities[2].rotate())
                entities[1].direction, entities[4].direction = defines.direction.west, defines.direction.west
                after_ticks(61, function()
                    local input, output = warnings[entities[2].unit_number], warnings[entities[3].unit_number]
                    assert(input.sprite.orientation == 0.25 and output.sprite.orientation == 0.25)
                    assert(#input.span == 3 and not output.span)
                    for _, sprite in ipairs(previous) do
                        assert(not sprite.valid, "The old flow must not leave overlapping arrows behind")
                    end
                    for step, sprite in ipairs(input.span) do
                        assert(sprite.orientation == 0.25 and sprite.target.offset[1] == step)
                        assert(sprite.target.offset[2] == 0)
                    end
                    done()
                end)
            end)
        end
    )

    test(
        "arrows remain visible with alerts off and changing the setting updates alerts without rebuilding them",
        function()
            generate_alerts(false)
            local entities = line(directions[1], true, { -8, 0 })
            after_ticks(61, function()
                local warning = storage.reversed_underground_belt_detector.warnings[entities[3].unit_number]
                local mouth, interior = warning.sprite, warning.span[1]
                assert(mouth.valid and interior.valid)
                assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 0)
                generate_alerts(true)
                after_ticks(1, function()
                    assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
                    generate_alerts(false)
                    after_ticks(1, function()
                        assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 0)
                        assert(
                            mouth.valid and interior.valid,
                            "Alert preferences must not rebuild or hide world arrows"
                        )
                    end)
                end)
            end)
        end
    )

    test("periodic validation repairs lost render objects and detects corrections without events", function()
        async(360)
        local entities = line(directions[1], true, { -8, 0 })
        local input_id, output_id = entities[3].unit_number, entities[2].unit_number
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            warnings[input_id].span[1].destroy()
            warnings[output_id].sprite.destroy()
            after_ticks(61, function()
                assert(warnings[output_id].sprite.valid)
                for _, sprite in ipairs(warnings[input_id].span) do
                    assert(sprite.valid)
                end
                set_overlay("steady")
                warnings[input_id].steady.sprite.destroy()
                after_ticks(61, function()
                    local steady = assert(warnings[input_id].steady)
                    assert(steady.sprite.valid and steady.sprite.visible)
                    for _, sprite in ipairs(steady.span) do
                        assert(sprite.valid and sprite.visible)
                    end
                    entities[1].direction = defines.direction.west
                    after_ticks(61, function()
                        assert(not warnings[input_id] and not warnings[output_id])
                        assert(not steady.sprite.valid, "Silent corrections must still clear cached overlays")
                        assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 0)
                        done()
                    end)
                end)
            end)
        end)
    end)

    test("periodic validation refreshes replaced exterior belts and rejects changed forces", function()
        async(240)
        local entities = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            assert(warnings[entities[2].unit_number] and warnings[entities[3].unit_number])
            entities[1].destroy()
            entities[1] = assert(surface.create_entity({
                name = "transport-belt",
                position = { -9, 0 },
                direction = defines.direction.east,
                force = force,
            }))
            after_ticks(61, function()
                assert(warnings[entities[2].unit_number] and warnings[entities[3].unit_number])
                entities[1].force = game.forces.player
                entities[4].force = game.forces.player
                after_ticks(61, function()
                    assert(not warnings[entities[2].unit_number] and not warnings[entities[3].unit_number])
                    assert(#alerts(entities[2]) == 0 and #alerts(entities[3]) == 0)
                    done()
                end)
            end)
        end)
    end)

    test("overlay modes change immediately while map alerts remain independent", function()
        async(180)
        local entities = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            local warning = storage.reversed_underground_belt_detector.warnings[entities[3].unit_number]
            assert(warning.sprite.visible and #alerts(entities[3]) == 1)
            set_overlay("steady")
            local steady = assert(warning.steady)
            assert(not warning.sprite.visible and steady.sprite.visible and steady.span[1].visible)
            local alpha = steady.sprite.color.a
            after_ticks(18, function()
                assert(steady.sprite.color.a == alpha, "Steady warnings must not continue pulsing")
                set_overlay("off")
                assert(not warning.sprite.visible and (not steady.sprite.valid or not steady.sprite.visible))
                assert(#alerts(entities[3]) == 1, "Hiding arrows must not disable map alerts")
                set_overlay("pulsing")
                generate_alerts(false)
                assert(warning.sprite.visible and warning.span[1].visible and #alerts(entities[3]) == 0)
                done()
            end)
        end)
    end)

    test("mouth hover hides only its own pair and switching pairs restores the previous span", function()
        local entities = line(directions[1], true, { -12, 0 })
        local other = line(directions[1], true, { -12, 8 })
        local correct = line(directions[1], false, { -12, -8 })
        local furnace = surface.create_entity({ name = "stone-furnace", position = { 12, 0 }, force = force })
        local splitter = surface.create_entity({ name = "splitter", position = { 12, 4 }, force = force })
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            local warning, second = warnings[entities[3].unit_number], warnings[other[3].unit_number]
            for _, mode in ipairs({ "pulsing", "steady" }) do
                set_overlay(mode)
                local view = mode == "pulsing" and warning or assert(warning.steady)
                local other_view = mode == "pulsing" and second or assert(second.steady)
                local interior, other_interior = assert(view.span)[1], assert(other_view.span)[1]
                for _, unrelated in ipairs({ entities[1], other[1], correct[2], splitter }) do
                    player.selected = unrelated
                    assert(interior.visible and other_interior.visible, "Unrelated belts must not hide either span")
                end
                for _, mouth in ipairs({ entities[2], entities[3] }) do
                    player.selected = mouth
                    assert(view.sprite.visible and not interior.visible and other_interior.visible)
                end
                for _, mouth in ipairs({ other[2], other[3] }) do
                    player.selected = mouth
                    assert(other_view.sprite.visible and interior.visible and not other_interior.visible)
                end
                player.clear_selected_entity()
                assert(interior.visible and other_interior.visible)
                player.selected = entities[2]
                player.selected = furnace
                assert(interior.visible and other_interior.visible)
            end
        end)
    end)

    test("pair-specific hover and overlay mode leave other viewers and pairs visible", function()
        local entities = line(directions[1], true, { -8, 0 })
        local other = line(directions[1], true, { -8, 8 })
        local first = {
            index = 1,
            mod_settings = { [preferences.overlay_setting] = { value = "pulsing" } },
            selected = entities[2],
        }
        local second = { index = 2, mod_settings = { [preferences.overlay_setting] = { value = "steady" } } }
        local third = { index = 3, mod_settings = { [preferences.overlay_setting] = { value = "off" } } }
        local team = { players = { first, second, third } }
        local audiences = preferences.audiences(team)
        assert(#preferences.span_players(audiences.pulsing, entities[2], entities[3]) == 0)
        assert(preferences.span_players(audiences.steady, entities[2], entities[3])[1] == second)
        assert(preferences.span_players(audiences.pulsing, other[2], other[3])[1] == first)
        first.selected, second.selected = nil, entities[3]
        audiences = preferences.audiences(team)
        assert(preferences.span_players(audiences.pulsing, entities[2], entities[3])[1] == first)
        assert(#preferences.span_players(audiences.steady, entities[2], entities[3]) == 0)
        second.mod_settings[preferences.overlay_setting].value = "pulsing"
        first.selected, second.selected = entities[2], other[2]
        audiences = preferences.audiences(team)
        assert(preferences.span_players(audiences.pulsing, entities[2], entities[3])[1] == second)
        assert(preferences.span_players(audiences.pulsing, other[2], other[3])[1] == first)
        assert(#audiences.pulsing.mouths == 2 and #audiences.steady.mouths == 0)
    end)

    test("warnings breathe smoothly without disappearing, losing direction, or making the span dominant", function()
        async(appearance.pulse_period + 120)
        generate_alerts(false)
        local entities = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            local warning = storage.reversed_underground_belt_detector.warnings[entities[3].unit_number]
            local mouth, interior = warning.sprite, warning.span[1]
            local previous = mouth.color.a
            local low, high, rising, falling = previous, previous, false, false
            local green_ratio = mouth.color.g / mouth.color.r
            local blue_ratio = mouth.color.b / mouth.color.r
            local sample_count = math.ceil(appearance.pulse_period / appearance.pulse_interval) + 2
            local function sample(count)
                local alpha, span_alpha = mouth.color.a, interior.color.a
                assert(mouth.valid and interior.valid)
                assert(alpha >= 0.6 and alpha <= 1, "A breathing warning must stay visible instead of blinking off")
                assert(span_alpha > 0 and span_alpha < alpha, "The underground span must stay subordinate")
                assert(math.abs(alpha - previous) < 0.08, "Pulse steps must not flash abruptly")
                for _, tint in ipairs({ mouth.color, interior.color }) do
                    assert(tint.r <= tint.a + 0.00001, "An opacity fade must premultiply brightness, not just alpha")
                    assert(
                        math.abs(tint.g / tint.r - green_ratio) < 0.00001
                            and math.abs(tint.b / tint.r - blue_ratio) < 0.00001,
                        "Fading opacity must preserve the selected warning hue"
                    )
                end
                assert(mouth.orientation == 0.75 and interior.orientation == 0.75)
                low, high = math.min(low, alpha), math.max(high, alpha)
                rising, falling = rising or alpha > previous + 0.001, falling or alpha < previous - 0.001
                previous = alpha
                if count == sample_count then
                    assert(rising and falling and high - low > 0.2, "Warnings must visibly fade both in and out")
                    done()
                else
                    after_ticks(appearance.pulse_interval, function()
                        sample(count + 1)
                    end)
                end
            end
            sample(0)
        end)
    end)

    local tiers = { "underground-belt", "fast-underground-belt", "express-underground-belt" }
    if script.active_mods["space-age"] then
        tiers[#tiers + 1] = "turbo-underground-belt"
    end
    for _, name in ipairs(tiers) do
        test("respects native maximum reach and orientation for " .. name, function()
            local gap = prototypes.entity[name].max_underground_distance
            local origins = { { -20, -20 }, { 20, -20 }, { 20, 20 }, { -20, 20 } }
            local pairs_by_direction = {}
            for index, spec in ipairs(directions) do
                pairs_by_direction[index] = line(spec, true, origins[index], name, gap)
            end
            after_ticks(61, function()
                local warnings = storage.reversed_underground_belt_detector.warnings
                for _, entities in ipairs(pairs_by_direction) do
                    local input = assert(warnings[entities[3].unit_number])
                    assert(input.distance == gap and #input.span == gap - 1)
                    assert(not warnings[entities[2].unit_number].span)
                    assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
                end
            end)
        end)
    end

    test("warns adjacent reversed mouths without drawing a nonexistent underground span", function()
        local entities = line(directions[1], true, { -8, 0 }, nil, 1)
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            assert(warnings[entities[2].unit_number] and warnings[entities[3].unit_number])
            assert(#(warnings[entities[2].unit_number].span or {}) == 0)
            assert(#(warnings[entities[3].unit_number].span or {}) == 0)
            assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
        end)
    end)

    test("does not connect mouths across tiers, forces, or native reach", function()
        local wrong_tier = line(directions[1], true, { -20, -12 })
        local foreign = line(directions[1], true, { -20, 0 })
        local too_far =
            line(directions[1], true, { -20, 12 }, nil, prototypes.entity["underground-belt"].max_underground_distance)
        wrong_tier[3].destroy({ raise_destroy = true })
        assert(surface.create_entity({
            name = "fast-underground-belt",
            position = { -16, -12 },
            direction = defines.direction.west,
            type = "input",
            force = force,
            raise_built = true,
        }))
        foreign[3].force = game.forces.player
        local position = too_far[3].position
        too_far[3].destroy({ raise_destroy = true })
        too_far[4].destroy({ raise_destroy = true })
        assert(surface.create_entity({
            name = "underground-belt",
            position = { position.x + 1, position.y },
            direction = defines.direction.west,
            type = "input",
            force = force,
            raise_built = true,
        }))
        assert(surface.create_entity({
            name = "transport-belt",
            position = { position.x + 2, position.y },
            direction = defines.direction.east,
            force = force,
            raise_built = true,
        }))
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            for _, entities in ipairs({ wrong_tier, foreign, too_far }) do
                assert(not entities[2].underground_belt_neighbour)
                assert(not warnings[entities[2].unit_number] and #alerts(entities[2]) == 0)
            end
        end)
    end)

    test("detects native cloned and ghost-revived pairs and clears warnings after death", function()
        async(180)
        local source = line(directions[1], true, { -20, -12 })
        local cloned, revived = {}, {}
        for index, entity in ipairs(source) do
            local position = entity.position
            cloned[index] = assert(entity.clone({ position = { position.x, position.y + 12 }, surface = surface }))
        end
        for _, index in ipairs({ 4, 3, 1, 2 }) do
            local entity = source[index]
            local position = entity.position
            local ghost = assert(surface.create_entity({
                name = "entity-ghost",
                inner_name = entity.name,
                position = { position.x, position.y + 24 },
                direction = entity.direction,
                type = (index == 2 or index == 3) and entity.belt_to_ground_type or nil,
                force = force,
            }))
            local _, revived_entity = ghost.revive({ raise_revive = true })
            revived[index] = assert(revived_entity)
        end
        after_ticks(2, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            for _, entities in ipairs({ cloned, revived }) do
                assert(entities[2].underground_belt_neighbour == entities[3])
                assert(warnings[entities[2].unit_number] and warnings[entities[3].unit_number])
            end
            local id, sprite = revived[2].unit_number, warnings[revived[2].unit_number].sprite
            assert(revived[1].die())
            assert(revived[4].die())
            after_ticks(2, function()
                assert(not sprite.valid and not warnings[id] and not warnings[revived[3].unit_number])
                assert(warnings[cloned[2].unit_number].sprite.valid)
                done()
            end)
        end)
    end)

    for _, delay in ipairs({ 1, 29, 59 }) do
        test("distributes repairs and clears a shrinking silent-correction queue at phase " .. delay, function()
            async(300)
            generate_alerts(false)
            local entities = grid(120)
            after_ticks(61 + delay, function()
                local warnings = storage.reversed_underground_belt_detector.warnings
                assert(table_size(warnings) == 240)
                for _, warning in pairs(warnings) do
                    warning.sprite.destroy()
                end
                local previous, elapsed = 0, 0
                local function sample()
                    elapsed = elapsed + 1
                    local repaired = 0
                    for _, warning in pairs(warnings) do
                        if warning.sprite.valid then
                            repaired = repaired + 1
                        end
                    end
                    assert(
                        repaired - previous <= 8,
                        "Periodic repair must not rebuild the whole population on one tick"
                    )
                    previous = repaired
                    if elapsed < 60 then
                        after_ticks(1, sample)
                        return
                    end
                    assert(repaired == 240, "Every queued mouth must be repaired within one second")
                    for _, pair in ipairs(entities) do
                        pair[1].direction = defines.direction.west
                    end
                    after_ticks(61, function()
                        assert(
                            not next(warnings),
                            "Removing warnings must not reduce service enough to starve the queue tail"
                        )
                        local fresh = line(directions[1], true, { -24, 36 })
                        after_ticks(2, function()
                            assert(warnings[fresh[2].unit_number] and warnings[fresh[3].unit_number])
                            done()
                        end)
                    end)
                end
                after_ticks(1, sample)
            end)
        end)
    end

    test("bounds an overloaded population without losing work or delaying event-driven corrections", function()
        async(360)
        generate_alerts(false)
        local target = extra_surface("underground-scheduling-overload")
        local entities = grid(2000, target, 50)
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            assert(table_size(warnings) == 4000)
            for _, warning in pairs(warnings) do
                warning.sprite.destroy()
            end
            -- Remove the current head, tail and interior through real events,
            -- while every surviving entry still needs background repair.
            for _, index in ipairs({ 1, 1000, 2000 }) do
                entities[index][1].destroy({ raise_destroy = true })
                entities[index][4].destroy({ raise_destroy = true })
            end
            local previous, elapsed = 0, 0
            local function sample()
                elapsed = elapsed + 1
                local repaired = 0
                for _, warning in pairs(warnings) do
                    if warning.sprite.valid then
                        repaired = repaired + 1
                    end
                end
                assert(repaired - previous <= 128, "The background cap must hold above the one-second capacity")
                previous = repaired
                if elapsed == 2 then
                    for _, index in ipairs({ 1, 1000, 2000 }) do
                        assert(
                            not warnings[entities[index][2].unit_number]
                                and not warnings[entities[index][3].unit_number]
                        )
                    end
                end
                if elapsed < 65 then
                    after_ticks(1, sample)
                else
                    assert(
                        repaired == 3994 and table_size(warnings) == 3994,
                        "Overload must defer, never discard, queued repairs"
                    )
                    done()
                end
            end
            after_ticks(1, sample)
        end)
    end)

    test("retires silently resolved alerts without clearing other pairs or same-icon foreign alerts", function()
        async(240)
        local first, second = line(directions[1], true, { -16, -8 }), line(directions[1], true, { -16, 8 })
        after_ticks(61, function()
            local foreign = { "", "Foreign replacement" }
            player.add_custom_alert(first[2], { type = "item", name = "underground-belt" }, foreign, true)
            first[1].direction = defines.direction.west
            -- Silent edits need a validation cycle, then the next native renewal.
            after_ticks(121, function()
                assert(#alerts(first[2]) == 0 and #alerts(first[3]) == 0)
                assert(#alerts(second[2]) == 1 and #alerts(second[3]) == 1)
                local result = player.get_alerts({ entity = first[2] })
                assert(
                    helpers.table_to_json(result[surface.index][defines.alert_type.custom][1].message)
                        == helpers.table_to_json(foreign)
                )
                done()
            end)
        end)
    end)

    test(
        "cleans invalid surface references and can survey a replacement surface without leaking old renderings",
        function()
            async(180)
            generate_alerts(false)
            local target = extra_surface("underground-deleted-surface")
            local entities = line(directions[1], true, { -8, 0 }, nil, nil, target)
            after_ticks(2, function()
                local warnings = storage.reversed_underground_belt_detector.warnings
                local id = entities[2].unit_number
                local sprite = warnings[id].sprite
                game.delete_surface(target)
                after_ticks(61, function()
                    assert(not sprite.valid and not warnings[id] and not next(warnings))
                    local replacement = line(directions[1], true, { -8, 0 })
                    after_ticks(2, function()
                        local old = warnings[replacement[2].unit_number].sprite
                        undergrounds.on_configuration_changed()
                        undergrounds.on_configuration_changed()
                        after_ticks(2, function()
                            local rebuilt = storage.reversed_underground_belt_detector.warnings
                            assert(not old.valid and table_size(rebuilt) == 2)
                            assert(rebuilt[replacement[2].unit_number].sprite.valid)
                            done()
                        end)
                    end)
                end)
            end)
        end
    )

    test("resumes partially serviced render repairs after a native mod reload", function()
        generate_alerts(false)
        grid(120)
        after_ticks(61, function()
            for _, warning in pairs(storage.reversed_underground_belt_detector.warnings) do
                warning.sprite.destroy()
            end
            after_ticks(17, function()
                local repaired = 0
                for _, warning in pairs(storage.reversed_underground_belt_detector.warnings) do
                    if warning.sprite.valid then
                        repaired = repaired + 1
                    end
                end
                assert(repaired > 0 and repaired < 240, "Reload during partial progress, not before or after all work")
            end)
        end)
    end).after_reload_mods(function()
        surface = game.surfaces["underground-warning-tests"]
        force = game.forces["underground-warning-team"]
        player = game.get_player(1)
        after_ticks(61, function()
            local warnings = storage.reversed_underground_belt_detector.warnings
            assert(table_size(warnings) == 240)
            for _, warning in pairs(warnings) do
                assert(
                    warning.sprite.valid,
                    "Reload must retain the remaining work without duplicating or losing entries"
                )
            end
        end)
    end)

    test("configuration changes survey existing belts and mod reload preserves detection and cleanup", function()
        local entities = line(directions[1], true, { -8, 0 }, "express-underground-belt")
        storage.reversed_underground_belt_detector.pending = {}
        undergrounds.on_configuration_changed()
        after_ticks(61, function()
            assert(#alerts(entities[2]) == 1 and #alerts(entities[3]) == 1)
        end)
    end).after_reload_mods(function()
        async(180)
        surface = game.surfaces["underground-warning-tests"]
        force = game.forces["underground-warning-team"]
        player = game.get_player(1)
        local entity = assert(surface.find_entity("express-underground-belt", { -7.5, 0.5 }))
        after_ticks(61, function()
            assert(#alerts(entity) == 1)
            local sprite = storage.reversed_underground_belt_detector.warnings[entity.unit_number].sprite
            entity.destroy({ raise_destroy = true })
            after_ticks(61, function()
                assert(not sprite.valid)
                local other = assert(surface.find_entity("express-underground-belt", { -3.5, 0.5 }))
                assert(#alerts(other) == 0, "A removed endpoint must clear its surviving partner's warning")
                done()
            end)
        end)
    end)

    test("acknowledges either mouth in bulk and restores only selected connections", function()
        local rows, selected = {}, {}
        for index, spec in ipairs(directions) do
            rows[index] = line(spec, true, { -12 + index * 6, -12 })
            selected[#selected + 1] = rows[index][index % 2 + 2]
        end
        selected[#selected + 1] = rows[1][2]
        selected[#selected + 1] = rows[1][3]
        local foreign = line(directions[1], true, { -8, 14 })
        for _, entity in ipairs(foreign) do
            entity.force = game.forces.player
        end
        selected[#selected + 1] = foreign[2]
        after_ticks(61, function()
            manage(selected, false, "deconstruction-planner")
            assert(not storage.reversed_underground_belt_detector.warnings[rows[1][2].unit_number].acknowledged)
            manage(selected)
            manage(selected) -- Selecting both ends or selecting again must never toggle.
            for _, row in ipairs(rows) do
                acknowledged(row[2])
                acknowledged(row[3])
            end
            assert(not storage.reversed_underground_belt_detector.warnings[foreign[2].unit_number].acknowledged)
            manage({ rows[1][3], rows[1][2] }, true)
            for _, index in ipairs({ 2, 3 }) do
                local warning = storage.reversed_underground_belt_detector.warnings[rows[1][index].unit_number]
                assert(not warning.acknowledged and warning.sprite.visible and #alerts(rows[1][index]) == 1)
            end
            for index = 2, #rows do
                acknowledged(rows[index][2])
                acknowledged(rows[index][3])
            end
        end)
    end)

    test("acknowledges unpaired caps without ignoring future faults in the same area", function()
        async(180)
        local a = create_mouth(-8, 0, defines.direction.west, "output")
        local b = create_mouth(-4, 0, defines.direction.west, "output")
        feed(-9, 0, defines.direction.east)
        after_ticks(61, function()
            assert(not a.underground_belt_neighbour and not b.underground_belt_neighbour)
            manage({ a })
            acknowledged(a)
            acknowledged(b)
            manage({})
            local new = line(directions[1], true, { -8, 4 })
            after_ticks(61, function()
                acknowledged(a)
                acknowledged(b)
                assert(#alerts(new[2]) == 1 and #alerts(new[3]) == 1)
                manage({ b }, true)
                assert(#alerts(a) == 1 and #alerts(b) == 1)
                done()
            end)
        end)
    end)

    test("keeps acknowledgements through unrelated building item flow hover and overlay changes", function()
        async(240)
        local row = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            manage({ row[2] })
            feed(-7, 0, defines.direction.north) -- Beside the hood, not exterior flow evidence.
            assert(row[1].get_transport_line(1).insert_at_back({ name = "iron-plate", count = 1 }))
            set_overlay("steady")
            player.selected = row[2]
            after_ticks(61, function()
                acknowledged(row[2])
                acknowledged(row[3])
                player.clear_selected_entity()
                set_overlay("off")
                after_ticks(2, function()
                    acknowledged(row[2])
                    acknowledged(row[3])
                    set_overlay("pulsing")
                    after_ticks(61, function()
                        acknowledged(row[2])
                        acknowledged(row[3])
                        done()
                    end)
                end)
            end)
        end)
    end)

    test("restores warnings when relevant exterior evidence changes", function()
        async(300)
        local row = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            manage({ row[2] })
            row[1].destroy({ raise_destroy = true })
            after_ticks(61, function()
                assert(
                    #alerts(row[2]) == 1 and #alerts(row[3]) == 1,
                    "Losing one of two relevant exterior belts changes the acknowledged arrangement"
                )
                manage({ row[3] })
                row[4].direction = defines.direction.west -- Native flow now agrees; no raised event.
                after_ticks(61, function()
                    local warnings = storage.reversed_underground_belt_detector.warnings
                    assert(not warnings[row[2].unit_number] and not warnings[row[3].unit_number])
                    row[4].direction = defines.direction.east
                    undergrounds.on_configuration_changed()
                    after_ticks(61, function()
                        assert(#alerts(row[2]) == 1 and #alerts(row[3]) == 1)
                        done()
                    end)
                end)
            end)
        end)
    end)

    test("does not transfer acknowledgement to a replacement mouth or a repaired then reversed pair", function()
        async(240)
        local row = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            manage({ row[2] })
            local position, direction, role = row[3].position, row[3].direction, row[3].belt_to_ground_type
            row[3].destroy({ raise_destroy = true })
            row[3] = create_mouth(position.x, position.y, direction, role)
            after_ticks(61, function()
                assert(#alerts(row[2]) == 1 and #alerts(row[3]) == 1)
                manage({ row[3] })
                assert(row[2].rotate({ by_player = player }))
                after_ticks(2, function()
                    assert(not storage.reversed_underground_belt_detector.warnings[row[2].unit_number])
                    assert(row[2].rotate({ by_player = player }))
                    after_ticks(61, function()
                        assert(#alerts(row[2]) == 1 and #alerts(row[3]) == 1)
                        done()
                    end)
                end)
            end)
        end)
    end)

    test("retains acknowledgements through surveys render repair and native mod reload", function()
        async(180)
        local row = line(directions[1], true, { -8, 0 })
        after_ticks(61, function()
            manage({ row[3] })
            acknowledged(row[2]).sprite.destroy()
            undergrounds.on_configuration_changed()
            after_ticks(61, function()
                assert(acknowledged(row[2]).sprite.valid)
                acknowledged(row[3])
                done()
            end)
        end)
    end).after_reload_mods(function()
        surface = game.surfaces["underground-warning-tests"]
        force = game.forces["underground-warning-team"]
        player = game.get_player(1)
        local a = assert(surface.find_entity("underground-belt", { -7.5, 0.5 }))
        local b = assert(surface.find_entity("underground-belt", { -3.5, 0.5 }))
        after_ticks(61, function()
            acknowledged(a)
            acknowledged(b)
            manage({ b }, true)
            assert(#alerts(a) == 1 and #alerts(b) == 1)
        end)
    end)

    test("cleans acknowledged connections after surface deletion and force changes", function()
        async(180)
        local row = line(directions[1], true, { -8, 0 })
        local target = extra_surface("acknowledged-surface-removal")
        local removed = line(directions[1], true, { -8, 0 }, nil, nil, target)
        after_ticks(61, function()
            manage({ row[2] })
            manage({ removed[3] })
            local removed_ids = { removed[2].unit_number, removed[3].unit_number }
            for _, entity in ipairs(row) do
                entity.force = game.forces.player
            end
            game.delete_surface(target)
            after_ticks(61, function()
                local state = storage.reversed_underground_belt_detector
                assert(not state.warnings[removed_ids[1]] and not state.warnings[removed_ids[2]])
                assert(not state.warnings[row[2].unit_number].acknowledged)
                assert(not state.warnings[row[3].unit_number].acknowledged)
                assert(state.validation_count == 2, "Acknowledged mouths must not leak validation entries")
                done()
            end)
        end)
    end)
end)
