local mouths
local player

-- Exercise public selection/force APIs; settings are prepared in owned fixture saves.
return function(update)
    if update == 1 then
        player = assert(game.get_player(1))
    elseif update >= 480 and update < 600 then
        if update == 480 then
            mouths = game.surfaces["migration-fixture"].find_entities_filtered({ type = "underground-belt" })
            assert(#mouths == 2000, "Audience fixture requires 1000 pairs")
        end
        player.selected = mouths[update - 479]
    elseif update == 600 then
        player.clear_selected_entity()
        mouths = nil
    elseif update == 960 then
        player.force = game.forces.enemy
    elseif update == 1080 then
        player.force = game.forces.player
    end
end
