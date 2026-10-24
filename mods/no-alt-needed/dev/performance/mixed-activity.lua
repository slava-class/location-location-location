local local_surface, remote_surface
local function select_center(p)
    local e = assert(p.surface.find_entity("assembling-machine-3", { 0, 0 }))
    assert(p.force.is_chunk_visible(p.surface, { 0, 0 }))
    p.selected = e
    assert(p.selected == e)
end

return function(update)
    local a, b = assert(game.get_player(1)), assert(game.get_player(2))
    if update == 1 then
        assert(a.connected and b.connected and #game.connected_players == 2)
        local_surface = assert(game.surfaces["no-alt-needed-mixed-local"])
        remote_surface = assert(game.surfaces["no-alt-needed-mixed-remote"])
        assert(settings.get_player_settings(a)["no-alt-needed-recipe-radius"].value == 6)
        assert(settings.get_player_settings(b)["no-alt-needed-recipe-radius"].value == 10)
        assert(settings.get_player_settings(a)["no-alt-needed-nearby-recipes"].value)
        assert(not settings.get_player_settings(b)["no-alt-needed-nearby-recipes"].value)
        assert(not a.game_view_settings.show_entity_info and not b.game_view_settings.show_entity_info)
        select_center(a)
        select_center(b)
    elseif update == 300 then
        a.set_controller({ type = defines.controllers.remote, surface = remote_surface, position = { 0, 0 } })
        assert(a.surface == remote_surface)
        select_center(a)
    elseif update == 600 then
        a.set_controller({ type = defines.controllers.god })
        assert(a.teleport({ 0, 0 }, local_surface))
        select_center(a)
        b.selected = nil
    elseif update == 900 then
        a.opened = assert(a.surface.find_entity("assembling-machine-3", { 0, 0 }))
        a.selected = nil
        select_center(b)
    elseif update == 1180 then
        a.selected, b.selected = nil, nil
    end
end
