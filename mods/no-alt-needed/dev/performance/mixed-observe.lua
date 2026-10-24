return function()
    local players = { assert(game.get_player(1)), assert(game.get_player(2)) }
    local wanted, seen = { {}, {} }, { {}, {} }
    local selected, remote, expected_recipes, recipes, module_icons = 0, 0, 0, 0, 0
    for index, p in ipairs(players) do
        if p.selected then
            selected = selected + 1
            if p.controller_type == defines.controllers.remote then
                remote = remote + 1
            end
            local values = settings.get_player_settings(p)
            local radius = values["no-alt-needed-recipe-radius"].value
            for _, e in pairs(p.surface.find_entities_filtered({ type = "assembling-machine" })) do
                local box, point = e.bounding_box, p.selected.position
                local x = math.min(math.max(point.x, box.left_top.x), box.right_bottom.x)
                local y = math.min(math.max(point.y, box.left_top.y), box.right_bottom.y)
                if
                    e == p.selected
                    or (
                        values["no-alt-needed-nearby-recipes"].value
                        and (point.x - x) ^ 2 + (point.y - y) ^ 2 <= radius ^ 2
                    )
                then
                    wanted[index][e.unit_number] = e
                    expected_recipes = expected_recipes + 1
                end
            end
        end
    end
    local errors, audience = 0, 0
    local objects = rendering.get_all_objects("no-alt-needed")
    for _, object in pairs(objects) do
        local owner = object.players and #object.players == 1 and object.players[1].index
        local p = owner and players[owner]
        if not p then
            audience = audience + 1
        elseif object.type == "sprite" then
            local target = object.target.entity
            if object.sprite:sub(1, 7) == "recipe/" then
                recipes = recipes + 1
                local key = target and target.unit_number
                if
                    not key
                    or not wanted[owner][key]
                    or seen[owner][key]
                    or object.sprite ~= "recipe/" .. target.get_recipe().name
                then
                    errors = errors + 1
                else
                    seen[owner][key] = true
                end
            elseif object.sprite == "item/speed-module" then
                module_icons = module_icons + 1
                if target ~= p.selected then
                    errors = errors + 1
                end
            end
        end
    end
    for index, entities in ipairs(wanted) do
        for key in pairs(entities) do
            if not seen[index][key] then
                errors = errors + 1
            end
        end
    end
    helpers.write_file("mixed-viewer-observations.jsonl", helpers.table_to_json({
        tick = game.tick,
        selected = selected,
        remote = remote,
        objects = #objects,
    }) .. "\n", true)
    return {
        connected_players = #game.connected_players,
        selected_players = selected,
        remote_players = remote,
        expected_recipes = expected_recipes,
        recipe_icons = recipes,
        module_icons = module_icons,
        recipe_errors = errors,
        audience_errors = audience,
        inactive_renderings = selected == 0 and #objects or 0,
    }
end
