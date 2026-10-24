-- Independent public-state observation; absent from the primary timing lane.
return function()
    local player = assert(game.get_player(1))
    local x = storage.no_alt_pointer_trial_x
    local helpers_count = 0
    for _, entity in pairs(player.surface.find_entities_filtered({ type = "simple-entity-with-owner" })) do
        if entity.name:find("^no%-alt%-needed%-pointer%-") then
            helpers_count = helpers_count + 1
        end
    end
    local found, unexpected = false, 0
    for _, object in pairs(rendering.get_all_objects("no-alt-needed")) do
        if object.valid and object.type == "sprite" and object.sprite == "recipe/iron-gear-wheel" then
            assert(#object.players == 1 and object.players[1] == player, "Recipe audience leaked")
            local target = object.target
            assert(target.type == "entity" and target.entity.valid)
            local position = target.entity.position
            if x then
                if position.x * x < 0 then
                    unexpected = unexpected + 1
                end
                if math.abs(position.x - (x < 0 and -15 or 15)) < 1 and math.abs(position.y) < 1 then
                    found = true
                end
            else
                unexpected = unexpected + 1
            end
        end
    end
    local enabled = settings.get_player_settings(player)["no-alt-needed-nearby-recipes"].value
    return {
        connected_players = #game.connected_players,
        machines = player.surface.count_entities_filtered({ name = "assembling-machine-3" }),
        active = x and 1 or 0,
        helper_bound_errors = (helpers_count > 1024 or (x and helpers_count == 0)) and 1 or 0,
        disabled_helpers = not enabled and helpers_count or 0,
        missing_focus_recipe = x and not found and 1 or 0,
        unexpected_recipe_icons = unexpected,
        selected_helpers = player.selected and 1 or 0,
    }
end
