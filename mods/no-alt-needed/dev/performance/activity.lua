-- Public native actions only; identical work in primary and observer lanes.
local player, surface, mode, machines, pending
local function find_machines()
    machines = surface.find_entities_filtered({ name = "assembling-machine-3" })
    table.sort(machines, function(a, b)
        return a.unit_number < b.unit_number
    end)
end
local function visible(entity)
    return player.force.is_chunk_visible(surface, {
        math.floor(entity.position.x / 32),
        math.floor(entity.position.y / 32),
    })
end
local function select_center()
    local found = surface.find_entities_filtered({ position = { 0, 0 }, radius = 1, name = "assembling-machine-3" })
    assert(#found == 1)
    assert(visible(found[1]), "Machine must be visible before scripted selection")
    player.selected = found[1]
end
return function(update)
    if update == 1 then
        player = assert(game.get_player(1))
        assert(player.connected, "Benchmark must preserve the saved native viewer state")
        surface = player.surface
        mode = assert(surface.name:match("^no%-alt%-needed%-performance%-(.+)$"))
        assert(({
            idle = true,
            steady = true,
            rapid = true,
            recipes = true,
            burst = true,
            construction = true,
            background = true,
        })[mode])
        find_machines()
        if mode == "construction" or mode == "background" then
            assert(player.teleport({ 0, 48 }, surface))
            if mode == "construction" then
                player.cursor_stack.set_stack({ name = "pipe", count = 1 })
                local found = surface.find_entities_filtered({ position = { 0, 48 }, radius = 1, name = "pump" })
                assert(#found == 1)
                pending = found[1]
            end
        elseif mode ~= "idle" then
            assert(player.teleport({ 0, 0 }, surface))
            select_center()
        end
    end
    if pending then
        if visible(pending) then
            player.selected, pending = pending, nil
        else
            assert(update < 20, "Native fluid scene did not become visible")
        end
    end
    if mode == "rapid" and update < 1100 then
        local target = machines[(update - 1) % #machines + 1]
        assert(visible(target), "Rapid-selection target must be visible")
        player.selected = target
    elseif mode == "recipes" and (update == 300 or update == 900) then
        for _, entity in ipairs(machines) do
            entity.set_recipe(update == 300 and "copper-cable" or "iron-gear-wheel")
        end
    elseif mode == "burst" and update == 600 then
        for _, entity in ipairs(machines) do
            assert(entity.destroy({ raise_destroy = true }))
        end
    elseif mode == "burst" and update == 900 then
        for row = -5, 5 do
            for column = -5, 5 do
                local entity = assert(surface.create_entity({
                    name = "assembling-machine-3",
                    position = { column * 3, row * 3 },
                    force = player.force,
                    raise_built = true,
                }))
                entity.set_recipe("iron-gear-wheel")
                assert(entity.get_module_inventory().insert({ name = "speed-module", count = 4 }) == 4)
            end
        end
        find_machines()
        select_center()
    end
    if update == 1180 then
        player.opened = machines[1]
        player.selected = nil
        player.clear_cursor()
        assert(player.teleport({ 0, -40 }, surface))
    end
end
