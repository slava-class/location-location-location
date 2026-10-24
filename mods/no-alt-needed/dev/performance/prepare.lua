local p = assert(game.get_player(1))
local force = p.force
assert(not game.surfaces["no-alt-needed-performance"])
local s = game.create_surface("no-alt-needed-performance", {
    width = 256,
    height = 256,
    seed = 1729,
    default_enable_all_autoplace_controls = false,
    autoplace_settings = {
        entity = { treat_missing_as_default = false },
        decorative = { treat_missing_as_default = false },
    },
})
s.request_to_generate_chunks({ 0, 32 }, 3)
s.force_generate_chunk_requests()
s.daytime, s.freeze_daytime = 0, true
local tiles = {}
for y = -48, 95 do
    for x = -48, 48 do
        tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
    end
end
s.set_tiles(tiles)
force.recipes["iron-gear-wheel"].enabled = true
force.recipes["copper-cable"].enabled = true
local machines, pumps, modules = 0, 0, 0
for row = -5, 5 do
    for column = -5, 5 do
        local e = assert(s.create_entity({
            name = "assembling-machine-3",
            position = { column * 3, row * 3 },
            force = force,
            raise_built = true,
        }))
        e.set_recipe("iron-gear-wheel")
        assert(e.get_recipe().name == "iron-gear-wheel")
        local count = assert(e.get_module_inventory()).insert({ name = "speed-module", count = 4 })
        assert(count == 4)
        modules, machines = modules + count, machines + 1
        local pump = assert(s.create_entity({
            name = "pump",
            position = { column * 3, 48 + row * 3 },
            force = force,
            raise_built = true,
        }))
        assert(pump.insert_fluid({ name = "water", amount = 100 }) > 0)
        pumps = pumps + 1
    end
end
p.set_controller({ type = defines.controllers.god })
assert(p.teleport({ 0, -40 }, s))
p.zoom = 1
p.game_view_settings = { update_entity_selection = false, show_entity_info = false }
p.selected = nil
p.clear_cursor()
force.chart(s, { { -64, -64 }, { 64, 96 } })
return { machines = machines, pumps = pumps, modules = modules, tick = game.tick, player = p.index }
