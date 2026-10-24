local Policy = require("scripts.fluid-policy")
local Connections = {}
local metadata
local preview_cache = {}

function Connections.configuration()
    if not metadata then
        local prototype = prototypes.mod_data[Policy.metadata_name]
        metadata = prototype.data
        assert(metadata.schema == 1, "No ALT Needed: unsupported fluid prototype metadata")
    end
    return metadata
end

function Connections.prototype(entity)
    if not entity or not entity.valid then
        return nil
    end
    return entity.type == "entity-ghost" and entity.ghost_prototype or entity.prototype
end

function Connections.participates(prototype)
    local entry = prototype and Connections.configuration().entities[prototype.name]
    if not entry then
        return false
    end
    for _, port in pairs(entry.ports) do
        if port.owned then
            return true
        end
    end
    return false
end

local function owned(entry, definition)
    local key = Policy.connection_key(definition)
    local port = key and entry.ports[key]
    return port and port.owned and definition.hide_connection_info, port
end

local function definitions_for(entity, index, entry)
    local box = entity.get_fluid_box_prototype(index)
    local result = {}
    local all_owned = true
    local function add(prototype)
        for _, definition in ipairs(prototype.pipe_connections) do
            if definition.connection_type ~= "linked" then
                local ours = owned(entry, definition)
                result[#result + 1] = definition
                if not ours then
                    all_owned = false
                end
            end
        end
    end
    if box then
        if box.object_name then
            add(box)
        else
            for _, prototype in ipairs(box) do
                add(prototype)
            end
        end
    end
    return result, all_owned and #result > 0
end

local function owns_runtime_connection(entity, connection, definitions, all_owned, entry)
    if connection.connection_type == "linked" then
        return false
    end
    if all_owned then
        return true
    end
    local position = entity.position
    local x = connection.position.x - position.x
    local y = connection.position.y - position.y
    for _, definition in ipairs(definitions) do
        if definition.connection_type == connection.connection_type then
            local resolved = Policy.resolve(definition, entity.direction, entity.mirroring)
            if resolved and math.abs(resolved.x - x) < 0.0000001 and math.abs(resolved.y - y) < 0.0000001 then
                return owned(entry, definition) and true or false
            end
        end
    end
    return nil
end

local function id_name(value)
    if not value then
        return nil
    end
    return type(value) == "string" and value or value.name
end

local function direction_vector(direction)
    local angle = direction * math.pi / 8
    return { x = math.sin(angle), y = -math.cos(angle) }
end

local function append_port(snapshot, position, direction, flow, index, fluid, filter)
    local port = {
        position = position,
        direction = direction,
        flow_direction = flow,
        icon_x = position.x + direction.x * 0.9,
        icon_y = position.y + direction.y * 0.9,
        icon_scale = 0.65,
        storage_index = index,
        fluid = fluid and fluid.name,
        amount = fluid and fluid.amount,
        filter = filter and id_name(filter.fluid),
    }
    snapshot.ports[#snapshot.ports + 1] = port
    return port
end

local function recipe_routes(recipe, side)
    local routes = {}
    local retained = Connections.configuration().recipe_routes[recipe.name]
    if retained then
        for _, value in ipairs(retained[side]) do
            local filter = { fluid = value.name }
            routes[value.index] = filter
            for _, index in ipairs(value.extra) do
                routes[index] = filter
            end
        end
    else
        local ordinal = 0
        for _, value in ipairs(side == "input" and recipe.ingredients or recipe.products) do
            if value.type == "fluid" then
                ordinal = ordinal + 1
                local index = value.fluidbox_index and value.fluidbox_index > 0 and value.fluidbox_index or ordinal
                routes[index] = { fluid = value.name }
            end
        end
    end
    return routes
end

local function ghost_ports(entity, prototype, entry, snapshot)
    local crafting = entry.category == "assembling-machine"
        or entry.category == "furnace"
        or entry.category == "rocket-silo"
    local recipe = crafting and entity.get_recipe() or nil
    local inputs = recipe and recipe_routes(recipe, "input") or {}
    local outputs = recipe and recipe_routes(recipe, "output") or {}
    ---@type table<string,integer?>
    local ranks = { input = 0, output = 0 }
    for _, box in ipairs(prototype.fluidbox_prototypes) do
        local source
        for _, definition in ipairs(box.pipe_connections) do
            local _, port = owned(entry, definition)
            if port then
                source = port.source
                break
            end
        end
        ---@type FluidFilter?
        local filter = box.filter and { fluid = box.filter.name } or nil
        local available = true
        if source == "crafting" then
            local production = box.production_type
            if ranks[production] then
                ranks[production] = ranks[production] + 1
            end
            if recipe then
                if production == "input" then
                    filter = inputs[ranks.input]
                elseif production == "output" then
                    filter = outputs[ranks.output]
                else
                    filter = nil
                end
                available = filter ~= nil
            elseif entry.category == "assembling-machine" or entry.category == "rocket-silo" then
                available = not prototype.fluid_boxes_off_when_no_fluid_recipe
                -- Assembler prototype filters are explicitly ignored by Factorio.
                filter = nil
            end
        end
        if available then
            for _, definition in ipairs(box.pipe_connections) do
                if owned(entry, definition) then
                    local resolved = Policy.resolve(definition, entity.direction, entity.mirroring)
                    if resolved then
                        append_port(
                            snapshot,
                            { x = resolved.x, y = resolved.y },
                            direction_vector(resolved.direction),
                            definition.flow_direction,
                            box.index,
                            nil,
                            filter
                        )
                    else
                        snapshot.unresolved = snapshot.unresolved + 1
                    end
                end
            end
        end
    end
    snapshot.prototype_ghost = true
end

function Connections.snapshot(entity)
    ---@type {ports:table[],unresolved:integer,prototype_ghost:boolean}
    local snapshot = { ports = {}, unresolved = 0, prototype_ghost = false }
    local prototype = Connections.prototype(entity)
    local entry = prototype and Connections.configuration().entities[prototype.name]
    if not entry then
        return snapshot
    end
    local ghost = entity.type == "entity-ghost"
    local origin = entity.position
    local count = entity.fluids_count
    if ghost and count == 0 then
        ghost_ports(entity, prototype, entry, snapshot)
        return snapshot
    end
    for index = 1, count do
        local connections = entity.get_fluid_box_pipe_connections(index)
        if connections and #connections > 0 then
            local definitions, all_owned = definitions_for(entity, index, entry)
            local filter = entity.get_fluid_filter(index)
            local fluid
            if not ghost then
                fluid = entity.get_fluid(index)
                if not fluid and entity.has_fluid_segment(index) then
                    fluid = entity.get_fluid_segment_fluid(index)
                end
            end
            for _, connection in ipairs(connections) do
                local ours = owns_runtime_connection(entity, connection, definitions, all_owned, entry)
                if ours then
                    local dx = connection.target_position.x - connection.position.x
                    local dy = connection.target_position.y - connection.position.y
                    local length = math.sqrt(dx * dx + dy * dy)
                    if length > 0 then
                        local port = append_port(snapshot, {
                            x = connection.position.x - origin.x,
                            y = connection.position.y - origin.y,
                        }, { x = dx / length, y = dy / length }, connection.flow_direction, index, fluid, filter)
                        local connected = connection.target
                        if connected and (connected.type == "pipe" or connected.type == "pipe-to-ground") then
                            local specification = connected.prototype.icon_draw_specification
                            local x, y = Policy.xy(specification.shift)
                            local position = connected.position
                            port.icon_x = position.x + x - origin.x
                            port.icon_y = position.y + y - origin.y
                            port.icon_scale = specification.scale * 0.9
                        end
                    else
                        snapshot.unresolved = snapshot.unresolved + 1
                    end
                elseif ours == nil then
                    snapshot.unresolved = snapshot.unresolved + 1
                end
            end
        end
    end
    return snapshot
end

function Connections.preview(prototype)
    if prototype and preview_cache[prototype.name] then
        return preview_cache[prototype.name]
    end
    ---@type {ports:table[],unresolved:integer,prototype_ghost:boolean}
    local snapshot = { ports = {}, unresolved = 0, prototype_ghost = false }
    local entry = prototype and Connections.configuration().entities[prototype.name]
    if not entry then
        return snapshot
    end
    for _, box in ipairs(prototype.fluidbox_prototypes) do
        ---@type FluidFilter?
        local filter = box.filter and { fluid = box.filter.name } or nil
        if entry.category == "assembling-machine" or entry.category == "rocket-silo" then
            filter = nil
        end
        for _, definition in ipairs(box.pipe_connections) do
            if owned(entry, definition) then
                if not Policy.preview_supported(definition, prototype) then
                    snapshot.unresolved = snapshot.unresolved + 1
                else
                    local x, y = Policy.xy(definition.positions[1])
                    append_port(
                        snapshot,
                        { x = x, y = y },
                        direction_vector(definition.direction),
                        definition.flow_direction,
                        box.index,
                        nil,
                        filter
                    )
                end
            end
        end
    end
    if snapshot.unresolved > 0 then
        -- Do not present a misleading partial diagram for an asymmetric layout.
        snapshot.ports = {}
    end
    preview_cache[prototype.name] = snapshot
    return snapshot
end

return Connections
