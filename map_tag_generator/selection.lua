local util = require("__core__.lualib.util")

local selection = {}

local function entity_key(entity)
    if entity.unit_number then return entity.unit_number end
    -- Resources have no unit number. Their name and position identify them on a surface.
    return entity.type..":"..entity.name..":"..entity.position.x..":"..entity.position.y
end

---Updates the pending selection without counting overlapping drags twice.
---@param previous? EventData.on_player_selected_area
---@param event EventData.on_player_selected_area
---@param mode "replace" | "add" | "remove"
---@return EventData.on_player_selected_area
selection.update = function(previous, event, mode)
    local result = util.copy(event)
    local entities = {}
    local same_surface = previous and previous.surface.valid and previous.surface.index == event.surface.index
    if mode ~= "replace" and same_surface then
        for _, entity in pairs(previous.entities) do
            if entity.valid and entity.surface.index == event.surface.index then
                entities[entity_key(entity)] = entity
            end
        end
    end
    for _, entity in pairs(event.entities) do
        if entity.valid and entity.surface.index == event.surface.index then
            local key = entity_key(entity)
            if mode == "remove" then
                entities[key] = nil
            else
                entities[key] = entity
            end
        end
    end

    result.entities = {}
    local bounds
    for _, entity in pairs(entities) do
        table.insert(result.entities, entity)
        local box = entity.bounding_box
        if not bounds then
            bounds = util.copy(box)
        else
            bounds.left_top.x = math.min(bounds.left_top.x, box.left_top.x)
            bounds.left_top.y = math.min(bounds.left_top.y, box.left_top.y)
            bounds.right_bottom.x = math.max(bounds.right_bottom.x, box.right_bottom.x)
            bounds.right_bottom.y = math.max(bounds.right_bottom.y, box.right_bottom.y)
        end
    end
    if mode ~= "replace" and bounds then result.area = bounds end
    return result
end

return selection
