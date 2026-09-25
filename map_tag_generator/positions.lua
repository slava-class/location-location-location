local mtg = require("map_tag_generator.constants")

local positions = {}

---Calculates a bounding box around a group of entities, and returns the center of that box.
---@param entities LuaEntity[]
---@return MapPosition.0? # The point that is halfway between the outermost entities in both x/y directions, or `nil` if `entities` is empty.
local function middle_of_entities(entities)
    if next(entities) == nil then return end

    ---@type { x: { min: number, max: number }, y: { min: number, max: number } }
    local bounds = {x = {}, y = {}}
    for _, entity in pairs(entities) do
        local position = entity.position

        -- x min
        if not bounds.x.min then bounds.x.min = position.x
        else bounds.x.min = math.min(bounds.x.min, position.x) end

        -- x max
        if not bounds.x.max then bounds.x.max = position.x
        else bounds.x.max = math.max(bounds.x.max, position.x) end

        -- y min
        if not bounds.y.min then bounds.y.min = position.y
        else bounds.y.min = math.min(bounds.y.min, position.y) end

        -- y max
        if not bounds.y.max then bounds.y.max = position.y
        else bounds.y.max = math.max(bounds.y.max, position.y) end
    end
    return {
        x = (bounds.x.min + bounds.x.max) / 2,
        y = (bounds.y.min + bounds.y.max) / 2,
    }
end

---Calculates the average position (centroid) of a group of entities.
---@param entities LuaEntity[]
---@return MapPosition.0? # The centroid of the entities' positions, or `nil` if `entities` is empty.
local function average_of_entities(entities)
    if next(entities) == nil then return end

    ---@type MapPosition.0
    local avg_pos = {x = 0, y = 0}
    for _, entity in pairs(entities) do
        local position = entity.position

        avg_pos.x = avg_pos.x + position.x
        avg_pos.y = avg_pos.y + position.y
    end
    local num_entities = table_size(entities)
    avg_pos.y = avg_pos.y / num_entities
    avg_pos.x = avg_pos.x / num_entities
    return avg_pos
end

---Calculates the center of an area.
---@param area BoundingBox
---@return MapPosition.0
local function center_of_selection(area)
    return {
        x = (area.left_top.x + area.right_bottom.x) / 2,
        y = (area.left_top.y + area.right_bottom.y) / 2,
    }
end

---Calculates the correct tag position, given a position style.
---@param args { area: BoundingBox, entities: LuaEntity[], position_style: PositionStyle }
---@return MapPosition.0
positions.determine_tag_position = function(args)
    local area = args.area
    local entities = args.entities
    local position_style = args.position_style

    local result
    if position_style == mtg.position_styles.middle_of_entities then result = middle_of_entities(entities) end
    if position_style == mtg.position_styles.average_of_entities then result = average_of_entities(entities) end
    if position_style == mtg.position_styles.center_of_selection or result == nil then result = center_of_selection(area) end
    return result
end

---Determines a list of tag positions, given a layout style.
---@param center MapPosition.0 The center around which the positions will be set.
---@param num integer The number of tag positions to include.
---@param layout_style LayoutStyle The layout style to use.
---@param shift_amount? integer The amount of spacing between the center of adjacent tags.
---@return MapPosition.0[]
positions.multi_tag_positions = function(center, num, layout_style, shift_amount)
    if not shift_amount then shift_amount = mtg.tag_shift_amount end
    local result = {}

    if num < 1 then
        result = {} -- redundant lol but more explicit this way

    elseif num == 1 then
        result = {center}

    elseif layout_style == mtg.layout_styles.horizontal then
        for i = -(num - 1) / 2, (num - 1) / 2 do
            table.insert(result, {
                x = center.x + i * shift_amount,
                y = center.y,
            })
        end

    elseif layout_style == mtg.layout_styles.vertical then
        for i = -(num - 1) / 2, (num - 1) / 2 do
            table.insert(result, {
                x = center.x,
                y = center.y + i * shift_amount,
            })
        end

    elseif layout_style == mtg.layout_styles.square then
        -- first, determine the maximum number of rows and columns
        -- (the smallest integer n such that n^2 >= num)
        local n = math.ceil(math.sqrt(num))

        -- then, determine the number of rows that will be filled (fully or partially)
        -- (we will always use every column since we fill left-right then top-bottom, so we don't need to calculate that)
        -- this gives us a vertical shift amount so the tags are vertically centered (needed if not all rows are used)
        local num_rows = math.ceil(num / n)
        local vertical_shift = (n - num_rows) * (shift_amount / 2)

        local positions_filled = 0
        for i = -(n - 1) / 2, (n - 1) / 2 do
            local tags_in_row = math.min(n, num - positions_filled) -- causes the rows to be horizontally centered
            for j = -(tags_in_row - 1) / 2, (tags_in_row - 1) / 2 do
                if positions_filled < num then
                    table.insert(result, {
                        x = center.x + j * shift_amount,
                        y = center.y + i * shift_amount + vertical_shift,
                    })
                    positions_filled = positions_filled + 1
                end
            end
        end
    end

    return result
end

return positions