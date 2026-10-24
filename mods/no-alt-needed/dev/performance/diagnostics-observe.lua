-- Separate observer lane; never imported by the primary timing process.
return function()
    local player = assert(game.get_player(1))
    local surface = player.surface
    local fluid = surface.name == "no-alt-needed-performance-construction"
    assert(fluid or surface.name == "no-alt-needed-performance-steady")
    local hosts = surface.find_entities_filtered({ name = fluid and "pump" or "inserter" })
    local owned = {}
    for _, entity in ipairs(hosts) do
        owned[entity.unit_number] = true
    end
    local markers, capacities = 0, 0
    for _, object in ipairs(rendering.get_all_objects("no-alt-needed")) do
        assert(object.valid and object.visible and object.surface == surface)
        assert(#object.players == 1 and object.players[1].index == player.index, "Diagnostic audience leak")
        local target
        if object.type == "line" then
            target = object.from
        else
            assert(object.type == "polygon" or object.type == "text", "Unexpected competing overlay")
            target = object.target
        end
        assert(target.type == "entity" and target.entity.valid and owned[target.entity.unit_number])
        if object.type == "text" then
            assert(target.entity == player.selected)
            assert(tonumber(object.text[2]) > 0, "Capacity must remain a positive configured rate")
            capacities = capacities + 1
        else
            markers = markers + 1
        end
    end
    return { hosts = #hosts, markers = markers, capacities = capacities, connected_players = #game.connected_players }
end
