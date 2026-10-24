local farms = {}
local targets = { [1] = 4, [300] = 1, [450] = 2, [600] = 3, [750] = 4 }
return function(update)
    local p = assert(game.get_player(1))
    if update == 1 then
        assert(p.connected and not p.game_view_settings.show_entity_info)
        local values = settings.get_player_settings(p)
        assert(values["no-alt-needed-recipe-radius"].value == 8)
        assert(values["no-alt-needed-nearby-recipes"].value)
        for _, e in pairs(p.surface.find_entities_filtered({ type = "assembling-machine" })) do
            if e.name:find("fawogae-plantation", 1, true) then
                farms[#farms + 1] = e
            end
        end
        table.sort(farms, function(a, b)
            return a.prototype.module_inventory_size < b.prototype.module_inventory_size
        end)
        assert(#farms == 4)
    end
    local target = targets[update]
    if target then
        local e = farms[target]
        assert(p.force.is_chunk_visible(e.surface, { math.floor(e.position.x / 32), math.floor(e.position.y / 32) }))
        p.selected = e
        assert(p.selected == e)
    elseif update == 1180 then
        p.opened = farms[1]
        p.selected = nil
    end
end
