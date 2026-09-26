local model = require("map_tag_generator.planner")
local sources = {}
local machine_types = {"assembling-machine", "furnace", "rocket-silo"}
local render_modes = {"game", "chart"}

function sources.closest(player, draft, key)
    if player.force.index ~= draft.force_index then return nil, {"map-tag-planner.wrong-force"} end
    if player.surface_index ~= draft.surface_index then return nil, {"map-tag-planner.wrong-surface"} end
    local ingredient = model.ingredient(draft, key)
    if not ingredient then return nil, {"map-tag-planner.choose-ingredient"} end
    local surface, force, origin = player.surface, player.force, player.position
    local nearest, distance
    local matching_recipes = {}
    for _, entity in pairs(surface.find_entities_filtered({type = machine_types, force = force})) do
        local recipe = entity.get_recipe()
        if recipe then
            local matches = matching_recipes[recipe.name]
            if matches == nil then
                matches = false
                for _, product in pairs(recipe.products) do
                    if product.type == ingredient.type and product.name == ingredient.name
                        and (not product.probability or product.probability > 0) then matches = true; break end
                end
                matching_recipes[recipe.name] = matches
            end
            if matches then
                local position = entity.position
                local chunk = {x = math.floor(position.x / 32), y = math.floor(position.y / 32)}
                if force.is_chunk_charted(surface, chunk) then
                    local dx, dy = position.x - origin.x, position.y - origin.y
                    local candidate = dx * dx + dy * dy
                    if not nearest or candidate < distance
                        or (candidate == distance and entity.unit_number < nearest.unit_number) then
                        nearest, distance = entity, candidate
                    end
                end
            end
        end
    end
    if not nearest then
        return nil, {"map-tag-planner.no-producer", prototypes[ingredient.type][ingredient.name].localised_name}
    end
    return nearest
end

local function destroy(objects)
    for _, object in ipairs(objects) do if object.valid then object.destroy() end end
end

local function state_for(player)
    local states = storage.recipe_planner.highlights
    if not states[player.index] then states[player.index] = {plans = {}} end
    return states[player.index]
end

local function mark(player, surface, position, objects)
    for _, mode in ipairs(render_modes) do
        objects[#objects + 1] = rendering.draw_circle({surface = surface, target = position,
            color = {0.15, 0.8, 1, 1},
            radius = mode == "chart" and 3 or 1.5, width = mode == "chart" and 24 or 6,
            players = {player.index}, render_mode = mode})
    end
end

function sources.find(player, entity)
    local state = state_for(player)
    if state.guide and state.guide.pin.valid then state.guide.pin.destroy() end
    state.guide = {entity = entity, pin = player.add_pin({entity = entity, always_visible = true}),
        expires = game.tick + 1800}
end

function sources.expire(event)
    for _, state in pairs(storage.recipe_planner.highlights) do
        local guide = state.guide
        if guide and (event.tick >= guide.expires or not guide.entity.valid or not guide.pin.valid) then
            if guide.pin.valid then guide.pin.destroy() end
            state.guide = nil
        end
    end
end

function sources.refresh(player)
    local state = state_for(player)
    destroy(state.plans)
    state.plans = {}
    local enabled = model.preferences(player).highlight_sources
    player.set_shortcut_toggled("map_tag_generator_highlight_sources", enabled)
    if not enabled then return end
    local seen = {}
    local session = storage.recipe_planner.sessions[player.index]
    local draft = session and session.draft
    for _, plan in ipairs(model.list(player)) do
        if draft and draft.id == plan.id and draft.force_index == player.force.index
            and draft.revision == plan.revision then plan = draft end
        local surface = game.surfaces[plan.surface_index]
        if surface then
            for _, ingredient in ipairs(plan.ingredients) do
                for key, position in pairs(ingredient.anchors) do
                    local qualified = plan.surface_index..":"..key
                    if not seen[qualified] then
                        seen[qualified] = true
                        mark(player, surface, position, state.plans)
                    end
                end
            end
        end
    end
end

function sources.refresh_force(force_index)
    for _, player in pairs(game.players) do
        if player.connected and player.force.index == force_index then sources.refresh(player) end
    end
end

function sources.toggle(player)
    local preferences = model.preferences(player)
    preferences.highlight_sources = not preferences.highlight_sources
    sources.refresh(player)
end

function sources.clear(player_index)
    local state = storage.recipe_planner.highlights[player_index]
    if not state then return end
    if state.guide and state.guide.pin.valid then state.guide.pin.destroy() end
    destroy(state.plans)
    storage.recipe_planner.highlights[player_index] = nil
end

return sources
