local Policy = {}

Policy.metadata_name = "no-alt-needed-fluids"
Policy.categories = {
    "assembling-machine",
    "furnace",
    "boiler",
    "generator",
    "mining-drill",
    "offshore-pump",
    "pump",
    "rocket-silo",
    "fusion-reactor",
    "fusion-generator",
    "thruster",
}
Policy.fields = {
    ["assembling-machine"] = { "fluid_boxes" },
    furnace = { "fluid_boxes" },
    boiler = { "fluid_box", "output_fluid_box" },
    generator = { "fluid_box", "output_fluid_box" },
    ["mining-drill"] = { "input_fluid_box", "output_fluid_box" },
    ["offshore-pump"] = { "fluid_box" },
    pump = { "fluid_box" },
    ["rocket-silo"] = { "fluid_boxes" },
    ["fusion-reactor"] = { "input_fluid_box", "output_fluid_box" },
    ["fusion-generator"] = { "input_fluid_box", "output_fluid_box" },
    thruster = { "fuel_fluid_box", "oxidizer_fluid_box" },
}

function Policy.enabled(values, category)
    return Policy.fields[category] ~= nil
        and values["no-alt-needed-fluid-declutter"].value
        and values["no-alt-needed-fluid-" .. category].value
end

---@param position MapPosition|Vector
---@return number, number
local function xy(position)
    local x = (position.x or position[1]) --[[@as number]]
    local y = (position.y or position[2]) --[[@as number]]
    return x, y
end
Policy.xy = xy

function Policy.connection_key(connection)
    if connection.connection_type == "linked" then
        return nil
    end
    local position = connection.position or (connection.positions and connection.positions[1])
    if not position or connection.direction == nil then
        return nil
    end
    local x, y = xy(position)
    if x == 0 then
        x = 0
    end
    if y == 0 then
        y = 0
    end
    return string.format("%s/%d/%.17g/%.17g", connection.connection_type or "normal", connection.direction, x, y)
end

---@param x number
---@param y number
---@return number, number
local function rotate(x, y, quarter)
    if quarter == 1 then
        return -y, x
    elseif quarter == 2 then
        return -x, -y
    elseif quarter == 3 then
        return y, -x
    end
    return x, y
end
Policy.rotate = rotate

-- Prototype positions are already resolved for the four cardinal directions.
-- The alternate position/direction describes NE, then rotates by quarters.
---@return {x:number,y:number,direction:number}?
function Policy.resolve(connection, direction, mirrored)
    if direction % 2 ~= 0 then
        return nil
    end
    local quarter = math.floor(direction / 4) % 4
    ---@type number, number, number
    local x, y, facing
    if direction % 4 == 2 then
        x, y = xy(connection.alt_position or connection.positions[1])
        x, y = rotate(x, y, quarter)
        facing = ((connection.alt_direction or connection.direction) + quarter * 4) % 16
    else
        x, y = xy(connection.positions[quarter + 1])
        facing = (connection.direction + direction) % 16
    end
    if mirrored then
        local angle = direction * math.pi / 8
        local ux, uy = math.sin(angle), -math.cos(angle)
        local dot = x * ux + y * uy
        x, y = 2 * dot * ux - x, 2 * dot * uy - y
        facing = (2 * direction - facing) % 16
    end
    return { x = x, y = y, direction = facing }
end

local function has_flag(flags, name)
    if flags[name] then
        return true
    end
    for _, flag in pairs(flags) do
        if flag == name then
            return true
        end
    end
    return false
end

function Policy.preview_supported(connection, prototype)
    if connection.connection_type == "linked" then
        return false
    end
    if not prototype.supports_direction then
        return true
    end
    local x, y = xy(connection.positions[1])
    for quarter = 1, 3 do
        local expected_x, expected_y = rotate(x, y, quarter)
        local actual_x, actual_y = xy(connection.positions[quarter + 1])
        if math.abs(expected_x - actual_x) > 0.0000001 or math.abs(expected_y - actual_y) > 0.0000001 then
            return false
        end
    end
    local flags = prototype.flags
    if has_flag(flags, "building-direction-8-way") or has_flag(flags, "building-direction-16-way") then
        local ax, ay = xy(connection.alt_position or connection.positions[1])
        local diagonal = math.sqrt(0.5)
        if
            math.abs(ax - (x - y) * diagonal) > 0.0000001
            or math.abs(ay - (x + y) * diagonal) > 0.0000001
            or (connection.alt_direction or connection.direction) ~= (connection.direction + 2) % 16
        then
            return false
        end
        -- The public prototype only supplies cardinal and NE variants, not the
        -- other intermediate variants required to qualify a 16-way preview.
        if has_flag(flags, "building-direction-16-way") then
            return false
        end
    end
    return true
end

function Policy.distance_squared(position, box)
    local x, y = xy(position)
    local left, top = xy(box.left_top or box[1])
    local right, bottom = xy(box.right_bottom or box[2])
    local dx = math.max(left - x, 0.0, x - right)
    local dy = math.max(top - y, 0.0, y - bottom)
    return dx * dx + dy * dy
end

return Policy
