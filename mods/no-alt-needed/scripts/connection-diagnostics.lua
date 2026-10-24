local Diagnostics = {}

function Diagnostics.endpoints(entity)
    if entity.type == "inserter" then
        return entity.pickup_position, entity.drop_position
    end
    if entity.type == "mining-drill" then
        local vector = entity.prototype.vector_to_place_result
        if vector and ((vector.x or vector[1]) ~= 0 or (vector.y or vector[2]) ~= 0) then
            return nil, entity.drop_position
        end
    end
    return nil, nil
end

function Diagnostics.tile(position)
    return string.format("%d:%d", math.floor(position.x), math.floor(position.y))
end

local function material(entity, index)
    local filter = entity.get_fluid_filter(index)
    if filter then
        return type(filter.fluid) == "string" and filter.fluid or filter.fluid.name
    end
    local fluid = entity.get_fluid(index)
    return fluid and fluid.name
end

local function same_position(a, b)
    return math.abs(a.x - b.x) < 1 / 256 and math.abs(a.y - b.y) < 1 / 256
end

local function disconnected_fluid(entity, connection, expected)
    local fluid_obstruction = false
    for _, candidate in ipairs(entity.surface.find_entities_filtered({ position = connection.target_position })) do
        if candidate ~= entity and candidate.type ~= "entity-ghost" and candidate.fluids_count > 0 then
            fluid_obstruction = true
            for index = 1, candidate.fluids_count do
                local connections = candidate.get_fluid_box_pipe_connections(index)
                for _, other in ipairs(connections or {}) do
                    if
                        other.connection_type == "normal"
                        and same_position(other.position, connection.target_position)
                        and same_position(other.target_position, connection.position)
                    then
                        local other_material = material(candidate, index)
                        if expected and other_material and expected ~= other_material then
                            return "mismatch"
                        end
                    end
                end
            end
        end
    end
    if fluid_obstruction then
        return "fluid-obstruction"
    end
    if
        entity.surface.can_place_entity({ name = "pipe", position = connection.target_position, force = entity.force })
    then
        return "missing"
    end
    return "obstructed"
end

local function marker(entity, role, status, point, dx, dy, flow)
    local length = math.sqrt(dx * dx + dy * dy)
    assert(length > 0, "A directional connection must have a nonzero direction")
    return {
        role = role,
        status = status,
        x = point.x - entity.position.x,
        y = point.y - entity.position.y,
        dx = dx / length,
        dy = dy / length,
        flow = flow,
    }
end

function Diagnostics.snapshot(record, options, complete, force)
    local entity = record.entity
    local result = {}
    local function endpoint(role, point, target, served)
        if not point or (target and target.valid) or served or not complete then
            return
        end
        local chunk = { math.floor(point.x / 32), math.floor(point.y / 32) }
        if not force.is_chunk_visible(entity.surface, chunk) then
            return
        end
        local dx, dy = point.x - entity.position.x, point.y - entity.position.y
        -- Zero-reach custom inserters have no meaningful directional marker.
        if dx ~= 0 or dy ~= 0 then
            result[#result + 1] = marker(entity, role, "missing", point, dx, dy)
        end
    end
    if entity.type == "inserter" and options.warning_inserters then
        endpoint("pickup", record.pickup, entity.pickup_target, record.pickup_served)
        endpoint("drop", record.drop, entity.drop_target, record.drop_served)
    elseif entity.type == "mining-drill" and options.warning_drills then
        endpoint("drop", record.drop, entity.drop_target, record.drop_served)
    end
    if options.warning_fluids == "off" then
        return result
    end
    local rail_input, rail_output = false, false
    if entity.type == "pump" then
        rail_input = #entity.pump_input_rail_targets > 0
        rail_output = #entity.pump_output_rail_targets > 0
    end
    for index = 1, entity.fluids_count do
        local connections = entity.get_fluid_box_pipe_connections(index)
        local connected = false
        for _, connection in ipairs(connections or {}) do
            if connection.target and connection.target.valid then
                connected = true
            end
        end
        local expected = material(entity, index)
        for _, connection in ipairs(connections or {}) do
            if
                connection.connection_type == "normal"
                and not (rail_input and connection.flow_direction == "input")
                and not (rail_output and connection.flow_direction == "output")
            then
                local status
                if connection.target and connection.target.valid then
                    local other_material = material(connection.target, assert(connection.target_fluidbox_index))
                    status = expected and other_material and expected ~= other_material and "mismatch" or "connected"
                elseif connected then
                    status = "redundant"
                else
                    status = disconnected_fluid(entity, connection, expected)
                end
                result[#result + 1] = marker(
                    entity,
                    "fluid",
                    status,
                    connection.position,
                    connection.target_position.x - connection.position.x,
                    connection.target_position.y - connection.position.y,
                    connection.flow_direction
                )
            end
        end
    end
    return result
end

return Diagnostics
