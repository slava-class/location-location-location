local Inspect = require("scripts.inspect")
local Presentation = require("scripts.presentation")
local Nearby = {}
local recipe_types = { "assembling-machine", "furnace", "rocket-silo", "entity-ghost" }
local work_per_tick = 12
local grace_ticks = 20

-- The circular inclusion boundary is distance to the collision footprint, not
-- distance to its centre. Tangent large buildings are included.
function Nearby.includes(entity, position, radius)
    local box = entity.bounding_box
    local dx = math.max(box.left_top.x - position.x, 0, position.x - box.right_bottom.x)
    local dy = math.max(box.left_top.y - position.y, 0, position.y - box.right_bottom.y)
    return dx * dx + dy * dy <= radius * radius
end

function Nearby.clear(state)
    for index, entry in pairs(state.entries or {}) do
        Presentation.clear(entry.render)
        state.entries[index] = nil
    end
    state.entries = state.entries or {}
    state.candidates = nil
    state.anchor, state.cursor, state.version, state.focus = nil, 1, nil, nil
    state.next_cycle, state.missing_since, state.mode = nil, nil, nil
end

function Nearby.update(player, state, context, preferences, version)
    if context.blocked or context.alt or not preferences.nearby then
        Nearby.clear(state)
        return false
    end
    if state.mode ~= preferences.nearby_focus then
        state.mode, state.missing_since = preferences.nearby_focus, nil
    end
    local selected = context.selected
    local anchor
    if selected then
        anchor, state.missing_since = selected, nil
    elseif preferences.nearby_focus ~= "selection" then
        anchor = state.anchor
        if preferences.nearby_focus == "grace" and anchor then
            if not state.missing_since then
                state.missing_since = context.tick
            end
            if context.tick - state.missing_since >= grace_ticks then
                anchor = nil
            end
        end
    end
    local focus = context.pointer
    if focus then
        anchor, state.missing_since = nil, nil
    elseif anchor and anchor.valid and anchor.surface == context.surface and context.visible(anchor) then
        focus = anchor.position
    else
        Nearby.clear(state)
        return false
    end
    local rebuild = state.anchor ~= anchor
        or state.radius ~= preferences.radius
        or state.version ~= version
        or not state.focus
        or state.focus.x ~= focus.x
        or state.focus.y ~= focus.y
    if rebuild then
        ---@type table<uint32, table>
        local retained = {}
        for _, entry in pairs(state.entries or {}) do
            retained[entry.unit] = entry
        end
        state.anchor, state.radius, state.version = anchor, preferences.radius, version
        state.focus = { x = focus.x, y = focus.y }
        local radius = preferences.radius + 1 / 256 -- Query includes exact tangencies; the predicate is authoritative.
        state.candidates = context.surface.find_entities_filtered({
            area = { { focus.x - radius, focus.y - radius }, { focus.x + radius, focus.y + radius } },
            type = recipe_types,
        })
        table.sort(state.candidates, function(a, b)
            if a == selected or b == selected then
                return a == selected and b ~= selected
            end
            if a.unit_number and b.unit_number then
                return a.unit_number < b.unit_number
            end
            if a.position.x ~= b.position.x then
                return a.position.x < b.position.x
            end
            if a.position.y ~= b.position.y then
                return a.position.y < b.position.y
            end
            return a.name < b.name
        end)
        state.entries = {}
        for index, entity in ipairs(state.candidates) do
            local entry = retained[entity.unit_number]
            if entry and context.visible(entity) and Nearby.includes(entity, focus, preferences.radius) then
                state.entries[index], retained[entity.unit_number] = entry, nil
            end
        end
        for _, entry in pairs(retained) do
            Presentation.clear(entry.render)
        end
        state.cursor, state.next_cycle = 1, nil
    end
    local candidates = state.candidates
    if state.next_cycle and context.tick < state.next_cycle then
        return true
    end
    if state.cursor > #candidates then
        state.cursor = 1
    end
    for _ = 1, math.min(work_per_tick, #candidates - state.cursor + 1) do
        local index = state.cursor
        state.cursor = index + 1
        local entity = candidates[index]
        local entry = state.entries[index]
        local include = entity.valid and context.visible(entity) and Nearby.includes(entity, focus, preferences.radius)
        local recipe = include and Inspect.recipe(entity) or nil
        if recipe then
            if not entry then
                entry = { entity = entity, unit = assert(entity.unit_number), render = {} }
                state.entries[index] = entry
            end
            Presentation.recipe(player, entity, recipe, entry.render)
        elseif entry then
            Presentation.clear(entry.render)
            state.entries[index] = nil
        end
    end
    if state.cursor > #candidates then
        state.next_cycle = context.tick + 15
    end
    return true
end

return Nearby
