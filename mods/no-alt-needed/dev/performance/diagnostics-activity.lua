-- The same native actions run in timing and correctness lanes.
local player, surface, hosts, connections, fluid
local function setting(name, value)
    remote.call("no-alt-needed-experiments", "set", player.index, "no-alt-needed-" .. name, value)
end
return function(update)
    if update == 1 then
        player = assert(game.get_player(1))
        assert(player.connected, "The fixture must preserve its saved native viewer")
        surface = player.surface
        fluid = surface.name == "no-alt-needed-performance-construction"
        assert(fluid or surface.name == "no-alt-needed-performance-steady")
        player.opened = nil
        player.clear_cursor()
        player.game_view_settings = { update_entity_selection = false, show_entity_info = false }
        for _, name in ipairs({ "hover", "nearby-recipes", "fluid-context", "auto-alt" }) do
            setting(name, false)
        end
        setting("fluid-background", "none")
        setting("warning-fluids", fluid and "issues" or "off")
        setting("warnings", "always")
        setting("inserter-capacity", true)
        hosts, connections = {}, {}
        if fluid then
            hosts = surface.find_entities_filtered({ name = "pump" })
            assert(#hosts == 121)
            assert(player.teleport({ 0, 48 }, surface))
        else
            for row = -4, 4 do
                for column = -4, 4 do
                    hosts[#hosts + 1] = assert(surface.create_entity({
                        name = "inserter",
                        position = { 48 + column * 3, row * 3 },
                        force = player.force,
                        raise_built = true,
                    }))
                end
            end
            assert(player.teleport({ 48, 0 }, surface))
        end
        table.sort(hosts, function(a, b)
            return a.unit_number < b.unit_number
        end)
    end
    if update <= 20 and not player.selected then
        local host = hosts[math.ceil(#hosts / 2)]
        if
            player.force.is_chunk_visible(
                surface,
                { math.floor(host.position.x / 32), math.floor(host.position.y / 32) }
            )
        then
            player.selected = host
        else
            assert(update < 20, "The native diagnostics scene must become visible")
        end
    end
    if update == 400 then
        local positions = {}
        local function connect(position, name)
            local x, y = position.x or position[1], position.y or position[2]
            local key = x .. ":" .. y
            if not positions[key] then
                positions[key] = true
                connections[#connections + 1] = assert(surface.create_entity({
                    name = name,
                    position = position,
                    force = player.force,
                    raise_built = true,
                }))
            end
        end
        for _, host in ipairs(hosts) do
            if fluid then
                for index = 1, host.fluids_count do
                    for _, port in ipairs(host.get_fluid_box_pipe_connections(index) or {}) do
                        assert(port.connection_type == "normal")
                        connect(port.target_position, "pipe")
                    end
                end
            else
                connect(host.pickup_position, "steel-chest")
                connect(host.drop_position, "steel-chest")
            end
        end
    elseif update == 700 then
        for _, entity in ipairs(connections) do
            assert(entity.destroy({ raise_destroy = true }))
        end
    elseif update == 1100 then
        setting("warnings", "off")
        setting("inserter-capacity", false)
        player.selected = nil
    elseif update == 1150 and not fluid then
        for _, entity in ipairs(hosts) do
            assert(entity.destroy({ raise_destroy = true }))
        end
    end
end
