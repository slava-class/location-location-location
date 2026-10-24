local Capabilities = {}
local excluded_fluid_hosts =
    { pipe = true, ["pipe-to-ground"] = true, ["infinity-pipe"] = true, ["fluid-wagon"] = true }

function Capabilities.read()
    local types = { inserter = true, ["mining-drill"] = true }
    ---@type number
    local reach = 1
    local stacking_loaders = false
    local function include_reach(vector)
        if vector then
            reach = math.max(reach, math.abs(vector.x or vector[1]), math.abs(vector.y or vector[2]))
        end
    end
    for _, prototype in pairs(prototypes.entity) do
        if not excluded_fluid_hosts[prototype.type] and #prototype.fluidbox_prototypes > 0 then
            types[prototype.type] = true
        end
        if prototype.type == "inserter" then
            include_reach(prototype.inserter_pickup_position)
            include_reach(prototype.inserter_drop_position)
        elseif prototype.type == "mining-drill" then
            include_reach(prototype.vector_to_place_result)
        elseif prototype.type == "loader" or prototype.type == "loader-1x1" then
            local maximum = prototype.loader_max_belt_stack_size
            if maximum and maximum > 1 then
                stacking_loaders = true
            end
        end
    end
    local warning_types = {}
    for kind in pairs(types) do
        warning_types[#warning_types + 1] = kind
    end
    table.sort(warning_types)
    return { warning_types = warning_types, ground_reach = math.ceil(reach) + 1, stacking_loaders = stacking_loaders }
end

return Capabilities
