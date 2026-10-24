local Policy = require("scripts.fluid-policy")
local Connections = require("scripts.fluid-connections")
local FluidRender = require("scripts.fluid-render")
local Scan = require("scripts.local-scan")
local Fluid = {}

-- Work is scheduled in spatial cells and entity units, never surface scans.
-- Native per-entity connection lists remain authoritative and are not truncated.
Fluid.work_limits = { cell_size = 16, discoveries = 16, refreshes = 8, refresh_ticks = 15, scan_ticks = 30 }

local function preferences(player)
    local values = settings.get_player_settings(player)
    return {
        context = values["no-alt-needed-fluid-context"].value,
        background = values["no-alt-needed-fluid-background"].value,
        radius = values["no-alt-needed-fluid-radius"].value,
        search_radius = values["no-alt-needed-fluid-search-radius"].value,
    }
end

function Fluid.held_prototype(player)
    local stack = player.cursor_stack
    if stack and stack.valid_for_read then
        return stack.prototype.place_result
    end
    local ghost = player.cursor_ghost
    if ghost then
        local item = type(ghost.name) == "string" and prototypes.item[ghost.name] or ghost.name
        return item and item.place_result
    end
    return nil
end

local function fluid_tool(prototype)
    return prototype and (#prototype.fluidbox_prototypes > 0 or prototype.show_fluid_visualization_when_in_cursor)
end

local function inspectable(entity, context)
    return entity
        and entity.valid
        and entity.surface.index == context.surface.index
        and context.visible(entity)
        and Connections.participates(Connections.prototype(entity))
end

function Fluid.active(player, context)
    if context.blocked or not player.valid or not Connections.configuration().has_owned then
        return false
    end
    local options = preferences(player)
    if options.background ~= "none" then
        return true
    end
    if not options.context then
        return false
    end
    if inspectable(context.selected, context) then
        return true
    end
    local held = Fluid.held_prototype(player)
    if context.selected and fluid_tool(held) then
        return true
    end
    return held ~= nil and #Connections.preview(held).ports > 0
end

function Fluid.clear(state)
    for _, record in pairs(state.records or {}) do
        FluidRender.clear(record)
    end
    if state.preview then
        FluidRender.clear(state.preview)
    end
    for key in pairs(state) do
        state[key] = nil
    end
end

local function entity_key(entity)
    return entity.unit_number or string.format("%s@%.17g,%.17g", entity.name, entity.position.x, entity.position.y)
end

local function record_for(state, entity)
    local key = entity_key(entity)
    local record = state.records[key]
    if not record then
        record = { entity = entity, key = key, slot = #state.order + 1, next_refresh = 0, seen_generation = 0 }
        state.records[key] = record
        state.order[record.slot] = key
    end
    return record
end

local function remove_record(state, record)
    FluidRender.clear(record)
    local last = state.order[#state.order]
    state.order[record.slot] = last
    state.order[#state.order] = nil
    if last ~= record.key then
        state.records[last].slot = record.slot
    end
    state.records[record.key] = nil
end

local function desired_mode(entity, context, options, held)
    if not inspectable(entity, context) then
        return nil
    end
    if options.context and entity == context.selected then
        return "both"
    end
    local in_envelope = Policy.distance_squared(context.position, entity.bounding_box) <= options.search_radius ^ 2
    if not in_envelope then
        return nil
    end
    if
        options.context
        and held
        and context.selected
        and Policy.distance_squared(context.selected.position, entity.bounding_box) <= options.radius ^ 2
    then
        return "both"
    end
    return options.background ~= "none" and options.background or nil
end

local function start_scan(state, context, options, held)
    local construction = options.context and held and context.selected
    if options.background == "none" and not construction then
        return nil
    end
    local radius = options.search_radius
    local left, top = context.position.x - radius, context.position.y - radius
    local right, bottom = context.position.x + radius, context.position.y + radius
    local focus = context.selected and context.selected.position or context.position
    if options.background == "none" then
        left = math.max(left, focus.x - options.radius)
        top = math.max(top, focus.y - options.radius)
        right = math.min(right, focus.x + options.radius)
        bottom = math.min(bottom, focus.y + options.radius)
    end
    local scan = Scan.start({ { left, top }, { right, bottom } }, focus, Fluid.work_limits.cell_size)
    state.generation = state.generation + 1
    scan.generation = state.generation
    return scan
end

local function discover(state, context, options, held)
    if not state.scan and context.tick >= state.next_scan then
        state.scan = start_scan(state, context, options, held)
    end
    local scan = state.scan
    if not scan then
        return
    end
    local first, last, queries, finished =
        Scan.next(scan, context.surface, Policy.categories, true, Fluid.work_limits.discoveries)
    state.work.queries = queries
    if finished then
        state.completed_generation = scan.generation
        state.scan = nil
        state.next_scan = context.tick + Fluid.work_limits.scan_ticks
        return
    end
    state.work.discoveries = last - first + 1
    for index = first, last do
        local entity = scan.pending[index]
        if entity.valid then
            local key = entity_key(entity)
            if not scan.seen[key] then
                scan.seen[key] = true
                if desired_mode(entity, context, options, held) then
                    record_for(state, entity).seen_generation = scan.generation
                end
            end
        end
    end
end

local function update_record(player, state, record, context, options, held)
    local mode = desired_mode(record.entity, context, options, held)
    if not mode then
        remove_record(state, record)
        return false
    end
    if record.entity ~= context.selected and record.seen_generation < state.completed_generation then
        remove_record(state, record)
        return false
    end
    if record.mode ~= mode or context.tick >= record.next_refresh then
        local snapshot = Connections.snapshot(record.entity)
        FluidRender.refresh(player, record, snapshot, mode, context.surface, false)
        record.next_refresh = context.tick + Fluid.work_limits.refresh_ticks
        state.work.snapshots = state.work.snapshots + 1
    end
    return true
end

function Fluid.update(player, state, context)
    if not Fluid.active(player, context) then
        Fluid.clear(state)
        return false
    end
    local options = preferences(player)
    local held_prototype = Fluid.held_prototype(player)
    local held = options.context and fluid_tool(held_prototype)
    if
        state.surface ~= context.surface.index
        or state.force ~= player.force.index
        or state.selected ~= context.selected
        or state.held ~= held_prototype
        or state.background ~= options.background
        or state.context ~= options.context
        or state.radius ~= options.radius
        or state.search_radius ~= options.search_radius
    then
        Fluid.clear(state)
        state.records = {}
        state.order = {}
        state.cursor = 1
        state.generation = 0
        state.completed_generation = 0
        state.next_scan = 0
        state.surface = context.surface.index
        state.force = player.force.index
        state.selected = context.selected
        state.held = held_prototype
        state.background = options.background
        state.context = options.context
        state.radius = options.radius
        state.search_radius = options.search_radius
        state.work = {}
    end
    state.work.queries = 0
    state.work.discoveries = 0
    state.work.snapshots = 0
    if options.context and inspectable(context.selected, context) then
        local selected = record_for(state, context.selected)
        update_record(player, state, selected, context, options, held)
    end
    if held and Connections.participates(held_prototype) and not state.preview then
        state.preview = {}
        local snapshot = Connections.preview(held_prototype)
        FluidRender.refresh(player, state.preview, snapshot, "both", context.surface, true)
        state.preview_unsupported = snapshot.unresolved
    end
    discover(state, context, options, held)
    local remaining = math.min(Fluid.work_limits.refreshes, #state.order)
    while remaining > 0 and #state.order > 0 do
        if state.cursor > #state.order then
            state.cursor = 1
        end
        local record = state.records[state.order[state.cursor]]
        if record.entity == context.selected or update_record(player, state, record, context, options, held) then
            state.cursor = state.cursor + 1
        end
        remaining = remaining - 1
    end
    return true
end

Fluid.snapshot = Connections.snapshot
Fluid.preview = Connections.preview

return Fluid
