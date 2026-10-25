-- Execute once in an owned native session, with the four workshop products loaded.
-- This prepares a fixed world; it is never a production mod or a timed observer.
local p = assert(game.get_player("FleetVerifier"))
assert(p.connected and #game.connected_players == 1)
assert(not game.surfaces["workshop-fleet-machines"])
assert(not game.surfaces["workshop-fleet-belts"])
local function surface(name, width, height, radius)
    local value = game.create_surface(name, {
        width = width,
        height = height,
        seed = 1729,
        default_enable_all_autoplace_controls = false,
        autoplace_settings = {
            entity = { treat_missing_as_default = false },
            decorative = { treat_missing_as_default = false },
        },
    })
    value.request_to_generate_chunks({ 0, 0 }, radius)
    value.force_generate_chunk_requests()
    value.daytime, value.freeze_daytime = 0, true
    p.force.chart(value, { { -width / 2, -height / 2 }, { width / 2 - 1, height / 2 - 1 } })
    return value
end
local machines = surface("workshop-fleet-machines", 256, 256, 4)
surface("workshop-fleet-belts", 512, 256, 8)
p.force.recipes["iron-gear-wheel"].enabled = true
p.force.recipes["copper-cable"].enabled = true
for row = -5, 5 do
    for column = -5, 5 do
        local machine = assert(machines.create_entity({
            name = "assembling-machine-3",
            position = { column * 3, row * 3 },
            force = p.force,
            raise_built = true,
        }))
        machine.set_recipe("iron-gear-wheel")
        assert(machine.get_module_inventory().insert({ name = "speed-module", count = 4 }) == 4)
        local pump = assert(machines.create_entity({
            name = "pump",
            position = { column * 3, 48 + row * 3 },
            force = p.force,
            raise_built = true,
        }))
        assert(pump.insert_fluid({ name = "water", amount = 100 }) == 100)
    end
end
local foreign = assert(machines.create_entity({
    name = "steel-chest",
    position = { -24, -24 },
    force = p.force,
    raise_built = true,
}))
assert(foreign.insert({ name = "iron-plate", count = 17 }) == 17)
foreign.set_tooltip_field({ name = "Fleet foreign field", value = "preserve", order = 1 })
rendering.draw_circle({ surface = machines, target = foreign, radius = 1, width = 2, color = { 1, 0, 1, 1 } })
assert(
    p.force.add_chart_tag(
        machines,
        { position = foreign.position, text = "Fleet foreign tag", icon = { type = "item", name = "iron-plate" } }
    )
)
p.set_controller({ type = defines.controllers.god })
assert(p.teleport({ 0, -40 }, machines))
p.zoom = 1
p.selected, p.opened = nil, nil
p.clear_cursor()
p.game_view_settings = { update_entity_selection = false, show_entity_info = false }
return {
    player = p.index,
    connected = #game.connected_players,
    machines = 121,
    pumps = 121,
    modules = 484,
    tick = game.tick,
}
