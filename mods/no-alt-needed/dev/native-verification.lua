-- Injected only into disposable sessions by the product-owned verifier.
-- No production testing interface, FactorioTest or synthetic connected player.
local V = {}
local surface_name = "no-alt-needed-verification"
local function surface()
    return (assert(game.surfaces[surface_name], "Missing owned verification surface"))
end
local function fixture_entities(filter)
    local result = surface().find_entities_filtered(filter)
    for index = #result, 1, -1 do
        if result[index].name:find("^no%-alt%-needed%-pointer%-") then
            assert(script.active_mods["no-alt-needed"], "Helpers survived product removal")
            table.remove(result, index)
        end
    end
    return result
end
local function entity(position)
    local found = fixture_entities({ position = position, radius = 1, force = "player" })
    assert(#found == 1, "Expected one fixture entity near " .. helpers.table_to_json(position) .. "; found " .. #found)
    return found[1]
end
local function player(index)
    return (assert(game.get_player(index), "Missing native client player"))
end
local function power_fixture(e)
    local y = e.position.y + e.prototype.selection_box.right_bottom.y + 2
    assert(surface().create_entity({ name = "substation", position = { e.position.x, y }, force = e.force }))
    local supply = assert(surface().create_entity({
        name = "electric-energy-interface",
        position = { e.position.x + 3, y },
        force = e.force,
    }))
    supply.electric_buffer_size, supply.power_production, supply.energy = 1000000000, 1000000000, 1000000000
end
local function objects(list, index)
    local count = 0
    for _, object in pairs(list or {}) do
        if object.valid then
            assert(
                object.players and #object.players == 1 and object.players[1].index == index,
                "Cross-player rendering leak"
            )
            count = count + 1
        end
    end
    return count
end
local function populate_pipes(e)
    -- These fixtures compare presentation, not production or fluid consumption.
    e.disabled_by_script = true
    for index = 1, e.fluids_count do
        local filter = e.get_fluid_filter(index)
        if filter then
            local name = type(filter.fluid) == "string" and filter.fluid or filter.fluid.name
            local capacity = e.get_fluid_capacity(index)
            assert(e.set_fluid(index, { name = name, amount = capacity }) == capacity)
            for _, connection in ipairs(e.get_fluid_box_pipe_connections(index)) do
                if connection.connection_type == "normal" then
                    local pipe = assert(surface().create_entity({
                        name = "pipe",
                        position = connection.target_position,
                        force = e.force,
                        raise_built = true,
                    }))
                    assert(pipe.insert_fluid({ name = name, amount = 50 }) > 0)
                end
            end
        end
    end
end

function V.create()
    assert(not game.surfaces[surface_name], "Never overwrite a fixture")
    local s = game.create_surface(surface_name, {
        width = 256,
        height = 256,
        seed = 1729,
        default_enable_all_autoplace_controls = false,
        autoplace_settings = {
            entity = { treat_missing_as_default = false },
            decorative = { treat_missing_as_default = false },
        },
    })
    s.request_to_generate_chunks({ 0, 0 }, 2)
    s.force_generate_chunk_requests()
    local tiles = {}
    for x = -64, 63 do
        for y = -64, 63 do
            tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
        end
    end
    s.set_tiles(tiles)
    s.daytime, s.freeze_daytime = 0, true
    local force = player(1).force --[[@as LuaForce]]
    for _, definition in ipairs({
        { "assembling-machine-2", { 0, 0 }, "iron-gear-wheel" },
        { "assembling-machine-2", { 5, 0 }, "copper-cable" },
        { "pump", { 0, 7 } },
        { "steel-chest", { -5, 0 } },
        { "transport-belt", { 0, -4 } },
        { "entity-ghost", { 10, 0 }, "iron-gear-wheel", "assembling-machine-2" },
        { "inserter", { 12, 8 } },
        { "splitter", { 16, 8 } },
        { "substation", { 6, -5 } },
        { "substation", { 6, 8 } },
        { "electric-energy-interface", { 6, -9 } },
    }) do
        local e = assert(s.create_entity({
            name = definition[1],
            inner_name = definition[4],
            position = definition[2],
            force = force,
            raise_built = true,
        }))
        if definition[3] then
            force.recipes[definition[3]].enabled = true
            e.set_recipe(definition[3])
            assert(e.get_recipe().name == definition[3])
        end
        if e.name == "steel-chest" then
            assert(e.insert({ name = "iron-plate", count = 17 }) == 17)
        end
        if e.name == "inserter" then
            e.use_filters = true
            e.set_filter(1, { name = "coal", quality = "normal", comparator = "=" })
            assert(e.get_filter(1).name == "coal")
        end
        if e.type == "splitter" then
            e.splitter_filter = { name = "iron-plate", quality = "normal" }
            e.splitter_output_priority = "right"
        end
        if e.name == "pump" then
            assert(e.set_fluid_filter(1, { fluid = "water" }))
            populate_pipes(e)
        end
        if e.name == "electric-energy-interface" then
            e.electric_buffer_size, e.power_production, e.energy = 1000000000, 1000000000, 1000000000
        end
        local fuel = e.get_fuel_inventory()
        if fuel then
            assert(fuel.insert({ name = "coal", count = 10 }) == 10, "Fixture burner needs supported fuel")
        end
    end
    force.chart(s, { { -96, -96 }, { 96, 96 } })
    return V.factory()
end
function V.factory()
    local result = {}
    for _, e in pairs(fixture_entities({ force = "player" })) do
        local recipe = (e.type == "assembling-machine" or e.type == "entity-ghost") and e.get_recipe()
        local items = {}
        local inventory = e.type == "container" and e.get_inventory(defines.inventory.chest)
        if e.type == "container" and inventory then
            for _, item in pairs(inventory.get_contents()) do
                items[#items + 1] = { item.name, item.count, item.quality }
            end
            table.sort(items, function(a, b)
                return a[1] < b[1]
            end)
        end
        result[#result + 1] =
            { e.name, e.unit_number or 0, e.position.x, e.position.y, e.direction, recipe and recipe.name or "", items }
    end
    table.sort(result, function(a, b)
        return a[2] < b[2]
    end)
    return helpers.table_to_json(result)
end
function V.prepare(indices)
    local s = surface()
    for _, index in ipairs(indices) do
        local p = player(index)
        assert(p.connected, "A real connected client is required")
        p.set_controller({ type = defines.controllers.god })
        assert(p.teleport({ 0, 0 }, s))
        p.zoom = 1.5
        p.opened = nil
        p.clear_cursor()
        p.game_view_settings = { update_entity_selection = false, show_entity_info = false }
        p.selected = nil
    end
    game.forces.player.chart(s, { { -96, -96 }, { 96, 96 } })
    return game.tick
end
function V.visible(position)
    position = position or { x = 0, y = 0 }
    return game.forces.player.is_chunk_visible(surface(), { math.floor(position.x / 32), math.floor(position.y / 32) })
end
function V.select(input)
    local p = player(input.player)
    p.selected = input.position and entity(input.position) or nil
    assert((p.selected ~= nil) == (input.position ~= nil), "Engine rejected selection")
    return game.tick
end
function V.alt(input)
    local p = player(input.player)
    p.game_view_settings = { show_entity_info = input.value }
    if script.active_mods["no-alt-needed"] then
        assert(script.mod_name == "no-alt-needed", "Scripted ALT changes require the product's event context")
        -- Setting the flag is not a keyboard event. Exercise the registered
        -- handler explicitly so an idle player wakes when custom ALT resumes.
        local event = defines.events.on_player_toggled_alt_mode
        assert(script.get_event_handler(event))({
            name = event,
            tick = game.tick,
            player_index = p.index,
            alt_mode = input.value,
        })
    end
    return game.tick
end
function V.setting(input)
    settings.get_player_settings(player(input.player))["no-alt-needed-" .. input.name] = { value = input.value }
    return game.tick
end
function V.defaults(indices)
    for _, index in ipairs(indices) do
        local values = settings.get_player_settings(player(index))
        for _, name in ipairs({
            "no-alt-needed-recipe-radius",
            "no-alt-needed-nearby-recipes",
            "no-alt-needed-experiment-nearby-focus",
            "no-alt-needed-inserter-capacity",
            "no-alt-needed-warnings",
            "no-alt-needed-warning-inserters",
            "no-alt-needed-warning-drills",
            "no-alt-needed-warning-fluids",
            "no-alt-needed-warning-ignored",
        }) do
            values[name] = { value = prototypes.mod_setting[name].default_value }
        end
    end
    return game.tick
end
function V.open(input)
    player(input.player).opened = input.value and entity({ 0, 0 }) or nil
    return game.tick
end
function V.hold(input)
    local p = player(input.player)
    p.clear_cursor()
    if input.name then
        assert(p.cursor_stack.set_stack({ name = input.name, count = 1 }))
    end
    return game.tick
end
function V.remote(input)
    local p = player(input.player)
    if input.enabled then
        local remote = game.surfaces["no-alt-needed-remote"]
        if not remote then
            remote = game.create_surface("no-alt-needed-remote", { width = 64, height = 64 })
            remote.request_to_generate_chunks({ 0, 0 }, 1)
            remote.force_generate_chunk_requests()
        end
        p.set_controller({ type = defines.controllers.remote, surface = remote, position = { 0, 0 } })
    else
        p.set_controller({ type = defines.controllers.god })
        assert(p.teleport({ 0, 0 }, surface()))
    end
    p.selected = nil
    return game.tick
end
function V.nativeFluids()
    local result = {}
    for _, name in ipairs({ "pump", "boiler" }) do
        local flags = {}
        for _, box in ipairs(prototypes.entity[name].fluidbox_prototypes) do
            for _, port in ipairs(box.pipe_connections) do
                flags[#flags + 1] = port.hide_connection_info or false
            end
        end
        result[name] = flags
    end
    return result
end
function V.observe(indices)
    local result = { tick = game.tick, players = {}, renderCount = 0, audienceErrors = 0 }
    local renderings = rendering.get_all_objects(script.mod_name)
    for _, object in pairs(renderings) do
        if object.valid then
            result.renderCount = result.renderCount + 1
            if not object.players or #object.players ~= 1 then
                result.audienceErrors = result.audienceErrors + 1
            end
        end
    end
    for _, index in ipairs(indices) do
        local p = player(index)
        local state = assert(storage.players[index], "Product has not initialized this native player")
        local pointer_cells = 0
        for _, target in pairs(state.pointer.cells or {}) do
            assert(target.valid and target.render_player == p, "Pointer helper lost its owner")
            pointer_cells = pointer_cells + 1
        end
        assert(pointer_cells <= 1024, "Pointer population exceeded its viewport bound")
        local nearby, fluids = 0, 0
        for _, entry in pairs(state.nearby.entries or {}) do
            nearby = nearby + objects(entry.render.objects, index)
        end
        for _, record in pairs(state.fluid.records or {}) do
            fluids = fluids + objects(record.objects, index)
        end
        local warnings = 0
        for _, record in pairs(state.warnings.records or {}) do
            warnings = warnings + objects(record.objects, index)
        end
        local selected_warnings = state.warnings.selected_record
        local recipe = ""
        for _, object in pairs(renderings) do
            if object.valid and object.visible and object.type == "sprite" and object.sprite:sub(1, 7) == "recipe/" then
                local target, audience = object.target, object.players
                if
                    target.type == "entity"
                    and target.entity == p.selected
                    and audience
                    and #audience == 1
                    and audience[1].index == index
                then
                    assert(recipe == "", "The selected recipe must not be drawn twice")
                    recipe = object.sprite:sub(8)
                end
            end
        end
        local names = 0
        if p.selected then
            for _, field in pairs(p.selected.get_tooltip_fields()) do
                if type(field.name) == "table" and field.name[1] == "recipe-name-tooltip.recipe" then
                    names = names + 1
                end
            end
        end
        result.players[#result.players + 1] = {
            index = index,
            connected = p.connected,
            locale = p.locale,
            surface = p.surface.name,
            selected = p.selected and p.selected.unit_number or 0,
            ghost = p.selected ~= nil and p.selected.type == "entity-ghost",
            recipeNames = names,
            alt = p.game_view_settings.show_entity_info,
            active = storage.active[index] == true,
            exact = objects(state.exact.objects, index),
            pointerCells = pointer_cells,
            pointerFocus = state.pointer.point,
            pointerPending = state.pointer.remaining or 0,
            pointerCellSize = state.pointer.size,
            nearby = nearby,
            fluids = fluids,
            warnings = warnings,
            selectedWarnings = selected_warnings and objects(selected_warnings.objects, index) or 0,
            warningMode = state.preferences.warnings,
            nativeWarningMode = settings.get_player_settings(p)["no-alt-needed-warnings"].value,
            capacity = state.capacity.object and state.capacity.object.valid and state.capacity.snapshot or nil,
            recipe = recipe,
            radius = state.preferences.radius,
            nearbyEnabled = state.preferences.nearby,
            nativeNearby = settings.get_player_settings(p)["no-alt-needed-nearby-recipes"].value,
            nativeRadius = settings.get_player_settings(p)["no-alt-needed-recipe-radius"].value,
            focus = state.preferences.nearby_focus,
            nativeFocus = settings.get_player_settings(p)["no-alt-needed-experiment-nearby-focus"].value,
        }
    end
    return result
end
function V.pipeIcons(index)
    local p = player(index)
    local selected = assert(p.selected)
    local record = assert(storage.players[index].fluid.records[selected.unit_number])
    local count = 0
    for _, port in ipairs(record.snapshot.ports) do
        for _, connection in ipairs(selected.get_fluid_box_pipe_connections(port.storage_index)) do
            local pipe = connection.target
            if
                pipe
                and pipe.type == "pipe"
                and math.abs(connection.position.x - selected.position.x - port.position.x) < 0.000001
                and math.abs(connection.position.y - selected.position.y - port.position.y) < 0.000001
            then
                local fluid = assert(
                    pipe.get_fluid_segment_fluid(1),
                    "Native pipe comparison requires actual fluid in the connected segment"
                )
                local specification = pipe.prototype.icon_draw_specification
                local shift = specification.shift
                local x = pipe.position.x + (shift.x or shift[1])
                local y = pipe.position.y + (shift.y or shift[2])
                local matched = false
                for _, object in ipairs(record.objects) do
                    if object.type == "sprite" and object.sprite == "fluid/" .. fluid.name then
                        local anchor = object.target
                        local offset = assert(anchor.offset)
                        local position = assert(anchor.entity).position
                        if
                            math.abs(position.x + (offset.x or offset[1]) - x) < 0.000001
                            and math.abs(position.y + (offset.y or offset[2]) - y) < 0.000001
                            and math.abs(object.x_scale - specification.scale * 0.9) < 0.000001
                            and math.abs(object.y_scale - specification.scale * 0.9) < 0.000001
                        then
                            matched = true
                        end
                    end
                end
                assert(matched, "Connected fluid icon does not match the actual pipe's native ALT geometry")
                count = count + 1
            end
        end
    end
    assert(count > 0, "Native comparison must exercise populated connected pipes")
    return count
end

function V.frame(input)
    local p = player(input.player)
    assert(p.teleport(input.position or { 1, 1 }, p.surface), "Could not frame the native view")
    p.zoom = input.zoom or 1.5
    return game.tick
end

function V.ownerProbeStart(index)
    assert(script.mod_name == "level", "Permission probe must run from the disposable scenario, not the setting owner")
    assert(storage.no_alt_owner_probe == nil)
    local event_id = defines.events.on_tick
    local previous = script.get_event_handler(event_id)
    script.on_event(event_id, function(event)
        script.on_event(event_id, previous)
        if previous then
            previous(event)
        end
        local name, interface = "no-alt-needed-hover", "no-alt-needed-experiments"
        local values = settings.get_player_settings(player(index))
        local original = values[name].value
        local direct = pcall(function()
            values[name] = { value = not original }
        end)
        local unchanged = values[name].value == original
        local changed = remote.call(interface, "set", index, name, not original)
        local restored = remote.call(interface, "set", index, name, original)
        local invalid = pcall(remote.call, interface, "set", index, "no-alt-needed-fluid-declutter", false)
        storage.no_alt_owner_probe = {
            caller = script.mod_name,
            directRejected = not direct and unchanged,
            ownerApplied = changed == not original,
            restored = restored == original and values[name].value == original,
            rejectedStartup = not invalid,
        }
    end)
    return game.tick
end
function V.ownerProbeReady()
    return storage.no_alt_owner_probe ~= nil
end
function V.ownerProbeResult()
    local result = assert(storage.no_alt_owner_probe)
    storage.no_alt_owner_probe = nil
    return result
end

function V.capture(input)
    local p = player(input.player)
    game.take_screenshot({
        player = p,
        by_player = p,
        surface = p.surface,
        position = p.position,
        resolution = { p.display_resolution.width, p.display_resolution.height },
        zoom = p.zoom,
        path = input.path,
        show_gui = true,
        show_entity_info = p.game_view_settings.show_entity_info,
        anti_alias = true,
        force_render = true,
    })
    game.set_wait_for_screenshots_to_finish()
    return {
        width = p.display_resolution.width,
        height = p.display_resolution.height,
        scale = p.display_scale,
        locale = p.locale,
        zoom = p.zoom,
    }
end
function V.farms()
    local choices = {}
    for name, prototype in pairs(prototypes.entity) do
        if
            prototype.type == "assembling-machine"
            and (name:find("farm", 1, true) or name:find("plantation", 1, true) or name:find("crop", 1, true))
        then
            local count = prototype.module_inventory_size
            if count == 10 or count == 20 or count == 30 or count == 40 then
                choices[#choices + 1] = { name = name, slots = count }
            end
        end
    end
    table.sort(choices, function(a, b)
        return a.name < b.name
    end)
    local result, seen, edge = {}, {}, -40
    for _, choice in ipairs(choices) do
        if not seen[choice.slots] then
            local prototype = prototypes.entity[choice.name]
            local box = prototype.collision_box
            local position = { x = edge - box.left_top.x, y = 40 }
            edge = position.x + box.right_bottom.x + 1
            local e = assert(surface().create_entity({ name = choice.name, position = position, force = "player" }))
            power_fixture(e)
            local recipes = {}
            for name, recipe in pairs(prototypes.recipe) do
                for _, category in ipairs(recipe.categories) do
                    if prototype.crafting_categories[category] then
                        recipes[#recipes + 1] = name
                        break
                    end
                end
            end
            table.sort(recipes)
            local recipe = assert(recipes[1], "Native farm must have a recipe")
            local force = e.force
            force.recipes[recipe].enabled = true
            e.set_recipe(recipe)
            assert(e.get_recipe() and e.get_recipe().name == recipe, "Native farm rejected its fixture recipe")
            local inventory = assert(e.get_module_inventory())
            local names = {}
            for name, item in pairs(prototypes.item) do
                if item.type == "module" then
                    names[#names + 1] = name
                end
            end
            table.sort(names)
            local selected
            for _, name in ipairs(names) do
                if inventory.can_insert({ name = name, count = choice.slots }) then
                    selected = name
                    break
                end
            end
            assert(selected, "No valid native module for " .. choice.name)
            assert(inventory.insert({ name = selected, count = choice.slots }) == choice.slots)
            seen[choice.slots] = true
            result[#result + 1] = {
                name = choice.name,
                slots = choice.slots,
                module = selected,
                position = position,
                recipe = recipe,
                unit = e.unit_number,
            }
        end
    end
    assert(#result == 4, "Native pY closure must provide 10/20/30/40-slot farm fixtures")
    return result
end
function V.storageFixture(kind)
    local choices = {}
    for name, prototype in pairs(prototypes.entity) do
        if prototype.type == kind and name:sub(1, 3) == "py-" and not prototype.hidden then
            local box = prototype.collision_box
            choices[#choices + 1] = { name = name, width = box.right_bottom.x - box.left_top.x }
        end
    end
    table.sort(choices, function(a, b)
        return a.width == b.width and a.name < b.name or a.width > b.width
    end)
    local choice = assert(choices[1], "Missing native pY storage fixture: " .. kind)
    local position = { x = kind == "container" and -25 or 0, y = -35 }
    local e = assert(surface().create_entity({ name = choice.name, position = position, force = "player" }))
    if kind == "container" then
        for _, stack in ipairs({
            { name = "iron-plate", count = 17 },
            { name = "copper-plate", count = 23 },
            { name = "coal", count = 31 },
        }) do
            assert(e.insert(stack) == stack.count)
        end
    else
        assert(e.insert_fluid({ name = "water", amount = 1000 }) == 1000)
    end
    return { name = e.name, unit = e.unit_number, position = e.position, recipe = "" }
end
function V.fluidFixture()
    local prototype = assert(prototypes.entity["gasifier"], "Missing native pY gasifier fixture")
    local e = assert(surface().create_entity({ name = prototype.name, position = { 0, -60 }, force = "player" }))
    power_fixture(e)
    local recipes = {}
    for name, recipe in pairs(prototypes.recipe) do
        local fluids = 0
        for _, product in ipairs(recipe.products) do
            if product.type == "fluid" then
                fluids = fluids + 1
            end
        end
        if fluids >= 2 then
            for _, category in ipairs(recipe.categories) do
                if prototype.crafting_categories[category] then
                    recipes[#recipes + 1] = name
                    break
                end
            end
        end
    end
    table.sort(recipes)
    local recipe = assert(recipes[1], "Native gasifier must have a multiple-fluid recipe")
    e.force.recipes[recipe].enabled = true
    e.set_recipe(recipe)
    assert(e.get_recipe() and e.get_recipe().name == recipe)
    populate_pipes(e)
    return { name = e.name, unit = e.unit_number, position = e.position, recipe = recipe }
end
function V.pointerZoom(input)
    player(input.player).zoom = input.zoom
    return game.tick
end

function V.pointerProbe(indices)
    for step = 1, 100 do
        for offset, index in ipairs(indices) do
            local p = player(index)
            local x = (step + offset) % 2 == 0 and -9 or 9
            p.update_selected_entity({ x, -5 })
            local state = assert(storage.players[index]).pointer
            assert(not p.selected, "An invisible helper retained a tooltip or selection box")
            assert(state.point and state.point.x == x and state.point.y == -5, "Empty-ground focus did not follow")
            assert(p.game_view_settings.show_entity_tooltip, "Normal native tooltips were disabled")
        end
    end
    assert(storage.players[indices[1]].pointer.point.x ~= storage.players[indices[2]].pointer.point.x)
    return true
end

function V.physical(input)
    local p = player(input.player)
    p.selected = nil
    p.game_view_settings = { update_entity_selection = true, show_entity_info = false }
    return game.tick
end
function V.replacedObjects()
    local result = {}
    for _, owner in ipairs({ "inserter-throughput-fork", "fluid-connection-indicators" }) do
        assert(script.active_mods[owner], "The replacement reference must be genuinely loaded")
        local ids = {}
        for _, object in ipairs(rendering.get_all_objects(owner)) do
            if object.valid and object.visible then
                ids[#ids + 1] = object.id
            end
        end
        table.sort(ids)
        result[owner] = ids
    end
    return result
end
function V.replacedObjectsRemoved(groups)
    for owner, ids in pairs(groups) do
        assert(not script.active_mods[owner], "A replaced owner is still enabled")
        for _, id in ipairs(ids) do
            if rendering.get_object_by_id(id) then
                return false
            end
        end
    end
    return true
end
return V
