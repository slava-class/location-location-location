-- Separate correctness lane. Never imported by the primary timing process.
local function within(entity, point, radius)
    local box = entity.bounding_box
    local nearest_x = math.min(math.max(point.x, box.left_top.x), box.right_bottom.x)
    local nearest_y = math.min(math.max(point.y, box.left_top.y), box.right_bottom.y)
    return (point.x - nearest_x) ^ 2 + (point.y - nearest_y) ^ 2 <= radius ^ 2
end
local function observe()
    local p = assert(game.get_player(1))
    assert(p.connected)
    local surface, selected = p.surface, p.selected
    local mode = assert(surface.name:match("^no%-alt%-needed%-performance%-(.+)$"))
    local values = settings.get_player_settings(p)
    local function setting(name)
        return values["no-alt-needed-" .. name].value
    end
    local machines = surface.find_entities_filtered({ name = "assembling-machine-3" })
    local pumps = surface.find_entities_filtered({ name = "pump" })
    local modules, wanted, allowed, recipe_targets, icons, arrows = 0, {}, {}, {}, {}, {}
    for _, e in ipairs(machines) do
        modules = modules + e.get_module_inventory().get_item_count("speed-module")
        local eligible = selected and within(e, selected.position, setting("recipe-radius"))
        if eligible and (setting("nearby-recipes") or (e == selected and setting("hover"))) then
            allowed[e.unit_number] = e
            if mode ~= "rapid" or e == selected then
                wanted[e.unit_number] = e
            end
        end
    end
    local objects = rendering.get_all_objects("no-alt-needed")
    for _, object in pairs(objects) do
        assert(object.valid and object.surface == surface)
        assert(object.players and #object.players == 1 and object.players[1].index == p.index, "Audience leak")
        if object.type == "sprite" then
            local target = object.target
            if target.type == "entity" then
                local entity = target.entity
                assert(entity.valid, "Retained invalid render target")
                if object.sprite:sub(1, 7) == "recipe/" then
                    assert(allowed[entity.unit_number], "Recipe outside current neighbourhood")
                    local recipe = assert(entity.get_recipe())
                    assert(object.sprite == "recipe/" .. recipe.name, "Stale recipe after refresh deadline")
                    assert(not recipe_targets[entity.unit_number], "Duplicate recipe overlay")
                    recipe_targets[entity.unit_number] = true
                elseif object.sprite == "fluid/water" then
                    icons[entity.unit_number] = true
                elseif object.orientation_target then
                    arrows[entity.unit_number] = true
                end
            end
        end
    end
    local missing_recipes, missing_fluids, missing_arrows, recipe_count = 0, 0, 0, 0
    for id in pairs(wanted) do
        if not recipe_targets[id] then
            missing_recipes = missing_recipes + 1
        end
    end
    for _ in pairs(recipe_targets) do
        recipe_count = recipe_count + 1
    end
    local held = p.cursor_stack and p.cursor_stack.valid_for_read
    local background = setting("fluid-background")
    local expected_fluid_targets = 0
    for _, e in ipairs(pumps) do
        local envelope = within(e, p.position, setting("fluid-search-radius"))
        local detail = setting("fluid-context")
            and selected
            and (e == selected or (held and envelope and within(e, selected.position, setting("fluid-radius"))))
        local want_icons = detail or (envelope and background == "icons")
        local want_arrows = detail or (envelope and background == "arrows")
        if want_icons or want_arrows then
            expected_fluid_targets = expected_fluid_targets + 1
        end
        if want_icons and not icons[e.unit_number] then
            missing_fluids = missing_fluids + 1
        end
        if want_arrows and not arrows[e.unit_number] then
            missing_arrows = missing_arrows + 1
        end
    end
    if not selected and expected_fluid_targets == 0 then
        assert(#objects == 0, "Idle scene retained renderings")
    end
    helpers.write_file("no-alt-performance-frames.jsonl", helpers.table_to_json({
        tick = game.tick,
        selected = selected and selected.unit_number or 0,
        selected_visible = selected and p.force.is_chunk_visible(surface, {
            math.floor(selected.position.x / 32),
            math.floor(selected.position.y / 32),
        }) or false,
        opened = p.opened_gui_type,
        render_mode = p.render_mode,
        alt = p.game_view_settings.show_entity_info,
        held = held and p.cursor_stack.name or "",
        position = p.position,
        hover = setting("hover"),
        fluid_context = setting("fluid-context"),
        background = background,
        hidden = selected and selected.prototype.has_flag("hide-alt-info") or false,
        declutter = prototypes.mod_data["no-alt-needed-fluids"].data.declutter,
        owned = prototypes.mod_data["no-alt-needed-fluids"].data.has_owned,
        objects = #objects,
        recipes = recipe_count,
        expected_fluid_targets = expected_fluid_targets,
        missing_fluids = missing_fluids,
        missing_arrows = missing_arrows,
    }) .. "\n", true)
    return {
        machines = #machines,
        pumps = #pumps,
        modules = modules,
        connected_players = #game.connected_players,
        selected_players = selected and 1 or 0,
        missing_recipes = missing_recipes,
        missing_fluids = missing_fluids,
        missing_arrows = missing_arrows,
    }
end

-- Resolve initial fluid-discovery latency without charging observation to the
-- primary lane. Stop collection after a bounded two-second simulation window.
local sampled = 0
script.on_nth_tick(1, function()
    sampled = sampled + 1
    local name = assert(game.get_player(1)).surface.name
    if sampled > 120 or not (name:match("%-construction$") or name:match("%-background$")) then
        script.on_nth_tick(1, nil)
        return
    end
    observe()
end)
return observe
