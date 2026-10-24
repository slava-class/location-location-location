local tooltip = {}
local labels = {
    ["recipe-name-tooltip.recipe"] = true,
    ["recipe-name-tooltip.filter"] = true,
    ["recipe-name-tooltip.excludes"] = true,
}
local crafting_types = { ["assembling-machine"] = true, furnace = true, ["rocket-silo"] = true }
local item_filter_types = { inserter = true, loader = true, ["loader-1x1"] = true, ["logistic-container"] = true }
local splitter_types = { splitter = true, ["lane-splitter"] = true }

---@param entity LuaEntity
local function content(entity)
    if crafting_types[entity.type] then
        return entity.get_recipe(), "recipe-name-tooltip.recipe"
    end
    local kind = entity.type
    ---@type ItemFilter?
    local filter
    if splitter_types[kind] then
        if entity.splitter_output_priority == "none" then
            return nil
        end
        filter = entity.splitter_filter
    else
        if kind == "inserter" and not entity.use_filters then
            return nil
        end
        for slot = 1, entity.filter_slot_count do
            local entry = entity.get_filter(slot) --[[@as ItemFilter?]]
            if entry then
                if filter then
                    return nil
                end
                filter = entry
            end
        end
    end
    if not filter then
        return nil
    end
    local name = type(filter) == "string" and filter or filter.name
    if name and type(name) ~= "string" then
        name = name.name
    end
    if not name then
        return nil -- A quality-only filter does not identify an item.
    end
    local mode = kind == "inserter" and entity.inserter_filter_mode
        or (kind == "loader" or kind == "loader-1x1") and entity.loader_filter_mode
    local label = mode == "blacklist" and "recipe-name-tooltip.excludes" or "recipe-name-tooltip.filter"
    local quality = type(filter) == "table" and filter.quality or nil
    if type(quality) == "string" then
        quality = prototypes.quality[quality]
    end
    local comparator = type(filter) == "table" and filter.comparator or nil
    return prototypes.item[name], label, quality, comparator, true
end

---@param target RecipeNameTooltipTarget
---@return RuntimeTooltipField?
local function owned_field(target)
    if not target.field_id or not target.entity.valid then
        return nil
    end
    local field = target.entity.get_tooltip_field(target.field_id)
    if field and type(field.name) == "table" and labels[field.name[1]] then
        return field
    end
    return nil
end

---@param target RecipeNameTooltipTarget
local function clear_field(target)
    if owned_field(target) then
        target.entity.clear_tooltip_field(assert(target.field_id))
    end
    target.field_id, target.content_name, target.label = nil, nil, nil
    target.quality_name, target.comparator = nil, nil
end

---@param target RecipeNameTooltipTarget
local function refresh(target)
    local prototype, label, quality, comparator, item_filter = content(target.entity)
    if not prototype then
        clear_field(target)
        return
    end
    local quality_name = quality and quality.name
    local field = owned_field(target)
    if
        field
        and target.content_name == prototype.name
        and target.label == label
        and target.quality_name == quality_name
        and target.comparator == comparator
    then
        return
    end
    local value = prototype.localised_name
    if item_filter and quality and script.feature_flags.quality then
        value = { "recipe-name-tooltip.quality-filter", value, comparator or "=", quality.localised_name }
    end
    target.field_id = target.entity.set_tooltip_field({
        id = field and target.field_id or nil,
        name = { assert(label) },
        value = value,
        order = 0,
    })
    target.content_name, target.label = prototype.name, label
    target.quality_name, target.comparator = quality_name, comparator
end

local function refresh_selected()
    local state = storage.recipe_name_tooltip
    for id, target in pairs(state.targets) do
        if target.entity.valid then
            refresh(target)
        else
            for index in pairs(target.viewers) do
                state.viewers[index] = nil
            end
            state.targets[id] = nil
        end
    end
    if not next(state.targets) then
        script.on_nth_tick(15, nil)
    end
end

local function register_refresh()
    script.on_nth_tick(15, next(storage.recipe_name_tooltip.targets) and refresh_selected or nil)
end

---@param index integer
local function detach(index)
    local state = storage.recipe_name_tooltip
    local id = state.viewers[index]
    if not id then
        return
    end
    state.viewers[index] = nil
    local target = state.targets[id]
    if not target then
        return
    end
    target.viewers[index] = nil
    if not next(target.viewers) then
        clear_field(target)
        state.targets[id] = nil
    end
end

---@param entity LuaEntity
---@return RecipeNameTooltipTarget
local function attach(entity)
    ---@type RecipeNameTooltipTarget
    local target = { entity = entity, viewers = {} }
    -- Native fields survive mod removal. Reconcile our namespace on selection,
    -- rather than scanning the factory or duplicating a retained line.
    for _, field in pairs(entity.get_tooltip_fields()) do
        if type(field.name) == "table" and labels[field.name[1]] then
            if target.field_id then
                entity.clear_tooltip_field(assert(field.id))
            else
                target.field_id = assert(field.id)
            end
        end
    end
    return target
end

---@param index integer
---@param entity LuaEntity?
function tooltip.select(index, entity)
    local state = storage.recipe_name_tooltip
    local id
    if entity and entity.valid then
        local kind = entity.type
        if
            crafting_types[kind]
            or splitter_types[kind]
            or (item_filter_types[kind] and entity.filter_slot_count > 0)
        then
            id = entity.unit_number
        end
    end
    if state.viewers[index] == id then
        return
    end
    detach(index)
    if id and entity then
        local target = state.targets[id]
        if not target then
            target = attach(entity)
            state.targets[id] = target
        end
        target.viewers[index] = true
        state.viewers[index] = id
        refresh(target)
    end
    register_refresh()
end

---@param event {player_index: integer}
local function select(event)
    local player = game.get_player(event.player_index)
    tooltip.select(event.player_index, player and player.selected)
end

---@param event EventData.on_player_left_game|EventData.on_player_removed
local function leave(event)
    detach(event.player_index)
    register_refresh()
end

local function initialize()
    storage.recipe_name_tooltip = { targets = {}, viewers = {} }
    for _, player in pairs(game.connected_players) do
        select({ player_index = player.index })
    end
    register_refresh()
end

tooltip.on_init = initialize
tooltip.on_configuration_changed = function()
    for _, target in pairs(storage.recipe_name_tooltip.targets) do
        clear_field(target)
    end
    initialize()
end
tooltip.on_load = register_refresh
---@type event_handler.events
local events = {
    [defines.events.on_selected_entity_changed] = select,
    [defines.events.on_player_joined_game] = select,
    [defines.events.on_player_left_game] = leave,
    [defines.events.on_player_removed] = leave,
}
tooltip.events = events

return tooltip
