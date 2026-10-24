local Library = require("__inserter-throughput-lib__.inserter_throughput")
local Inspect = require("scripts.inspect")
local Capacity = {}
local belt_types =
    { "transport-belt", "linked-belt", "underground-belt", "splitter", "lane-splitter", "loader", "loader-1x1" }
local belt_kind = {}
for _, kind in ipairs(belt_types) do
    belt_kind[kind] = true
end
Capacity.refresh_ticks = 15

local function endpoint_problem(target)
    if not target or not target.valid then
        return nil
    end
    local kind = Inspect.kind(target)
    if kind == "lane-splitter" then
        return "lane-splitter"
    end
    if not belt_kind[kind] or target.type == "entity-ghost" then
        return nil
    end
    for index = 1, target.get_max_transport_line_index() do
        local line = target.get_transport_line(index)
        if line.valid then
            for item = 1, #line do
                if line[item].count > 1 then
                    return "stacking"
                end
            end
        end
    end
    return nil
end

local function ghost_endpoint_problem(entity, vector)
    local position = { entity.position.x + vector.x, entity.position.y + vector.y }
    for _, target in ipairs(entity.surface.find_entities_filtered({ position = position, type = belt_types })) do
        local reason = endpoint_problem(target)
        if reason then
            return reason
        end
    end
    for _, target in
        ipairs(entity.surface.find_entities_filtered({ position = position, ghost_type = "lane-splitter" }))
    do
        if target.valid then
            return "lane-splitter"
        end
    end
    return nil
end

function Capacity.snapshot(entity, state, capabilities)
    state.definition = Library.make_full_definition_for_inserter(entity, state.definition)
    local definition = state.definition
    local reason
    if entity.type == "entity-ghost" then
        reason = ghost_endpoint_problem(entity, definition.inserter.pickup_vector)
            or ghost_endpoint_problem(entity, definition.inserter.drop_vector)
    else
        reason = endpoint_problem(entity.pickup_target) or endpoint_problem(entity.drop_target)
    end
    local belt = Library.is_belt_connectable_target_type(definition.pickup.target_type)
        or Library.is_belt_connectable_target_type(definition.drop.target_type)
    if not reason and belt then
        if capabilities.stacking_loaders then
            reason = "stacking"
        else
            -- Stacks can arrive from another force's upstream equipment. A local
            -- unstacked item sample cannot rule out stacking-enabled transport.
            for _, force in pairs(game.forces) do
                if force.belt_stack_size_bonus > 0 then
                    reason = "stacking"
                    break
                end
            end
        end
    end
    if reason then
        return { reason = reason }
    end
    if Library.is_unreasonable_definition(definition) then
        return { reason = "geometry" }
    end
    local value = Library.estimate_inserter_speed(definition)
    assert(
        type(value) == "number" and value >= 0 and value < math.huge,
        "Inserter Throughput Lib returned an invalid capacity"
    )
    return { value = value, approximate = Library.is_estimate(definition) }
end

function Capacity.clear(state)
    if state.object and state.object.valid then
        state.object.destroy()
    end
    for key in pairs(state) do
        state[key] = nil
    end
end

function Capacity.update(player, state, context, enabled, capabilities, warning_top)
    local entity = context.selected
    if context.blocked or not enabled or not entity or Inspect.kind(entity) ~= "inserter" then
        Capacity.clear(state)
        return false
    end
    if state.entity ~= entity then
        Capacity.clear(state)
        state.entity = entity
    end
    if not state.next_refresh or context.tick >= state.next_refresh then
        state.snapshot = Capacity.snapshot(entity, state, capabilities)
        state.next_refresh = context.tick + Capacity.refresh_ticks
        local snapshot = state.snapshot
        if snapshot.reason then
            state.caption = { "no-alt-needed.capacity-unsupported-" .. snapshot.reason }
        else
            state.caption = {
                snapshot.approximate and "no-alt-needed.capacity-estimate" or "no-alt-needed.capacity",
                string.format("%.2f", snapshot.value),
            }
        end
        if state.object and state.object.valid then
            state.object.text = state.caption
        end
    end
    local specification = Inspect.prototype(entity).icon_draw_specification
    local shift = specification.shift
    local shift_y = shift.y or shift[2] --[[@as number]]
    local top = shift_y - specification.scale * 0.9
    if warning_top then
        top = math.min(top, warning_top)
    end
    local offset = top - 6 / (32 * player.zoom)
    if not state.object or not state.object.valid then
        state.object = rendering.draw_text({
            text = state.caption,
            target = { entity = entity, offset = { 0, offset } },
            surface = entity.surface,
            players = { player.index },
            color = { 1, 1, 1 },
            scale = 0.8,
            font = "default-bold",
            scale_with_zoom = false,
            alignment = "center",
            vertical_alignment = "bottom",
        })
        state.offset = offset
    elseif state.offset ~= offset then
        state.object.target = { entity = entity, offset = { 0, offset } }
        state.offset = offset
    end
    return true
end

return Capacity
