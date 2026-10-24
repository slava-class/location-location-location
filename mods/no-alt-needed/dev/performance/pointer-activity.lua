-- Public native actions run identically in timing and correctness lanes.
local player
local function setting(name, value)
    remote.call("no-alt-needed-experiments", "set", player.index, "no-alt-needed-" .. name, value)
end
return function(update)
    if update == 1 then
        player = assert(game.get_player(1))
        assert(player.connected, "The fixture must preserve its saved native viewer")
        player.opened = nil
        player.clear_cursor()
        player.selected = nil
        assert(player.teleport({ 0, 0 }))
        player.zoom = 0.75
        player.game_view_settings = { update_entity_selection = false, show_entity_info = false }
        setting("experiment-nearby-focus", "pointer")
        setting("nearby-recipes", true)
    end
    if update >= 100 and update < 1100 then
        local x = update < 400 and -19 or (update % 2 == 0 and 19 or -19)
        if update >= 900 and update % 50 == 0 then
            player.zoom = update % 100 == 0 and 1 or 0.75
        end
        storage.no_alt_pointer_trial_x = x
        player.update_selected_entity({ x, 1 })
    elseif update == 1100 then
        storage.no_alt_pointer_trial_x = nil
        setting("nearby-recipes", false)
        player.selected = nil
    end
end
