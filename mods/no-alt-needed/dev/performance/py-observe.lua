return function()
    local p = assert(game.get_player(1))
    assert(p.connected)
    local selected, farms, modules, wanted, seen = p.selected, 0, 0, {}, {}
    for _, e in pairs(p.surface.find_entities_filtered({ type = "assembling-machine" })) do
        if e.name:find("fawogae-plantation", 1, true) then
            farms = farms + 1
            for _, stack in pairs(e.get_module_inventory().get_contents()) do
                modules = modules + stack.count
            end
            if selected then
                local box, point = e.bounding_box, selected.position
                local x = math.min(math.max(point.x, box.left_top.x), box.right_bottom.x)
                local y = math.min(math.max(point.y, box.left_top.y), box.right_bottom.y)
                if (point.x - x) ^ 2 + (point.y - y) ^ 2 <= 64 then
                    wanted[e.unit_number] = e
                end
            end
        end
    end
    local icons, errors, audience = 0, 0, 0
    local objects = rendering.get_all_objects("no-alt-needed")
    for _, object in pairs(objects) do
        if not object.players or #object.players ~= 1 or object.players[1].index ~= p.index then
            audience = audience + 1
        end
        if object.type == "sprite" then
            local target = object.target.entity
            if object.sprite:sub(1, 7) == "recipe/" then
                local key = target and target.unit_number
                if
                    not key
                    or not wanted[key]
                    or seen[key]
                    or object.sprite ~= "recipe/" .. target.get_recipe().name
                then
                    errors = errors + 1
                else
                    seen[key] = true
                end
            elseif target == selected and object.sprite:sub(1, 5) == "item/" then
                icons = icons + 1
            end
        end
    end
    for key in pairs(wanted) do
        if not seen[key] then
            errors = errors + 1
        end
    end
    helpers.write_file("py-module-grid-observations.jsonl", helpers.table_to_json({
        tick = game.tick,
        selected = selected and selected.name or "",
        module_icons = icons,
        objects = #objects,
    }) .. "\n", true)
    return {
        farms = farms,
        modules = modules,
        connected_players = #game.connected_players,
        selected_players = selected and 1 or 0,
        module_icons = icons,
        recipe_errors = errors,
        audience_errors = audience,
        inactive_renderings = not selected and #objects or 0,
    }
end
