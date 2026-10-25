-- Identical public native actions in primary and observer lanes, including the
-- product-disabled control. Two 1800-update cycles include 1200 dense updates
-- each: enough to cover the 1080-tick overlap of the 216-tick pulse and 60-tick
-- alert period. No particular absolute saved-world tick is assumed.
local player, machines, belts
local function select_center()
    local found = machines.find_entities_filtered({ name = "assembling-machine-3", position = { 0, 0 }, radius = 1 })
    assert(#found == 1, "The fixed center must identify exactly one machine")
    local center = found[1]
    assert(player.force.is_chunk_visible(machines, { 0, 0 }))
    player.selected = center
end
local function build_belts()
    for index = 0, 999 do
        local x, y = -200 + (index % 50) * 8, -40 + math.floor(index / 50) * 4
        for part, offset in ipairs({ -1, 0, 4, 5 }) do
            assert(belts.create_entity({
                name = (part == 2 or part == 3) and "underground-belt" or "transport-belt",
                position = { x + offset, y },
                direction = (part == 2 or part == 3) and defines.direction.west or defines.direction.east,
                type = part == 2 and "output" or "input",
                force = player.force,
                raise_built = true,
            }))
        end
    end
end
local function rebuild_machines()
    for row = -5, 5 do
        for column = -5, 5 do
            local entity = assert(machines.create_entity({
                name = "assembling-machine-3",
                position = { column * 3, row * 3 },
                force = player.force,
                raise_built = true,
            }))
            entity.set_recipe("iron-gear-wheel")
            assert(entity.get_module_inventory().insert({ name = "speed-module", count = 4 }) == 4)
        end
    end
end
return function(update)
    if update == 1 then
        player = assert(game.get_player("FleetVerifier"))
        assert(player.connected and #game.connected_players == 1, "A genuinely connected saved viewer is required")
        machines, belts = game.surfaces["workshop-fleet-machines"], game.surfaces["workshop-fleet-belts"]
        assert(machines and belts and player.surface == machines)
    end
    local phase = update % 1800
    if phase == 120 then
        build_belts()
        assert(player.teleport({ 0, 0 }, machines))
        select_center()
    elseif phase == 1320 then
        for _, entity in pairs(machines.find_entities_filtered({ name = "assembling-machine-3" })) do
            entity.set_recipe("copper-cable")
        end
    elseif phase == 1440 then
        player.selected = nil
        player.opened = defines.gui_type.controller
        assert(player.opened_self and player.opened_gui_type == defines.gui_type.controller)
    elseif phase == 1500 then
        for _, entity in pairs(machines.find_entities_filtered({ name = "assembling-machine-3" })) do
            assert(entity.destroy({ raise_destroy = true }))
        end
        for _, entity in pairs(belts.find_entities_filtered({ type = { "underground-belt", "transport-belt" } })) do
            assert(entity.destroy({ raise_destroy = true }))
        end
    elseif phase == 1560 then
        rebuild_machines()
        assert(player.teleport({ 0, -40 }, machines))
    elseif phase == 0 then
        player.opened = nil
    end
end
