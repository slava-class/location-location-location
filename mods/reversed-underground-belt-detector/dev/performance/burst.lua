local entities = {}

-- Use public engine operations and raised construction/destruction events only.
-- Timings include fixture work: the same driver must be used on both sides.
return function(update)
    if update == 120 then
        local surface = assert(game.surfaces["migration-fixture"])
        assert(surface.count_entities_filtered({ type = "underground-belt" }) == 0, "Burst requires an empty fixture")
        for index = 0, 999 do
            local x, y = (index % 50) * 8 - 200, math.floor(index / 50) * 4 - 70
            for part, offset in ipairs({ -1, 0, 4, 5 }) do
                local underground = part == 2 or part == 3
                entities[#entities + 1] = assert(surface.create_entity({
                    name = underground and "underground-belt" or "transport-belt",
                    position = { x + offset, y },
                    direction = underground and defines.direction.west or defines.direction.east,
                    type = part == 2 and "output" or "input",
                    force = "player",
                    raise_built = true,
                }))
            end
        end
    elseif update == 600 then
        for _, entity in ipairs(entities) do
            assert(entity.valid and entity.destroy({ raise_destroy = true }), "Burst entity disappeared before removal")
        end
        entities = {}
    end
end
