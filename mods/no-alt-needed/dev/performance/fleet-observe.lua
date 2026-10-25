-- Public world/render/tooltip state only. Absent from the primary timing lane.
local function within(entity, point, radius)
    local box = entity.bounding_box
    local x = math.min(math.max(point.x, box.left_top.x), box.right_bottom.x)
    local y = math.min(math.max(point.y, box.left_top.y), box.right_bottom.y)
    return (point.x - x) ^ 2 + (point.y - y) ^ 2 <= radius ^ 2
end
return function()
    local player = assert(game.get_player("FleetVerifier"))
    local surface = assert(game.surfaces["workshop-fleet-machines"])
    local belts = assert(game.surfaces["workshop-fleet-belts"])
    assert(player.connected and player.surface == surface)
    local machines = surface.find_entities_filtered({ name = "assembling-machine-3" })
    local mouths = belts.find_entities_filtered({ type = "underground-belt" })
    for _, mouth in pairs(mouths) do
        local neighbour = assert(mouth.underground_belt_neighbour)
        assert(neighbour.underground_belt_neighbour == mouth)
        assert(mouth.direction == defines.direction.west and neighbour.direction == mouth.direction)
        assert(math.abs(mouth.position.x - neighbour.position.x) == 4 and mouth.position.y == neighbour.position.y)
    end
    local no_alt = script.active_mods["no-alt-needed"] ~= nil
    local tooltip = script.active_mods["recipe-name-tooltip"] ~= nil
    local detector = script.active_mods["reversed-underground-belt-detector"] ~= nil
    local planner = script.active_mods["location-location-location"] ~= nil
    local selected = player.selected
    local modules, fields, tooltip_errors, copper = 0, 0, 0, 0
    local wanted, found = {}, {}
    for _, entity in pairs(machines) do
        local recipe = assert(entity.get_recipe())
        if recipe.name == "copper-cable" then
            copper = copper + 1
        else
            assert(recipe.name == "iron-gear-wheel")
        end
        modules = modules + entity.get_module_inventory().get_item_count("speed-module")
        if
            no_alt
            and selected
            and player.opened_gui_type == defines.gui_type.none
            and within(entity, selected.position, player.mod_settings["no-alt-needed-recipe-radius"].value)
        then
            wanted[entity.unit_number] = entity
        end
        for _, field in pairs(entity.get_tooltip_fields()) do
            if type(field.name) == "table" and field.name[1] == "recipe-name-tooltip.recipe" then
                fields = fields + 1
                if
                    not tooltip
                    or entity ~= selected
                    or helpers.table_to_json(field.value) ~= helpers.table_to_json(recipe.localised_name)
                then
                    tooltip_errors = tooltip_errors + 1
                end
            end
        end
    end
    if fields ~= ((tooltip and selected and selected.name == "assembling-machine-3") and 1 or 0) then
        tooltip_errors = tooltip_errors + 1
    end
    local foreign_chests = surface.find_entities_filtered({ name = "steel-chest", position = { -24, -24 }, radius = 1 })
    assert(#foreign_chests == 1, "The unrelated fixture chest was lost or duplicated")
    local foreign = foreign_chests[1]
    assert(foreign.get_inventory(defines.inventory.chest).get_item_count("iron-plate") == 17)
    local foreign_fields = 0
    for _, field in pairs(foreign.get_tooltip_fields()) do
        if field.name == "Fleet foreign field" and field.value == "preserve" then
            foreign_fields = foreign_fields + 1
        end
    end
    assert(foreign_fields == 1, "Foreign tooltip was removed or duplicated")
    local foreign_renders, plan_renders, warnings, recipe_errors = 0, 0, 0, 0
    for _, object in pairs(rendering.get_all_objects()) do
        assert(object.valid)
        if object.type == "sprite" and object.surface == belts then
            assert(object.orientation == defines.direction.west / 16 and object.visible)
            warnings = warnings + 1
        elseif object.type == "sprite" and object.surface == surface then
            local target = object.target
            if target.type == "entity" then
                assert(target.entity.valid, "Invalid rendering target retained after cleanup")
                if object.sprite:sub(1, 7) == "recipe/" then
                    local entity = target.entity
                    if not wanted[entity.unit_number] or found[entity.unit_number] then
                        recipe_errors = recipe_errors + 1
                    end
                    local recipe = assert(entity.get_recipe())
                    if object.sprite ~= "recipe/" .. recipe.name then
                        recipe_errors = recipe_errors + 1
                    end
                    assert(#object.players == 1 and object.players[1] == player, "Recipe audience leaked")
                    found[entity.unit_number] = true
                end
            end
        elseif object.type == "circle" and object.surface == surface then
            if object.radius == 1 then
                assert(object.target.type == "entity" and object.target.entity == foreign)
                foreign_renders = foreign_renders + 1
            else
                plan_renders = plan_renders + 1
            end
        end
    end
    for id in pairs(wanted) do
        if not found[id] then
            recipe_errors = recipe_errors + 1
        end
    end
    local helpers_count = 0
    for _, entity in pairs(surface.find_entities_filtered({ type = "simple-entity-with-owner" })) do
        if entity.name:find("^no%-alt%-needed%-pointer%-") then
            helpers_count = helpers_count + 1
        end
    end
    local foreign_tags = 0
    for _, tag in pairs(player.force.find_chart_tags(surface)) do
        if tag.text == "Fleet foreign tag" then
            foreign_tags = foreign_tags + 1
        end
    end
    return {
        connected_players = #game.connected_players,
        machines = #machines,
        copper_recipes = copper,
        modules = modules,
        pumps = surface.count_entities_filtered({ name = "pump" }),
        mouths = #mouths,
        surface_belts = belts.count_entities_filtered({ type = "transport-belt" }),
        recipe_errors = recipe_errors,
        tooltip_errors = tooltip_errors,
        warning_errors = warnings == (detector and #mouths / 2 * 5 or 0) and 0 or 1,
        planner_errors = plan_renders == (planner and 2 or 0) and 0 or 1,
        helper_bound_errors = (helpers_count > 1024 or (not no_alt and helpers_count ~= 0)) and 1 or 0,
        foreign_fields = foreign_fields,
        foreign_renders = foreign_renders,
        foreign_tags = foreign_tags,
    }
end
