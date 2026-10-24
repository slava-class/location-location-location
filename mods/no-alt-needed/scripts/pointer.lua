local Pointer = {}
local prefix = "no-alt-needed-pointer-"
local side, work_per_tick = 32, 32

function Pointer.is_target(entity)
    return entity and entity.valid and entity.name:sub(1, #prefix) == prefix
end

function Pointer.clear(state)
    state.capturing = true
    for _, entity in pairs(state.cells or {}) do
        if entity.valid then
            entity.destroy()
        end
    end
    state.cells, state.point = {}, nil
    state.size, state.left, state.top, state.right, state.bottom = nil, nil, nil, nil, nil
    state.cursor, state.remaining, state.next_layout, state.next_scan, state.capturing = 1, 0, nil, nil, nil
end

local function inside(state, x, y)
    return state.left and x >= state.left and x <= state.right and y >= state.top and y <= state.bottom
end

-- Selection visibility is not player-private. Consume any of our targets, but
-- never move it: another viewer may be sampling the same native entity.
function Pointer.select(player, state)
    if state.capturing then
        return true
    end
    local entity = player.selected
    if not Pointer.is_target(entity) then
        if entity and state.point then
            state.point = nil
        end
        return false
    end
    state.capturing = true
    local position = entity.position
    local unchanged = state.point and state.point.x == position.x and state.point.y == position.y
    if state.size then
        state.point = position
    end
    player.clear_selected_entity()
    state.capturing = nil
    return state.size and unchanged
end

function Pointer.update(player, state, context, enabled)
    if not enabled or context.blocked or context.alt then
        if state.size or state.point then
            Pointer.clear(state)
        end
        return false
    end
    state.cells = state.cells or {}
    state.cursor = state.cursor or 1
    if not state.next_layout or context.tick >= state.next_layout then
        local resolution, zoom = player.display_resolution, player.zoom
        local width, height = resolution.width / (32 * zoom), resolution.height / (32 * zoom)
        local size = 2
        while math.max(width, height) / size > side - 4 do
            size = size * 2
        end
        -- Stop sampling at extreme map-scale zoom instead of registering
        -- enormous selection boxes that burden native hit-testing.
        if size > 64 then
            if state.size or state.point then
                Pointer.clear(state)
            end
            state.next_layout = context.tick + 15
            return true
        end
        local position = context.position
        local left, right =
            math.floor((position.x - width / 2) / size) - 1, math.floor((position.x + width / 2) / size) + 1
        local top, bottom =
            math.floor((position.y - height / 2) / size) - 1, math.floor((position.y + height / 2) / size) + 1
        if
            size ~= state.size
            or left ~= state.left
            or right ~= state.right
            or top ~= state.top
            or bottom ~= state.bottom
        then
            state.size, state.left, state.right, state.top, state.bottom = size, left, right, top, bottom
            state.remaining = side * side
        end
        state.next_layout = context.tick + 15
        if not state.next_scan or context.tick >= state.next_scan then
            state.remaining = side * side
            state.next_scan = context.tick + 120
        end
        local point = state.point
        if
            point
            and (
                not inside(state, math.floor(point.x / size), math.floor(point.y / size))
                or not player.force.is_chunk_visible(
                    context.surface,
                    { math.floor(point.x / 32), math.floor(point.y / 32) }
                )
            )
        then
            state.point = nil
        end
    end
    local size = state.size
    state.capturing = true
    for _ = 1, math.min(work_per_tick, state.remaining or 0) do
        local slot = state.cursor
        state.cursor, state.remaining = slot % (side * side) + 1, state.remaining - 1
        local x = state.left + ((slot - 1) % side - state.left) % side
        local y = state.top + (math.floor((slot - 1) / side) - state.top) % side
        local position = { x = (x + 0.5) * size, y = (y + 0.5) * size }
        local wanted = inside(state, x, y)
            and player.force.is_chunk_visible(
                context.surface,
                { math.floor(position.x / 32), math.floor(position.y / 32) }
            )
        local entity = state.cells[slot]
        local name = prefix .. size
        if entity and (not entity.valid or not wanted or entity.name ~= name) then
            if entity.valid then
                entity.destroy()
            end
            state.cells[slot], entity = nil, nil
        end
        if wanted then
            if entity then
                local old = entity.position
                if old.x ~= position.x or old.y ~= position.y then
                    assert(entity.teleport(position))
                end
            else
                entity = assert(context.surface.create_entity({
                    name = name,
                    position = position,
                    force = player.force,
                    render_player_index = player.index,
                    create_build_effect_smoke = false,
                }))
                entity.destructible, entity.minable_flag = false, false
                state.cells[slot] = entity
            end
        end
    end
    state.capturing = nil
    return true
end

return Pointer
