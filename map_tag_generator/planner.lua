local util = require("__core__.lualib.util")
local planner = {}

---@class IngredientPlan
---@field key string
---@field type string
---@field name string
---@field anchors table<string, MapPosition>

---@class RecipePlan
---@field id integer?
---@field revision integer
---@field force_index integer
---@field surface_index integer
---@field recipe string?
---@field title string
---@field ingredients IngredientPlan[]
---@field tag LuaCustomChartTag?
---@field retired boolean

function planner.initialize()
    if not storage.recipe_planner then
        storage.recipe_planner = {next_id = 1, plans = {}, sessions = {}, preferences = {}, highlights = {}}
    end
end

function planner.preferences(player)
    local preferences = storage.recipe_planner.preferences
    if not preferences[player.index] then
        preferences[player.index] = {researched_only = true, show_retired = false, highlight_sources = false}
    end
    return preferences[player.index]
end

function planner.new(player)
    return {revision = 0, force_index = player.force.index, surface_index = player.surface_index,
        title = "", ingredients = {}, retired = false}
end

function planner.set_recipe(draft, name)
    local recipe = name and prototypes.recipe[name]
    if not recipe then return false, {"map-tag-planner.missing-recipe"} end
    local previous = {}
    for _, ingredient in ipairs(draft.ingredients) do previous[ingredient.key] = ingredient.anchors end
    local ingredients = {}
    for _, ingredient in ipairs(recipe.ingredients) do
        local key = ingredient.type.."/"..ingredient.name
        ingredients[#ingredients + 1] = {key = key, type = ingredient.type, name = ingredient.name,
            anchors = previous[key] or {}}
    end
    if draft.title == "" or draft.title == draft.recipe then draft.title = name end
    draft.recipe, draft.ingredients = name, ingredients
    return true
end

function planner.copy(plan)
    return {id = plan.id, revision = plan.revision, force_index = plan.force_index,
        surface_index = plan.surface_index, recipe = plan.recipe, title = plan.title,
        ingredients = util.table.deepcopy(plan.ingredients), retired = plan.retired}
end

function planner.load(player, id)
    local plan = storage.recipe_planner.plans[id]
    if not plan or plan.force_index ~= player.force.index then return nil, {"map-tag-planner.missing-plan"} end
    local draft = planner.copy(plan)
    -- Recipe changes from a mod update retain only still-applicable ingredient assignments.
    if prototypes.recipe[draft.recipe] then planner.set_recipe(draft, draft.recipe) end
    return draft
end

function planner.list(player, include_retired)
    local plans = {}
    for _, plan in pairs(storage.recipe_planner.plans) do
        if plan.force_index == player.force.index and (include_retired or not plan.retired) then
            plans[#plans + 1] = plan
        end
    end
    table.sort(plans, function(a, b) return a.id < b.id end)
    return plans
end

function planner.is_dirty(player, draft)
    local saved = draft.id and storage.recipe_planner.plans[draft.id]
    if not saved or saved.force_index ~= player.force.index then return true end
    local title = draft.title:match("^%s*(.-)%s*$")
    if title == "" then title = draft.recipe end
    if title ~= saved.title or draft.recipe ~= saved.recipe or draft.surface_index ~= saved.surface_index
        or #draft.ingredients ~= #saved.ingredients then return true end
    for index, ingredient in ipairs(draft.ingredients) do
        local previous = saved.ingredients[index]
        if ingredient.key ~= previous.key then return true end
        for key, position in pairs(ingredient.anchors) do
            local old = previous.anchors[key]
            if not old or old.x ~= position.x or old.y ~= position.y then return true end
        end
        for key in pairs(previous.anchors) do
            if not ingredient.anchors[key] then return true end
        end
    end
    return false
end

function planner.ingredient(draft, key)
    for _, ingredient in ipairs(draft.ingredients) do
        if ingredient.key == key then return ingredient end
    end
end

local function anchor_key(entity)
    -- Anchors represent places, not live entities: overlapping drags and replacement
    -- entities at the same position address the same saved point.
    return entity.position.x..":"..entity.position.y
end

function planner.select(draft, key, entities, mode, surface_index)
    if surface_index ~= draft.surface_index then return false, {"map-tag-planner.wrong-surface"} end
    local ingredient = planner.ingredient(draft, key)
    if not ingredient then return false, {"map-tag-planner.choose-ingredient"} end
    if mode == "replace" then ingredient.anchors = {} end
    for _, entity in pairs(entities) do
        if entity.valid and entity.surface.index == draft.surface_index then
            local key = anchor_key(entity)
            if mode == "remove" then
                ingredient.anchors[key] = nil
            else
                ingredient.anchors[key] = {x = entity.position.x, y = entity.position.y}
            end
        end
    end
    return true
end

function planner.center(draft)
    local x, y, assigned = 0, 0, 0
    for _, ingredient in ipairs(draft.ingredients) do
        local sx, sy, count = 0, 0, 0
        for _, position in pairs(ingredient.anchors) do
            sx, sy, count = sx + position.x, sy + position.y, count + 1
        end
        if count > 0 then
            x, y, assigned = x + sx / count, y + sy / count, assigned + 1
        end
    end
    if assigned == 0 then return nil, 0, #draft.ingredients end
    return {x = x / assigned, y = y / assigned}, assigned, #draft.ingredients
end

local function current_plan(player, draft)
    if player.force.index ~= draft.force_index then return nil, {"map-tag-planner.wrong-force"} end
    if not draft.id then return nil end
    local current = storage.recipe_planner.plans[draft.id]
    if not current or current.force_index ~= player.force.index then return nil, {"map-tag-planner.missing-plan"} end
    if current.revision ~= draft.revision then return nil, {"map-tag-planner.conflict"} end
    return current
end

function planner.apply(player, draft)
    local current, err = current_plan(player, draft)
    if err then return nil, err end
    local recipe = draft.recipe and prototypes.recipe[draft.recipe]
    if not recipe then return nil, {"map-tag-planner.missing-recipe"} end
    local surface = game.surfaces[draft.surface_index]
    if not surface then return nil, {"map-tag-planner.missing-surface"} end
    local position, assigned, total = planner.center(draft)
    if not position then return nil, {"map-tag-planner.no-anchors"} end
    local title = draft.title:match("^%s*(.-)%s*$")
    if title == "" then title = draft.recipe end
    local text = title
    if assigned < total then text = text.." ["..assigned.."/"..total.."]" end
    local product = recipe.main_product or recipe.products[1]
    local icon = product and {type = product.type, name = product.name} or nil
    local tag = current and current.tag
    if tag and tag.valid and tag.force == player.force then
        tag.surface = surface
        tag.position, tag.text, tag.icon, tag.last_user = position, text, icon, player
    else
        tag = player.force.add_chart_tag(surface, {position = position, text = text, icon = icon, last_user = player})
        if not tag then return nil, {"map-tag-planner.uncharted"} end
    end
    local saved = planner.copy(draft)
    if not saved.id then
        saved.id = storage.recipe_planner.next_id
        storage.recipe_planner.next_id = saved.id + 1
    end
    saved.revision, saved.title, saved.tag = draft.revision + 1, title, tag
    storage.recipe_planner.plans[saved.id] = saved
    return planner.copy(saved)
end

function planner.retire(player, draft, retired)
    local current, err = current_plan(player, draft)
    if err then return nil, err end
    if not current then return nil, {"map-tag-planner.missing-plan"} end
    current.retired, current.revision = retired, current.revision + 1
    return current.revision
end

function planner.delete(player, draft)
    local current, err = current_plan(player, draft)
    if err then return false, err end
    if not current then return false, {"map-tag-planner.missing-plan"} end
    local tag = current.tag
    if tag and tag.valid and tag.force == player.force then tag.destroy() end
    storage.recipe_planner.plans[current.id] = nil
    return true
end

return planner
