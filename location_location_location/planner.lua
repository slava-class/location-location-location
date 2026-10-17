local util = require("__core__.lualib.util")
local planner = {}

---@alias ConnectionDirection "input"|"output"
---@class ConnectionPlan
---@field key string
---@field type "item"|"fluid"
---@field name string
---@field anchors table<string, MapPosition.struct>

---@class RecipePlan
---@field id integer?
---@field revision integer
---@field force_index integer
---@field surface_index integer
---@field recipes string[]
---@field title string
---@field hide_label boolean? Hide map-tag text without discarding the list name.
---@field ingredients ConnectionPlan[]
---@field outputs ConnectionPlan[]
---@field tag LuaCustomChartTag?
---@field retired boolean
---@field marker_position MapPosition.struct? Explicit marker location; nil follows the source-based suggestion.

local function migrate_single_recipe(plan)
    ---@cast plan table
    plan.recipes = plan.recipe and { plan.recipe } or {}
    plan.recipe, plan.outputs = nil, {}
    -- Missing prototypes keep their saved anchors until the player removes that recipe.
    planner.set_recipes(plan, plan.recipes)
end

function planner.initialize()
    ---@type LLLState?
    local state = storage.location_location_location
    if not state then
        storage.location_location_location = {
            schema_version = 2,
            next_id = 1,
            plans = {},
            sessions = {},
            preferences = {},
            highlights = {},
        }
    elseif not state.schema_version then
        -- One-time migration from released single-recipe saves, not a runtime fallback.
        for _, plan in pairs(state.plans) do
            migrate_single_recipe(plan)
        end
        for _, session in pairs(state.sessions) do
            if session.draft then
                migrate_single_recipe(session.draft)
            end
        end
        state.schema_version = 2
    end
end

---@param player LuaPlayer
---@return LLLPreferences
function planner.preferences(player)
    local preferences = storage.location_location_location.preferences
    if not preferences[player.index] then
        preferences[player.index] = { researched_only = true, show_retired = false, highlight_sources = false }
    end
    return preferences[player.index]
end

---@param player LuaPlayer
---@return RecipePlan
function planner.new(player)
    local force_index = player.force.index
    ---@cast force_index integer
    return {
        revision = 0,
        force_index = force_index,
        surface_index = player.surface_index,
        recipes = {},
        title = "",
        hide_label = true,
        ingredients = {},
        outputs = {},
        retired = false,
    }
end

---@param draft RecipePlan
---@return string
function planner.default_title(draft)
    return table.concat(draft.recipes, " + ")
end

---@param draft RecipePlan
---@param name string
---@return boolean
function planner.has_recipe(draft, name)
    for _, selected in ipairs(draft.recipes) do
        if selected == name then
            return true
        end
    end
    return false
end

---@param draft RecipePlan
---@return boolean
function planner.valid_recipes(draft)
    if #draft.recipes == 0 then
        return false
    end
    for _, name in ipairs(draft.recipes) do
        if not prototypes.recipe[name] then
            return false
        end
    end
    return true
end

---@param names string[]
---@param previous ConnectionPlan[]
---@param direction ConnectionDirection
---@return ConnectionPlan[]
local function collect_connections(names, previous, direction)
    local anchors, seen, connections = {}, {}, {}
    for _, connection in ipairs(previous) do
        anchors[connection.key] = connection.anchors
    end
    for _, name in ipairs(names) do
        local recipe = prototypes.recipe[name]
        local entries = direction == "input" and recipe.ingredients or recipe.products
        for _, entry in ipairs(entries) do
            local key = entry.type .. "/" .. entry.name
            local possible = direction == "input"
                or (entry.independent_probability > 0 and entry.shared_probability.max > entry.shared_probability.min)
            if possible and not seen[key] then
                seen[key] = true
                connections[#connections + 1] =
                    { key = key, type = entry.type, name = entry.name, anchors = anchors[key] or {} }
            end
        end
    end
    return connections
end

---@param draft RecipePlan
---@param names string[]
---@return boolean, LocalisedString?
function planner.set_recipes(draft, names)
    local selected, seen, available = {}, {}, true
    for _, name in ipairs(names) do
        if not prototypes.recipe[name] then
            if not planner.has_recipe(draft, name) then
                return false, { "location-location-location.missing-recipe" }
            end
            available = false
        end
        if not seen[name] then
            seen[name] = true
            selected[#selected + 1] = name
        end
    end
    local automatic_title = draft.title == "" or draft.title == planner.default_title(draft)
    -- Unknown recipes must remain removable one at a time without losing saved anchors.
    local ingredients = available and collect_connections(selected, draft.ingredients, "input") or draft.ingredients
    local outputs = available and collect_connections(selected, draft.outputs, "output") or draft.outputs
    draft.recipes, draft.ingredients, draft.outputs = selected, ingredients, outputs
    if automatic_title then
        draft.title = planner.default_title(draft)
    end
    return true
end

---@param plan RecipePlan
---@return RecipePlan
function planner.copy(plan)
    return {
        id = plan.id,
        revision = plan.revision,
        force_index = plan.force_index,
        surface_index = plan.surface_index,
        recipes = util.table.deepcopy(plan.recipes),
        title = plan.title,
        hide_label = plan.hide_label,
        ingredients = util.table.deepcopy(plan.ingredients),
        outputs = util.table.deepcopy(plan.outputs),
        retired = plan.retired,
        marker_position = plan.marker_position and { x = plan.marker_position.x, y = plan.marker_position.y } or nil,
    }
end

---@param player LuaPlayer
---@param id integer
---@return RecipePlan?, LocalisedString?
function planner.load(player, id)
    local plan = storage.location_location_location.plans[id]
    if not plan or plan.force_index ~= player.force.index then
        return nil, { "location-location-location.missing-plan" }
    end
    local draft = planner.copy(plan)
    -- Recipe updates retain only still-applicable assignments on each side of the site.
    if planner.valid_recipes(draft) then
        planner.set_recipes(draft, draft.recipes)
    end
    return draft
end

---@param player LuaPlayer
---@param include_retired boolean?
---@return RecipePlan[]
function planner.list(player, include_retired)
    local plans = {}
    for _, plan in pairs(storage.location_location_location.plans) do
        if plan.force_index == player.force.index and (include_retired or not plan.retired) then
            plans[#plans + 1] = plan
        end
    end
    table.sort(plans, function(a, b)
        return a.id < b.id
    end)
    return plans
end

local function same_position(a, b)
    return a == b or (a ~= nil and b ~= nil and a.x == b.x and a.y == b.y)
end

local function same_anchors(a, b)
    if not a then
        return not b or next(b) == nil
    end
    if not b then
        return next(a) == nil
    end
    for key, position in pairs(a) do
        if not same_position(position, b[key]) then
            return false
        end
    end
    for key in pairs(b) do
        if not a[key] then
            return false
        end
    end
    return true
end

local function custom_title(draft)
    if not draft then
        return nil
    end
    local title = draft.title:match("^%s*(.-)%s*$")
    return title ~= "" and title ~= planner.default_title(draft) and title or nil
end

--- Net edits: recipe selection, custom name, label visibility, placement, and each changed connection.
--- An automatic title update belongs to the recipe edit, not a second edit.
---@return integer
---@param player LuaPlayer
---@param draft RecipePlan
function planner.change_count(player, draft)
    local saved = draft.id and storage.location_location_location.plans[draft.id]
    if saved and saved.force_index ~= player.force.index then
        saved = nil
    end
    local count = 0
    if #draft.recipes ~= (saved and #saved.recipes or 0) then
        count = 1
    else
        for index, name in ipairs(draft.recipes) do
            if not saved or saved.recipes[index] ~= name then
                count = 1
                break
            end
        end
    end
    if custom_title(draft) ~= custom_title(saved) then
        count = count + 1
    end
    local saved_hide_label = saved == nil or saved.hide_label == true
    if (draft.hide_label == true) ~= saved_hide_label then
        count = count + 1
    end
    if
        not same_position(draft.marker_position, saved and saved.marker_position)
        or (saved and draft.surface_index ~= saved.surface_index)
    then
        count = count + 1
    end
    for _, connection, direction in planner.connections(draft) do
        local previous = saved and planner.connection(saved, direction, connection.key)
        if not same_anchors(connection.anchors, previous and previous.anchors) then
            count = count + 1
        end
    end
    if saved then
        for _, previous, direction in planner.connections(saved) do
            if not planner.connection(draft, direction, previous.key) and next(previous.anchors) then
                count = count + 1
            end
        end
    end
    return count
end

---@param draft RecipePlan
---@param direction ConnectionDirection
---@param key string
---@return ConnectionPlan?
function planner.connection(draft, direction, key)
    for _, connection in ipairs(direction == "input" and draft.ingredients or draft.outputs) do
        if connection.key == key then
            return connection
        end
    end
end

---@param draft RecipePlan
---@param index integer
---@return integer?, ConnectionPlan?, ConnectionDirection?
local function next_connection(draft, index)
    index = index + 1
    if index <= #draft.ingredients then
        return index, draft.ingredients[index], "input"
    end
    local output = draft.outputs[index - #draft.ingredients]
    if output then
        return index, output, "output"
    end
end

---@param draft RecipePlan
function planner.connections(draft)
    return next_connection, draft, 0
end

local function anchor_key(entity)
    -- Anchors represent places, not live entities: overlapping drags and replacement
    -- entities at the same position address the same saved point.
    return entity.position.x .. ":" .. entity.position.y
end

---@param draft RecipePlan
---@param direction ConnectionDirection
---@param key string
---@param entities LuaEntity[]
---@param mode "replace"|"add"|"remove"
---@param surface_index integer
---@return boolean, LocalisedString?
function planner.select(draft, direction, key, entities, mode, surface_index)
    if surface_index ~= draft.surface_index then
        return false, { "location-location-location.wrong-surface" }
    end
    local connection = planner.connection(draft, direction, key)
    if not connection then
        return false, { "location-location-location.choose-connection" }
    end
    if mode == "replace" then
        connection.anchors = {}
    end
    for _, entity in pairs(entities) do
        if entity.valid and entity.surface.index == draft.surface_index then
            local position = entity.position
            ---@cast position MapPosition.struct
            local position_key = anchor_key(entity)
            if mode == "remove" then
                connection.anchors[position_key] = nil
            else
                connection.anchors[position_key] = { x = position.x, y = position.y }
            end
        end
    end
    return true
end

---@param draft RecipePlan
---@return MapPosition.struct?, integer, integer
function planner.center(draft)
    ---@type number, number, integer
    local x, y, assigned = 0, 0, 0
    for _, connection in planner.connections(draft) do
        ---@type number, number, integer
        local sx, sy, count = 0, 0, 0
        for _, position in pairs(connection.anchors) do
            sx, sy, count = sx + position.x, sy + position.y, count + 1
        end
        if count > 0 then
            x, y, assigned = x + sx / count, y + sy / count, assigned + 1
        end
    end
    if assigned == 0 then
        return nil, 0, #draft.ingredients + #draft.outputs
    end
    return { x = x / assigned, y = y / assigned }, assigned, #draft.ingredients + #draft.outputs
end

---@param draft RecipePlan
---@return MapPosition.struct?, integer, integer
function planner.position(draft)
    local suggested, assigned, total = planner.center(draft)
    return draft.marker_position or suggested, assigned, total
end

---@param player LuaPlayer
---@param draft RecipePlan
---@return RecipePlan?, LocalisedString?
local function current_plan(player, draft)
    if player.force.index ~= draft.force_index then
        return nil, { "location-location-location.wrong-force" }
    end
    if not draft.id then
        return nil
    end
    local current = storage.location_location_location.plans[draft.id]
    if not current or current.force_index ~= player.force.index then
        return nil, { "location-location-location.missing-plan" }
    end
    if current.revision ~= draft.revision then
        return nil, { "location-location-location.conflict" }
    end
    return current
end

---@param player LuaPlayer
---@param draft RecipePlan
---@return RecipePlan?, LocalisedString?
function planner.apply(player, draft)
    local current, err = current_plan(player, draft)
    if err then
        return nil, err
    end
    if not planner.valid_recipes(draft) then
        return nil, { "location-location-location.missing-recipe" }
    end
    local surface = game.surfaces[draft.surface_index]
    if not surface then
        return nil, { "location-location-location.missing-surface" }
    end
    local position, assigned, total = planner.position(draft)
    local title = draft.title:match("^%s*(.-)%s*$")
    if title == "" then
        title = planner.default_title(draft)
    end
    local text = draft.hide_label and "" or title
    if not draft.hide_label and assigned < total then
        text = text .. " [" .. assigned .. "/" .. total .. "]"
    end
    local recipe = prototypes.recipe[draft.recipes[1]]
    ---@cast recipe LuaRecipePrototype
    local product = recipe.main_product or recipe.products[1]
    local icon = product and { type = product.type, name = product.name } or nil
    local tag = current and current.tag
    if not position then
        if tag and tag.valid and tag.force == player.force then
            tag.destroy()
        end
        tag = nil
    elseif tag and tag.valid and tag.force == player.force then
        tag.surface = surface
        tag.position, tag.text, tag.icon, tag.last_user = position, text, icon, player
    else
        local add_chart_tag = player.force.add_chart_tag
        ---@cast add_chart_tag fun(surface:SurfaceIdentification,tag:ChartTagSpec):LuaCustomChartTag?
        tag = add_chart_tag(surface, { position = position, text = text, icon = icon, last_user = player })
        if not tag then
            return nil, { "location-location-location.uncharted" }
        end
    end
    local saved = planner.copy(draft)
    if not saved.id then
        saved.id = storage.location_location_location.next_id
        storage.location_location_location.next_id = saved.id + 1
    end
    saved.revision, saved.title, saved.tag = draft.revision + 1, title, tag
    storage.location_location_location.plans[saved.id] = saved
    return planner.copy(saved)
end

---@param player LuaPlayer
---@param draft RecipePlan
---@param retired boolean
---@return integer?, LocalisedString?
function planner.retire(player, draft, retired)
    local current, err = current_plan(player, draft)
    if err then
        return nil, err
    end
    if not current then
        return nil, { "location-location-location.missing-plan" }
    end
    current.retired, current.revision = retired, current.revision + 1
    return current.revision
end

---@param player LuaPlayer
---@param draft RecipePlan
---@return boolean, LocalisedString?
function planner.delete(player, draft)
    local current, err = current_plan(player, draft)
    if err then
        return false, err
    end
    if not current then
        return false, { "location-location-location.missing-plan" }
    end
    local tag = current.tag
    if tag and tag.valid and tag.force == player.force then
        tag.destroy()
    end
    storage.location_location_location.plans[current.id] = nil
    return true
end

return planner
