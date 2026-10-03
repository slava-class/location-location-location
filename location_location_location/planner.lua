local util = require("__core__.lualib.util")
local planner = {}

---@class IngredientPlan
---@field key string
---@field type "item"|"fluid"
---@field name string
---@field anchors table<string, MapPosition.struct>

---@class RecipePlan
---@field id integer?
---@field revision integer
---@field force_index integer
---@field surface_index integer
---@field recipe string?
---@field title string
---@field hide_label boolean? Hide map-tag text without discarding the list name.
---@field ingredients IngredientPlan[]
---@field tag LuaCustomChartTag?
---@field retired boolean
---@field marker_position MapPosition.struct? Explicit marker location; nil follows the source-based suggestion.

function planner.initialize()
    ---@type LLLState?
    local state = storage.location_location_location
    if not state then
        storage.location_location_location =
            { next_id = 1, plans = {}, sessions = {}, preferences = {}, highlights = {} }
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
        title = "",
        hide_label = true,
        ingredients = {},
        retired = false,
    }
end

---@param draft RecipePlan
---@param name string?
---@return boolean, LocalisedString?
function planner.set_recipe(draft, name)
    local recipe = name and prototypes.recipe[name]
    if not recipe then
        return false, { "location-location-location.missing-recipe" }
    end
    local previous = {}
    for _, ingredient in ipairs(draft.ingredients) do
        previous[ingredient.key] = ingredient.anchors
    end
    local ingredients = {}
    for _, ingredient in ipairs(recipe.ingredients) do
        local key = ingredient.type .. "/" .. ingredient.name
        ingredients[#ingredients + 1] =
            { key = key, type = ingredient.type, name = ingredient.name, anchors = previous[key] or {} }
    end
    if draft.title == "" or draft.title == draft.recipe then
        draft.title = name
    end
    draft.recipe, draft.ingredients = name, ingredients
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
        recipe = plan.recipe,
        title = plan.title,
        hide_label = plan.hide_label,
        ingredients = util.table.deepcopy(plan.ingredients),
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
    -- Recipe changes from a mod update retain only still-applicable ingredient assignments.
    if draft.recipe and prototypes.recipe[draft.recipe] then
        planner.set_recipe(draft, draft.recipe)
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
    return title ~= "" and title ~= draft.recipe and title or nil
end

--- Net edits: recipe, custom name, label visibility, placement, and each changed ingredient source set.
--- An automatic recipe-name update belongs to the recipe edit, not a second edit.
---@return integer
---@param player LuaPlayer
---@param draft RecipePlan
function planner.change_count(player, draft)
    local saved = draft.id and storage.location_location_location.plans[draft.id]
    if saved and saved.force_index ~= player.force.index then
        saved = nil
    end
    local count = draft.recipe ~= (saved and saved.recipe) and 1 or 0
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
    for _, ingredient in ipairs(draft.ingredients) do
        local previous = saved and planner.ingredient(saved, ingredient.key)
        if not same_anchors(ingredient.anchors, previous and previous.anchors) then
            count = count + 1
        end
    end
    if saved then
        for _, previous in ipairs(saved.ingredients) do
            if not planner.ingredient(draft, previous.key) and next(previous.anchors) then
                count = count + 1
            end
        end
    end
    return count
end

---@param draft RecipePlan
---@param key string
---@return IngredientPlan?
function planner.ingredient(draft, key)
    for _, ingredient in ipairs(draft.ingredients) do
        if ingredient.key == key then
            return ingredient
        end
    end
end

local function anchor_key(entity)
    -- Anchors represent places, not live entities: overlapping drags and replacement
    -- entities at the same position address the same saved point.
    return entity.position.x .. ":" .. entity.position.y
end

---@param draft RecipePlan
---@param key string
---@param entities LuaEntity[]
---@param mode "replace"|"add"|"remove"
---@param surface_index integer
---@return boolean, LocalisedString?
function planner.select(draft, key, entities, mode, surface_index)
    if surface_index ~= draft.surface_index then
        return false, { "location-location-location.wrong-surface" }
    end
    local ingredient = planner.ingredient(draft, key)
    if not ingredient then
        return false, { "location-location-location.choose-ingredient" }
    end
    if mode == "replace" then
        ingredient.anchors = {}
    end
    for _, entity in pairs(entities) do
        if entity.valid and entity.surface.index == draft.surface_index then
            local position = entity.position
            ---@cast position MapPosition.struct
            local position_key = anchor_key(entity)
            if mode == "remove" then
                ingredient.anchors[position_key] = nil
            else
                ingredient.anchors[position_key] = { x = position.x, y = position.y }
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
    for _, ingredient in ipairs(draft.ingredients) do
        ---@type number, number, integer
        local sx, sy, count = 0, 0, 0
        for _, position in pairs(ingredient.anchors) do
            sx, sy, count = sx + position.x, sy + position.y, count + 1
        end
        if count > 0 then
            x, y, assigned = x + sx / count, y + sy / count, assigned + 1
        end
    end
    if assigned == 0 then
        return nil, 0, #draft.ingredients
    end
    return { x = x / assigned, y = y / assigned }, assigned, #draft.ingredients
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
    local recipe = draft.recipe and prototypes.recipe[draft.recipe]
    if not recipe then
        return nil, { "location-location-location.missing-recipe" }
    end
    local surface = game.surfaces[draft.surface_index]
    if not surface then
        return nil, { "location-location-location.missing-surface" }
    end
    local position, assigned, total = planner.position(draft)
    local title = draft.title:match("^%s*(.-)%s*$")
    if title == "" then
        title = draft.recipe
    end
    local text = draft.hide_label and "" or title
    if not draft.hide_label and assigned < total then
        text = text .. " [" .. assigned .. "/" .. total .. "]"
    end
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
