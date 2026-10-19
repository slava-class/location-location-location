---@return table<string, integer>
return function()
    local surface = assert(game.surfaces["migration-fixture"], "Missing fixed performance surface")
    local mouths = surface.find_entities_filtered({ type = "underground-belt" })
    for _, mouth in ipairs(mouths) do
        local neighbour = assert(mouth.underground_belt_neighbour, "Unpaired fixture mouth")
        assert(neighbour.underground_belt_neighbour == mouth, "Nonreciprocal underground pair")
        assert(
            mouth.direction == defines.direction.west and neighbour.direction == mouth.direction,
            "Fixture direction changed"
        )
        assert(
            math.abs(mouth.position.x - neighbour.position.x) == 4 and mouth.position.y == neighbour.position.y,
            "Fixture span changed"
        )
    end
    local sprites, visible, unrelated = 0, 0, 0
    for _, object in pairs(rendering.get_all_objects()) do
        if object.surface == surface then
            if object.type == "sprite" then
                sprites = sprites + 1
                if object.visible then
                    visible = visible + 1
                end
                assert(object.orientation == defines.direction.west / 16, "Warning arrow direction changed")
            elseif object.type == "circle" then
                local target = object.target
                if target.type == "position" and target.position.x == 20 and target.position.y == 20 then
                    assert(object.radius == 1, "Unrelated render changed")
                    unrelated = unrelated + 1
                end
            end
        end
    end
    assert(game.get_player(1), "Missing fixture player")
    local tags = game.forces.player.find_chart_tags(surface)
    local unrelated_tags = 0
    for _, tag in pairs(tags) do
        if tag.text == "Unrelated migration tag" then
            unrelated_tags = unrelated_tags + 1
        end
    end
    assert(unrelated_tags == 1, "Unrelated chart tag was lost or duplicated")
    local modes = { pulsing = 0, steady = 0, off = 0 }
    local alerts, selected = 0, 0
    for _, actor in pairs(game.players) do
        if actor.selected and actor.selected.type == "underground-belt" then
            selected = selected + 1
        end
        local mode = actor.mod_settings["reversed_underground_belt_detector_overlay"].value
        assert(modes[mode] ~= nil, "Unknown effective overlay mode")
        modes[mode] = modes[mode] + 1
        if actor.mod_settings["reversed_underground_belt_detector_alerts"].value then
            alerts = alerts + 1
        end
    end
    return {
        pairs = #mouths / 2,
        mouths = #mouths,
        surface_belts = surface.count_entities_filtered({ type = "transport-belt" }),
        warning_sprites = sprites,
        visible_sprites = visible,
        unrelated_renders = unrelated,
        chart_tags = #tags,
        players = #game.players,
        connected_players = #game.connected_players,
        selected_mouth_players = selected,
        fixture_force_players = #game.forces.player.players,
        pulsing_players = modes.pulsing,
        steady_players = modes.steady,
        overlay_off_players = modes.off,
        alerts_enabled_players = alerts,
    }
end
