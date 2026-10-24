local Scan = require("scripts.local-scan")
local Diagnostics = require("scripts.connection-diagnostics")
local Warnings = {}
Warnings.work_limits = { cell_size = 16, discoveries = 16, refreshes = 8, refresh_ticks = 15, scan_ticks = 30 }
local colors = {
    missing = { 1, 0.15, 0.1 },
    obstructed = { 1, 0.55, 0.05 },
    ["fluid-obstruction"] = { 0.85, 0.25, 1 },
    mismatch = { 1, 0.1, 0.6 },
    connected = { 0.2, 0.9, 0.35 },
    redundant = { 0.55, 0.65, 0.75 },
}

function Warnings.ignored(text)
    local result = {}
    for name in text:gmatch("[^,%s]+") do
        result[name] = true
    end
    return result
end

local function clear_render(record)
    for _, object in ipairs(record.objects or {}) do
        if object.valid then
            object.destroy()
        end
    end
    record.objects, record.signature, record.top = nil, nil, nil
end

function Warnings.clear(state)
    local work = state.work
    for _, record in pairs(state.records or {}) do
        clear_render(record)
    end
    for key in pairs(state) do
        state[key] = nil
    end
    -- Clearing a layer must not grant a second work budget in the same tick.
    state.work = work
end

local function inside(position, area)
    return position.x >= area[1][1]
        and position.x <= area[2][1]
        and position.y >= area[1][2]
        and position.y <= area[2][2]
end

local function unindex(state, record, role)
    local key = record[role .. "_key"]
    if key then
        local bucket = state[role .. "s"][key]
        bucket[record.key] = nil
        if not next(bucket) then
            state[role .. "s"][key] = nil
        end
    end
    record[role .. "_key"] = nil
end

local function endpoints(state, record)
    local pickup, drop = Diagnostics.endpoints(record.entity)
    for _, role in ipairs({ "pickup", "drop" }) do
        ---@type MapPosition?
        local point
        if role == "pickup" then
            point = pickup
        else
            point = drop
        end
        local key = point and Diagnostics.tile(point)
        if record[role .. "_key"] ~= key then
            unindex(state, record, role)
            if key then
                local buckets = state[role .. "s"]
                local bucket = buckets[key]
                if not bucket then
                    bucket = {}
                    buckets[key] = bucket
                end
                bucket[record.key] = record
                record[role .. "_key"] = key
            end
        end
        record[role] = point
    end
end

local function served(state, record, role)
    local point = record[role]
    if not point then
        return false
    end
    local opposite = role == "pickup" and "drop" or "pickup"
    local key = Diagnostics.tile(point)
    local bucket = state[opposite .. "s"][key]
    for _, other in pairs(bucket or {}) do
        if other ~= record and other.entity.valid then
            local pickup, drop = Diagnostics.endpoints(other.entity)
            local current
            if opposite == "pickup" then
                current = pickup
            else
                current = drop
            end
            if current and Diagnostics.tile(current) == key then
                return true
            end
        end
    end
    return false
end

local function remove_record(state, record)
    clear_render(record)
    unindex(state, record, "pickup")
    unindex(state, record, "drop")
    local last = state.order[#state.order]
    state.order[record.slot] = last
    state.order[#state.order] = nil
    if last ~= record.key then
        state.records[last].slot = record.slot
    end
    state.records[record.key] = nil
end

---@return NoAltNeededWarningRecord
local function record_for(state, entity)
    local key = assert(entity.unit_number, "Diagnostic hosts require a native unit number")
    ---@type NoAltNeededWarningRecord?
    local record = state.records[key]
    if not record then
        record = { entity = entity, key = key, slot = #state.order + 1, next_refresh = 0 }
        state.records[key] = record
        state.order[record.slot] = key
        endpoints(state, record)
    end
    return record
end

local function draw(player, record, markers, options)
    local signature = helpers.table_to_json({ markers, options.warning_fluids })
    if record.signature == signature then
        return
    end
    clear_render(record)
    record.signature, record.objects = signature, {}
    local entity = record.entity
    local function triangle(marker, sign)
        local dx, dy = marker.dx * sign, marker.dy * sign
        local x, y = marker.x, marker.y
        if marker.role == "fluid" then
            x, y = x + dx * 0.25, y + dy * 0.25
        end
        record.objects[#record.objects + 1] = rendering.draw_polygon({
            color = colors[marker.status],
            surface = entity.surface,
            players = { player.index },
            target = entity,
            vertices = {
                { x + dx * 0.25, y + dy * 0.25 },
                { x - dx * 0.2 - dy * 0.25, y - dy * 0.2 + dx * 0.25 },
                { x - dx * 0.2 + dy * 0.25, y - dy * 0.2 - dx * 0.25 },
            },
        })
    end
    for _, marker in ipairs(markers) do
        if
            marker.role ~= "fluid"
            or options.warning_fluids == "full"
            or (marker.status ~= "connected" and marker.status ~= "redundant")
        then
            record.top = math.min(record.top or math.huge, marker.y - 0.55)
            if marker.role == "pickup" then
                record.objects[#record.objects + 1] = rendering.draw_line({
                    color = colors[marker.status],
                    width = 5,
                    from = { entity = entity, offset = { marker.x - marker.dy * 0.3, marker.y + marker.dx * 0.3 } },
                    to = { entity = entity, offset = { marker.x + marker.dy * 0.3, marker.y - marker.dx * 0.3 } },
                    surface = entity.surface,
                    players = { player.index },
                })
            elseif marker.role == "fluid" then
                if marker.flow ~= "output" then
                    triangle(marker, -1)
                end
                if marker.flow ~= "input" then
                    triangle(marker, 1)
                end
            else
                triangle(marker, 1)
            end
        end
    end
end

local function viewport(player, context)
    local width = player.display_resolution.width / (64 * player.zoom)
    local height = player.display_resolution.height / (64 * player.zoom)
    return {
        { context.position.x - width, context.position.y - height },
        { context.position.x + width, context.position.y + height },
    }
end

local function eligible(entity, context, area)
    return entity.valid
        and entity.type ~= "entity-ghost"
        and entity.surface == context.surface
        and inside(entity.position, area)
        and context.visible(entity)
end

function Warnings.update(player, state, context, options, capabilities, world_version)
    local mode = options.warnings
    local active = not context.blocked
        and mode ~= "off"
        and (mode ~= "alt" or context.alt)
        and (mode ~= "hover" or context.selected ~= nil)
        and (options.warning_inserters or options.warning_drills or options.warning_fluids ~= "off")
    if not active then
        Warnings.clear(state)
        return false
    end
    if state.surface ~= context.surface.index or state.force ~= player.force.index or state.options ~= options then
        Warnings.clear(state)
        state.records, state.order, state.pickups, state.drops = {}, {}, {}, {}
        state.cursor, state.next_scan, state.generation, state.completed = 1, 0, 0, 0
        state.surface, state.force, state.options = context.surface.index, player.force.index, options
    end
    local view = viewport(player, context)
    local reach, size = capabilities.ground_reach, Warnings.work_limits.cell_size
    local focus = context.selected and context.selected.position or context.position
    local bounds = mode == "hover" and { { focus.x, focus.y }, { focus.x, focus.y } } or view
    local area = {
        { math.floor((bounds[1][1] - 2 * reach) / size) * size, math.floor((bounds[1][2] - 2 * reach) / size) * size },
        { math.ceil((bounds[2][1] + 2 * reach) / size) * size, math.ceil((bounds[2][2] + 2 * reach) / size) * size },
    }
    local area_key = table.concat({ area[1][1], area[1][2], area[2][1], area[2][2] }, ":")
    if state.area_key ~= area_key then
        state.area, state.area_key, state.scan, state.next_scan, state.completed = area, area_key, nil, 0, 0
        state.covered = {}
    end
    if state.world_version ~= world_version then
        state.world_version, state.next_scan = world_version, 0
    end
    if state.selected ~= context.selected then
        if mode == "hover" and state.selected_record then
            clear_render(state.selected_record)
        end
        state.selected_record = nil
    end
    state.selected = context.selected
    if state.work and state.work.tick == context.tick then
        return true
    end
    state.work = { tick = context.tick, queries = 0, discoveries = 0, snapshots = 0 }
    if not state.scan and context.tick >= state.next_scan then
        state.generation = state.generation + 1
        state.scan = Scan.start(state.area, focus, size)
        state.scan.generation = state.generation
    end
    if state.scan then
        local scan = state.scan
        local first, last, queries, finished =
            Scan.next(scan, context.surface, capabilities.warning_types, false, Warnings.work_limits.discoveries)
        state.work.queries, state.work.discoveries = queries, last - first + 1
        if finished then
            state.completed, state.scan, state.next_scan =
                scan.generation, nil, context.tick + Warnings.work_limits.scan_ticks
        else
            for index = first, last do
                local entity = scan.pending[index]
                if eligible(entity, context, state.area) then
                    record_for(state, entity).generation = scan.generation
                end
            end
            if scan.pending_index > #scan.pending then
                local cell = scan.cells[scan.cell - 1]
                state.covered[cell.x .. ":" .. cell.y] = true
            end
        end
    end
    local function covered(point, origin)
        if not point then
            return true
        end
        if math.abs(point.x - origin.x) > reach or math.abs(point.y - origin.y) > reach then
            return false
        end
        -- A selected endpoint needs its possible handoff peers, not completion
        -- of every distant viewport cell. Never diagnose an unsearched halo.
        for y = math.floor((point.y - reach) / size), math.floor((point.y + reach) / size) do
            for x = math.floor((point.x - reach) / size), math.floor((point.x + reach) / size) do
                if not state.covered[x .. ":" .. y] then
                    return false
                end
            end
        end
        return true
    end
    local function update_record(record, selected)
        local entity = record.entity
        if
            not eligible(entity, context, state.area)
            or (not selected and record.generation and record.generation < state.completed)
        then
            remove_record(state, record)
            return false
        end
        endpoints(state, record)
        local show = not options.warning_ignored[entity.name]
            and (selected or (mode ~= "hover" and inside(entity.position, view)))
        if not show then
            clear_render(record)
            return true
        end
        if context.tick >= record.next_refresh then
            record.pickup_served, record.drop_served = served(state, record, "pickup"), served(state, record, "drop")
            local known = covered(record.pickup, entity.position) and covered(record.drop, entity.position)
            record.snapshot = Diagnostics.snapshot(record, options, known, player.force)
            draw(player, record, record.snapshot, options)
            record.next_refresh = context.tick + Warnings.work_limits.refresh_ticks
            state.work.snapshots = state.work.snapshots + 1
        end
        return true
    end
    local selected = context.selected
    local selected_type_allowed = false
    if selected and selected.valid then
        for _, kind in ipairs(capabilities.warning_types) do
            if selected.type == kind then
                selected_type_allowed = true
                break
            end
        end
    end
    if
        selected
        and selected.valid
        and selected.type ~= "entity-ghost"
        and eligible(selected, context, state.area)
        and selected_type_allowed
    then
        local record = record_for(state, selected)
        if update_record(record, true) then
            state.selected_record = record
        end
    end
    local remaining = math.min(Warnings.work_limits.refreshes, #state.order)
    while remaining > 0 and #state.order > 0 do
        if state.cursor > #state.order then
            state.cursor = 1
        end
        local record = state.records[state.order[state.cursor]]
        if record == state.selected_record or update_record(record, false) then
            state.cursor = state.cursor + 1
        end
        remaining = remaining - 1
    end
    return true
end

return Warnings
