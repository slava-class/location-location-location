local export = { events = {} }
local deepcopy = require("__core__.lualib.util").table.deepcopy
local appearance = require("reversed_underground_belt_detector.appearance")
local preferences = require("reversed_underground_belt_detector.underground_preferences")
local planner = require("reversed_underground_belt_detector.warning_planner")
local alert_setting = preferences.alert_setting
local message_key = "reversed-underground-belt-detector.warning"
---@type table<string, LocalisedString>
local messages = {
    input = { message_key, { "reversed-underground-belt-detector.input" } },
    output = { message_key, { "reversed-underground-belt-detector.output" } },
}
local icon = { type = "item", name = "underground-belt" }
local vectors = {
    [defines.direction.north] = { x = 0, y = -1 },
    [defines.direction.east] = { x = 1, y = 0 },
    [defines.direction.south] = { x = 0, y = 1 },
    [defines.direction.west] = { x = -1, y = 0 },
}
local validation_period = 60
local validation_limit = 64

-- The renderer copies Color values. Reuse both pulse and steady colors across
-- warnings rather than allocating colors or rebuilding sprites on each step.
local mouth_tint = deepcopy(appearance.mouth_tint)
local span_tint = deepcopy(appearance.span_tint)
local steady_mouth_tint = deepcopy(appearance.mouth_tint)
local steady_span_tint = deepcopy(appearance.span_tint)

---@param tint Color.struct
---@param base { r: number, g: number, b: number }
---@param alpha number
local function set_opacity(tint, base, alpha)
    -- Factorio expects premultiplied colors. Alpha alone leaves the source
    -- at full brightness instead of fading its fixed warning hue.
    tint.r, tint.g, tint.b, tint.a = base.r * alpha, base.g * alpha, base.b * alpha, alpha
end

set_opacity(steady_mouth_tint, appearance.mouth_tint, appearance.mouth_tint.a)
set_opacity(steady_span_tint, appearance.span_tint, appearance.span_tint.a)

local function update_tints(tick)
    local wave = (1 + math.cos(2 * math.pi * (tick % appearance.pulse_period) / appearance.pulse_period)) / 2
    set_opacity(
        mouth_tint,
        appearance.mouth_tint,
        appearance.mouth_tint.a * (appearance.mouth_pulse_floor + (1 - appearance.mouth_pulse_floor) * wave)
    )
    set_opacity(
        span_tint,
        appearance.span_tint,
        appearance.span_tint.a * (appearance.span_pulse_floor + (1 - appearance.span_pulse_floor) * wave)
    )
end

local function pulse(event)
    local state = storage.reversed_underground_belt_detector
    ---@cast state RUBDState
    if not next(state.warnings) then
        return
    end
    local requested = false
    for _, player in pairs(game.players) do
        if player.mod_settings[preferences.overlay_setting].value == "pulsing" then
            requested = true
            break
        end
    end
    if not requested then
        return
    end
    update_tints(event.tick)
    for _, warning in pairs(state.warnings) do
        if warning.sprite.valid and warning.sprite.visible then
            warning.sprite.color = mouth_tint
        end
        if warning.span then
            for _, sprite in ipairs(warning.span) do
                if sprite.valid and sprite.visible then
                    sprite.color = span_tint
                end
            end
        end
    end
end

---@param entity LuaEntity
---@param dx number Exterior offset, away from the prospective underground span.
---@param dy number
---@param cached RUBDExterior?
---@return RUBDExterior?
local function exterior_belt(entity, dx, dy, cached)
    local direction = entity.direction
    local vector = vectors[direction]
    local sign = entity.belt_to_ground_type == "input" and -1 or 1
    if not vector or sign * vector.x ~= dx or sign * vector.y ~= dy then
        return -- A belt behind the hood is not attached to the exposed mouth.
    end
    local position = entity.position
    ---@cast position MapPosition.struct
    local x, y = position.x + dx, position.y + dy
    local force, surface = entity.force, entity.surface
    -- Revalidate positive lookups only; absent or perpendicular belts are not cached.
    if
        cached
        and cached.x == x
        and cached.y == y
        and cached.surface == surface
        and cached.entity.valid
        and cached.entity.direction % 8 == direction % 8
        and cached.entity.force == force
    then
        return cached
    end
    for _, belt in
        pairs(surface.find_entities_filtered({
            position = { x, y },
            type = "transport-belt",
            force = force,
        }))
    do
        if belt.direction % 8 == direction % 8 then
            return { entity = belt, x = x, y = y, surface = surface }
        end
    end
end

---@param entity LuaEntity
---@param neighbour LuaEntity
---@param warnings table<integer, RUBDWarning?>
---@return number?, RUBDExterior?, RUBDExterior?
local function reversed_connection(entity, neighbour, warnings)
    if neighbour.force ~= entity.force then
        return
    end
    local first, second = entity.position, neighbour.position
    ---@cast first MapPosition.struct
    ---@cast second MapPosition.struct
    local distance = math.abs(second.x - first.x) + math.abs(second.y - first.y)
    if distance == 0 or (first.x ~= second.x and first.y ~= second.y) then
        return
    end
    local dx, dy = (second.x - first.x) / distance, (second.y - first.y) / distance
    local toward = dx == 1 and defines.direction.east
        or dx == -1 and defines.direction.west
        or dy == 1 and defines.direction.south
        or defines.direction.north
    local id = entity.unit_number --[[@as integer]]
    local neighbour_id = neighbour.unit_number --[[@as integer]]
    local own, other = warnings[id], warnings[neighbour_id]
    local first_belt = exterior_belt(entity, -dx, -dy, own and own.exterior)
    local second_belt = exterior_belt(neighbour, dx, dy, other and other.exterior)
    if not first_belt and not second_belt then
        return
    end
    local flow = first_belt and first_belt.entity.direction or assert(second_belt).entity.direction
    if second_belt and second_belt.entity.direction ~= flow then
        return -- Conflicting surface evidence does not identify an underground correction.
    end
    local first_role = flow == toward and "input" or "output"
    local second_role = flow == toward and "output" or "input"
    if
        entity.direction == flow
        and neighbour.direction == flow
        and entity.belt_to_ground_type == first_role
        and neighbour.belt_to_ground_type == second_role
    then
        return
    end
    return distance, first_belt, second_belt
end

---@param entity LuaEntity
---@param horizontal boolean
---@return LuaEntity[]
local function nearby_mouths(entity, horizontal)
    local reach = assert(entity.prototype.max_underground_distance)
    local position = entity.position
    ---@cast position MapPosition.struct
    local dx, dy = horizontal and reach or 0.25, horizontal and 0.25 or reach
    return entity.surface.find_entities_filtered({
        area = { { position.x - dx, position.y - dy }, { position.x + dx, position.y + dy } },
        name = entity.name,
        force = entity.force,
    })
end

---@param entity LuaEntity
---@param warnings table<integer, RUBDWarning?>
---@return LuaEntity?, number?, RUBDExterior?, RUBDExterior?
local function candidate_connection(entity, warnings)
    local horizontal = entity.direction % 8 == defines.direction.east
    local position = entity.position
    ---@cast position MapPosition.struct
    local reach = assert(entity.prototype.max_underground_distance)
    ---@type LuaEntity?, LuaEntity?, number?, number?
    local before, after, before_distance, after_distance
    for _, other in pairs(nearby_mouths(entity, horizontal)) do
        if other ~= entity and other.direction % 8 == entity.direction % 8 then
            local target = other.position
            ---@cast target MapPosition.struct
            local aligned = horizontal and target.y == position.y or not horizontal and target.x == position.x
            local delta = horizontal and target.x - position.x or target.y - position.y
            local distance = math.abs(delta)
            if aligned and distance > 0 and distance <= reach then
                -- Do not look through a nearer compatible mouth, including one paired elsewhere.
                if delta < 0 and (not before_distance or distance < before_distance) then
                    before, before_distance = other, distance
                elseif delta > 0 and (not after_distance or distance < after_distance) then
                    after, after_distance = other, distance
                end
            end
        end
    end
    ---@type LuaEntity?, number?, RUBDExterior?, RUBDExterior?
    local found, gap, first_belt, second_belt
    for side = 1, 2 do
        local other = before
        if side == 2 then
            other = after
        end
        if other and not other.underground_belt_neighbour then
            local distance, first, second = reversed_connection(entity, other, warnings)
            if distance then
                if found then
                    return -- Two plausible connections are ambiguous; do not guess a partner.
                end
                found, gap, first_belt, second_belt = other, distance, first, second
            end
        end
    end
    return found, gap, first_belt, second_belt
end

---@param entity LuaEntity
---@param warnings table<integer, RUBDWarning?>
---@return LuaEntity?, number?, RUBDExterior?, RUBDExterior?
local function reversed_neighbour(entity, warnings)
    if not entity.valid or not vectors[entity.direction] then
        return
    end
    local neighbour = entity.underground_belt_neighbour
    if neighbour then
        local distance, first, second = reversed_connection(entity, neighbour, warnings)
        if distance then
            return neighbour, distance, first, second
        end
        return
    end
    local candidate, distance, first, second = candidate_connection(entity, warnings)
    if candidate and candidate_connection(candidate, warnings) == entity then
        return candidate, distance, first, second
    end
end

---@param warning RUBDRender
local function clear_span(warning)
    if warning.span then
        for _, sprite in ipairs(warning.span) do
            if sprite.valid then
                sprite.destroy()
            end
        end
        warning.span, warning.neighbour, warning.span_direction, warning.span_distance = nil, nil, nil, nil
    end
end

---@param muted boolean
---@param steady boolean
local function arrow_tint(muted, steady)
    if steady then
        return muted and steady_span_tint or steady_mouth_tint
    end
    return muted and span_tint or mouth_tint
end

---@param entity LuaEntity
---@param target ScriptRenderTarget
---@param muted boolean
---@param steady boolean
---@param players LuaPlayer[]
local function arrow(entity, target, muted, steady, players)
    local scale = muted and appearance.span_scale or appearance.mouth_scale
    return rendering.draw_sprite({
        sprite = appearance.sprite,
        surface = entity.surface,
        target = target,
        orientation = entity.direction / 16,
        tint = arrow_tint(muted, steady),
        forces = { entity.force },
        players = players,
        visible = #players > 0,
        x_scale = scale,
        y_scale = scale,
    })
end

---@param warning RUBDRender
---@param steady boolean
---@param audience RUBDAudience
local function update_span(warning, steady, audience)
    local entity = warning.entity
    if entity.belt_to_ground_type ~= "input" or #audience.mouths == 0 then
        clear_span(warning)
        return
    end
    local neighbour = entity.underground_belt_neighbour
    if not neighbour then
        clear_span(warning)
        return
    end
    ---@cast neighbour LuaEntity
    local players = preferences.span_players(audience, entity, neighbour)
    local start, finish = entity.position, neighbour.position
    ---@cast start MapPosition.struct
    ---@cast finish MapPosition.struct
    local distance = math.abs(finish.x - start.x) + math.abs(finish.y - start.y)
    local rebuild = warning.neighbour ~= neighbour
        or warning.span_direction ~= entity.direction
        or warning.span_distance ~= distance
    if not rebuild and warning.span then
        for _, sprite in ipairs(warning.span) do
            if not sprite.valid then
                rebuild = true
                break
            end
        end
    end
    if rebuild then
        clear_span(warning)
        warning.span, warning.neighbour = {}, neighbour
        warning.span_direction, warning.span_distance = entity.direction, distance
        local vector = vectors[entity.direction]
        for step = 1, distance - 1 do
            warning.span[#warning.span + 1] =
                arrow(entity, { entity = entity, offset = { vector.x * step, vector.y * step } }, true, steady, players)
        end
    end
    local span = warning.span
    ---@cast span LuaRenderObject[]
    for _, sprite in ipairs(span) do
        sprite.forces = { entity.force }
        sprite.players = players
        sprite.visible = #players > 0
        sprite.color = arrow_tint(true, steady)
    end
end

---@param view RUBDRender
local function clear_render(view)
    if view.sprite.valid then
        view.sprite.destroy()
    end
    clear_span(view)
end

---@param warning RUBDWarning
local function clear_marker(warning)
    if warning.intentional_marker then
        if warning.intentional_marker.valid then
            warning.intentional_marker.destroy()
        end
        warning.intentional_marker = nil
    end
end

---@param warning RUBDWarning
local function clear(warning)
    clear_marker(warning)
    clear_render(warning)
    if warning.steady then
        clear_render(warning.steady)
    end
end

---@param view RUBDRender
---@param steady boolean
---@param audience RUBDAudience
local function sync_view(view, steady, audience)
    view.sprite.forces = { view.entity.force }
    view.sprite.players = audience.mouths
    view.sprite.visible = #audience.mouths > 0
    view.sprite.orientation = view.entity.direction / 16
    view.sprite.color = arrow_tint(false, steady)
    update_span(view, steady, audience)
end

---@param warning RUBDWarning
---@param audiences RUBDAudiences
local function sync_warning(warning, audiences)
    if warning.acknowledged then
        warning.sprite.visible = false
        clear_span(warning)
        if warning.steady then
            clear_render(warning.steady)
            warning.steady = nil
        end
        if #audiences.managers == 0 then
            clear_marker(warning)
        else
            local marker = warning.intentional_marker
            if not marker or not marker.valid then
                marker = rendering.draw_sprite({
                    sprite = "utility/check_mark_white",
                    surface = warning.entity.surface,
                    target = warning.entity,
                    render_layer = "entity-info-icon",
                    x_scale = 0.8,
                    y_scale = 0.8,
                    forces = { warning.entity.force },
                    players = audiences.managers,
                })
                warning.intentional_marker = marker
            end
            marker.forces = { warning.entity.force }
            marker.players = audiences.managers
        end
        return
    end
    clear_marker(warning)
    sync_view(warning, false, audiences.pulsing)
    local steady = warning.steady
    if #audiences.steady.mouths > 0 then
        if not steady or not steady.sprite.valid then
            if steady then
                clear_render(steady)
            end
            steady = {
                entity = warning.entity,
                sprite = arrow(warning.entity, warning.entity, false, true, audiences.steady.mouths),
            }
            warning.steady = steady
        end
        sync_view(steady, true, audiences.steady)
    elseif steady then
        clear_render(steady)
        warning.steady = nil
    end
end
---@param cache table<number, RUBDAudiences?>
---@param force LuaForce
---@return RUBDAudiences
local function audiences_for(cache, force)
    local audiences = cache[force.index]
    if not audiences then
        audiences = preferences.audiences(force)
        cache[force.index] = audiences
    end
    return audiences
end

local function refresh_overlays()
    local state = storage.reversed_underground_belt_detector
    if not state then
        return
    end
    state.hovering = {}
    state.managing = {}
    for _, player in pairs(game.players) do
        state.hovering[player.index] = preferences.hovered_mouth(player)
        state.managing[player.index] = planner.held(player)
        planner.refresh_hint(player)
    end
    update_tints(game.tick)
    ---@type table<number, RUBDAudiences?>
    local by_force = {}
    for _, warning in pairs(state.warnings) do
        if warning.entity.valid and warning.sprite.valid then
            local force = warning.entity.force
            ---@cast force LuaForce
            sync_warning(warning, audiences_for(by_force, force))
        end
    end
end

---@param warnings table<integer, RUBDWarning?>
local function refresh_alerts(warnings)
    for _, player in pairs(game.players) do
        local force = player.force
        ---@cast force LuaForce
        -- Alert filters are alternatives, not a conjunction. Adding type/position
        -- here would also remove unrelated custom alerts.
        for _, message in pairs(messages) do
            player.remove_alert({ message = message })
        end
        if player.mod_settings[alert_setting].value and next(warnings) then
            local occupied = {}
            for _, alerts in pairs(player.get_alerts({ type = defines.alert_type.custom })) do
                for _, alert in pairs(alerts[defines.alert_type.custom] or {}) do
                    if alert.target and alert.target.valid and alert.target.unit_number then
                        occupied[alert.target.unit_number] = true
                    end
                end
            end
            for id, warning in pairs(warnings) do
                local entity = warning.entity
                if not warning.acknowledged and entity.valid and entity.force == force and not occupied[id] then
                    local surface, position = entity.surface, entity.position
                    ---@cast position MapPosition.struct
                    if
                        (surface.platform and surface.platform.force == force)
                        or force.is_chunk_charted(
                            surface,
                            { x = math.floor(position.x / 32), y = math.floor(position.y / 32) }
                        )
                    then
                        -- The engine keeps one custom alert per entity. Leave
                        -- another mod's alert intact; our world icon still shows.
                        player.add_custom_alert(entity, icon, messages[entity.belt_to_ground_type], true)
                    end
                end
            end
        end
    end
end

-- Initialization also retires parameter shapes saved by earlier builds.
local function clear_owned_alerts()
    for _, player in pairs(game.players) do
        local removed = {}
        for _, group in pairs(player.get_alerts({ type = defines.alert_type.custom })) do
            for _, alert in pairs(group[defines.alert_type.custom] or {}) do
                local value = alert.message
                if type(value) == "table" and value[1] == message_key then
                    local signature = helpers.table_to_json(value)
                    if not removed[signature] then
                        player.remove_alert({ message = value })
                        removed[signature] = true
                    end
                end
            end
        end
    end
end

---@param state RUBDState
---@param entity LuaEntity
local function queue_mouth(state, entity)
    local id = entity.unit_number
    ---@cast id integer
    state.pending[id] = entity
    local warning = state.warnings[id]
    if warning then
        local previous = state.warnings[warning.partner_id]
        if previous then
            state.pending[warning.partner_id] = previous.entity
        end
    end
end

---@param entity LuaEntity
local function queue(entity)
    if entity.valid and entity.type == "underground-belt" then
        local state = storage.reversed_underground_belt_detector
        ---@cast state RUBDState
        queue_mouth(state, entity)
        local neighbour = entity.underground_belt_neighbour
        if neighbour then
            queue_mouth(state, neighbour)
        end
    end
end

---@param entity LuaEntity
local function queue_neighbourhood(entity)
    queue(entity)
    if entity.valid and entity.type == "underground-belt" then
        local state = storage.reversed_underground_belt_detector
        ---@cast state RUBDState
        -- Construction/removal can reveal a candidate on the old or new axis.
        -- This range search is event-driven, not added to each validation entry.
        for axis = 1, 2 do
            for _, other in pairs(nearby_mouths(entity, axis == 1)) do
                queue_mouth(state, other)
            end
        end
    end
end

local function changed(event)
    local entity = event.entity
    if not entity.valid or (entity.type ~= "transport-belt" and entity.type ~= "underground-belt") then
        return
    end
    queue_neighbourhood(entity)
    -- Batch until the next tick: removal events still expose the old entity,
    -- and construction can create either end of the pair first.
    local position = entity.position
    for _, nearby in
        pairs(entity.surface.find_entities_filtered({
            area = { { position.x - 1, position.y - 1 }, { position.x + 1, position.y + 1 } },
            type = "underground-belt",
        }))
    do
        queue_neighbourhood(nearby)
    end
end

---@param view RUBDRender
local function render_valid(view)
    if not view.sprite.valid then
        return false
    end
    if view.span then
        for _, sprite in ipairs(view.span) do
            if not sprite.valid then
                return false
            end
        end
    end
    return true
end

---@param state RUBDState
---@param warning RUBDWarning
local function unlink_validation(state, warning)
    local previous, following = warning.validation_previous, warning.validation_next
    if previous then
        local previous_warning = state.warnings[previous]
        ---@cast previous_warning RUBDWarning
        previous_warning.validation_next = following
    else
        state.validation_first = following
    end
    if following then
        local next_warning = state.warnings[following]
        ---@cast next_warning RUBDWarning
        next_warning.validation_previous = previous
    else
        state.validation_last = previous
    end
    warning.validation_previous, warning.validation_next = nil, nil
end

---@param state RUBDState
---@param id integer
---@param warning RUBDWarning
local function append_validation(state, id, warning)
    local last = state.validation_last
    warning.validation_previous = last
    if last then
        local last_warning = state.warnings[last]
        ---@cast last_warning RUBDWarning
        last_warning.validation_next = id
    else
        state.validation_first = id
    end
    state.validation_last = id
end
local function initialize()
    local previous = storage.reversed_underground_belt_detector
    if previous then
        for _, warning in pairs(previous.warnings) do
            clear(warning)
        end
    end
    clear_owned_alerts()
    ---@type RUBDState
    local state = {
        pending = {},
        warnings = previous and previous.warnings or {},
        alerts_dirty = false,
        hovering = {},
        managing = {},
        validation_count = 0,
        validation_credit = 0,
        validation_peak = 0,
        validation_previous_peak = 0,
        validation_window_end = game.tick + validation_period,
    }
    storage.reversed_underground_belt_detector = state
    -- Preserve player decisions through configuration changes, but revalidate
    -- both endpoint snapshots before presenting the rebuilt warning objects.
    for id, warning in pairs(state.warnings) do
        warning.validation_previous, warning.validation_next = nil, nil
        append_validation(state, id, warning)
        state.validation_count = state.validation_count + 1
        state.pending[id] = warning.entity
    end
    -- Existing factories are surveyed only on installation/configuration change;
    -- ordinary play checks changed neighbourhoods and active warnings, not the map.
    for _, surface in pairs(game.surfaces) do
        for _, entity in pairs(surface.find_entities_filtered({ type = "underground-belt" })) do
            queue(entity)
        end
    end
    refresh_overlays()
end

---@param warning RUBDWarning?
---@param entity LuaEntity
---@param partner_id integer
---@param distance number
---@param exterior RUBDExterior?
local function same_arrangement(warning, entity, partner_id, distance, exterior)
    return warning ~= nil
        and warning.entity == entity
        and warning.partner_id == partner_id
        and warning.force_index == entity.force.index
        and warning.direction == entity.direction
        and warning.belt_type == entity.belt_to_ground_type
        and warning.distance == distance
        and warning.exterior_direction == (exterior and exterior.entity.direction)
end

---@param state RUBDState
---@param entity LuaEntity
---@param partner_id integer
---@param distance number
---@param exterior RUBDExterior?
---@param acknowledged boolean
---@param by_force table<number, RUBDAudiences?>
local function update_warning(state, entity, partner_id, distance, exterior, acknowledged, by_force)
    local id = entity.unit_number
    ---@cast id integer
    local warning = state.warnings[id]
    if warning then
        warning.exterior = exterior
    end
    if
        warning
        and same_arrangement(warning, entity, partner_id, distance, exterior)
        and warning.acknowledged == acknowledged
        and render_valid(warning)
        and (not warning.steady or render_valid(warning.steady))
        and (not warning.intentional_marker or warning.intentional_marker.valid)
    then
        return
    end
    local force = entity.force
    ---@cast force LuaForce
    local direction, belt_type = entity.direction, entity.belt_to_ground_type
    local audiences = audiences_for(by_force, force)
    if not warning then
        warning = {
            entity = entity,
            partner_id = partner_id,
            exterior = exterior,
            force_index = force.index,
            direction = direction,
            belt_type = belt_type,
            distance = distance,
            sprite = arrow(entity, entity, false, false, audiences.pulsing.mouths),
        }
        state.warnings[id] = warning
        append_validation(state, id, warning)
        state.validation_count = state.validation_count + 1
        state.alerts_dirty = true
    elseif not warning.sprite.valid then
        clear(warning)
        warning.sprite = arrow(entity, entity, false, false, audiences.pulsing.mouths)
    end
    warning.partner_id, warning.force_index = partner_id, force.index
    warning.direction, warning.belt_type, warning.distance = direction, belt_type, distance
    if warning.acknowledged ~= acknowledged then
        state.alerts_dirty = true
    end
    warning.acknowledged = acknowledged
    warning.exterior_direction = exterior and exterior.entity.direction
    sync_warning(warning, audiences)
end

---@param state RUBDState
local function process_pending(state)
    update_tints(game.tick)
    local pending = state.pending
    state.pending = {}
    for id, entity in pairs(pending) do
        -- Keep invalid mouths by ID so destruction clears their cached renderings.
        state.pending[id] = entity
        queue(entity)
    end
    ---@type table<number, RUBDAudiences?>
    local by_force = {}
    local checked = {}
    for id, entity in pairs(state.pending) do
        if not checked[id] then
            checked[id] = true
            local neighbour, distance, first_belt, second_belt = reversed_neighbour(entity, state.warnings)
            if neighbour then
                ---@cast distance number
                local partner_id = neighbour.unit_number
                ---@cast partner_id integer
                checked[partner_id] = true
                local first, second = state.warnings[id], state.warnings[partner_id]
                local acknowledged = first ~= nil
                    and second ~= nil
                    and first.acknowledged == true
                    and second.acknowledged == true
                    and same_arrangement(first, entity, partner_id, distance, first_belt)
                    and same_arrangement(second, neighbour, id, distance, second_belt)
                update_warning(state, entity, partner_id, distance, first_belt, acknowledged, by_force)
                update_warning(state, neighbour, id, distance, second_belt, acknowledged, by_force)
            else
                local warning = state.warnings[id]
                if warning then
                    clear(warning)
                    state.alerts_dirty = true
                    unlink_validation(state, warning)
                    state.validation_count = state.validation_count - 1
                    state.warnings[id] = nil
                end
            end
        end
    end
    state.pending = {}
end

local function update_changes(event)
    local state = storage.reversed_underground_belt_detector
    ---@cast state RUBDState
    -- Local construction/correction work keeps priority over background checks.
    if next(state.pending) then
        process_pending(state)
    end
    local count = state.validation_count
    if count == 0 then
        state.validation_credit, state.validation_peak, state.validation_previous_peak = 0, 0, 0
        state.validation_window_end = event.tick + validation_period
        if state.alerts_dirty then
            refresh_alerts(state.warnings)
            state.alerts_dirty = false
        end
    else
        if event.tick >= state.validation_window_end then
            state.validation_previous_peak = state.validation_peak
            state.validation_peak = 0
            state.validation_window_end = event.tick + validation_period
        end
        state.validation_peak = math.max(state.validation_peak, count)
        -- Retain at least 60 ticks of population history. Lowering the quota as
        -- corrections remove warnings would otherwise starve the remaining tail.
        local population = math.max(state.validation_peak, state.validation_previous_peak)
        local credit = state.validation_credit + population
        local budget = math.min(validation_limit, math.floor(credit / validation_period), count)
        state.validation_credit = credit % validation_period
        for _ = 1, budget do
            local id = state.validation_first
            ---@cast id integer
            local warning = state.warnings[id]
            ---@cast warning RUBDWarning
            unlink_validation(state, warning)
            append_validation(state, id, warning)
            state.pending[id] = warning.entity
        end
        if budget > 0 then
            process_pending(state)
        end
    end
    -- Native alerts retain their efficient 1 Hz batch. Offset it from the pulse,
    -- and retain the dirty flag so the last removed warning clears its alerts.
    if event.tick % validation_period == 1 and (count > 0 or state.alerts_dirty) then
        refresh_alerts(state.warnings)
        state.alerts_dirty = false
    end
end

---@param state RUBDState
---@param id integer?
---@param by_force table<number, RUBDAudiences?>
local function refresh_hover_pair(state, id, by_force)
    local warning = id and state.warnings[id]
    if not warning or warning.acknowledged or not warning.entity.valid then
        return
    end
    if warning.entity.belt_to_ground_type ~= "input" then
        warning = state.warnings[warning.partner_id]
    end
    if not warning or not warning.entity.valid then
        return
    end
    local force = warning.entity.force
    ---@cast force LuaForce
    local audiences = audiences_for(by_force, force)
    update_span(warning, false, audiences.pulsing)
    if warning.steady then
        update_span(warning.steady, true, audiences.steady)
    end
end

local function selection_changed(event)
    local player = game.get_player(event.player_index)
    local state = storage.reversed_underground_belt_detector
    if not player or not state then
        return
    end
    local previous = state.hovering[event.player_index]
    local selected = preferences.hovered_mouth(player)
    if previous == selected then
        return
    end
    state.hovering[event.player_index] = selected
    if previous and selected then
        local warning = state.warnings[previous]
        if warning and warning.partner_id == selected then
            return
        end
    end
    ---@type table<number, RUBDAudiences?>
    local by_force = {}
    refresh_hover_pair(state, previous, by_force)
    refresh_hover_pair(state, selected, by_force)
end

local function manage_area(event)
    if event.item ~= planner.name then
        return
    end
    local player = game.get_player(event.player_index)
    local state = storage.reversed_underground_belt_detector
    if not player or not state then
        return
    end
    local force = player.force
    ---@cast force LuaForce
    -- Revalidate selected warnings before acknowledging them, never create an
    -- ignored region or acknowledge an arrangement based on stale detection.
    for _, entity in ipairs(event.entities) do
        if
            entity.valid
            and entity.force == force
            and entity.type == "underground-belt"
            and state.warnings[entity.unit_number]
        then
            queue(entity)
        end
    end
    if next(state.pending) then
        process_pending(state)
    end
    local acknowledge = event.name == defines.events.on_player_selected_area
    local count = 0
    ---@type table<number, RUBDAudiences?>
    local by_force = {}
    for _, entity in ipairs(event.entities) do
        if entity.valid and entity.force == force and entity.type == "underground-belt" then
            local warning = state.warnings[entity.unit_number]
            local other = warning and state.warnings[warning.partner_id]
            if warning and other and (warning.acknowledged == true) ~= acknowledge then
                warning.acknowledged, other.acknowledged = acknowledge, acknowledge
                local audiences = audiences_for(by_force, force)
                sync_warning(warning, audiences)
                sync_warning(other, audiences)
                count = count + 1
            end
        end
    end
    if count > 0 then
        refresh_alerts(state.warnings)
        state.alerts_dirty = false
    end
    player.create_local_flying_text({
        text = { "reversed-underground-belt-detector." .. (acknowledge and "acknowledged" or "restored"), count },
        create_at_cursor = true,
    })
end

local function cursor_changed(event)
    local player = game.get_player(event.player_index)
    local state = storage.reversed_underground_belt_detector
    if player and state and state.managing[player.index] ~= planner.held(player) then
        refresh_overlays()
    end
end

export.on_init = initialize
export.on_configuration_changed = initialize
export.on_nth_tick = { [appearance.pulse_interval] = pulse }
export.events[defines.events.on_tick] = update_changes
export.events[defines.events.on_runtime_mod_setting_changed] = function(event)
    if event.setting == alert_setting then
        local state = storage.reversed_underground_belt_detector
        if state then
            refresh_alerts(state.warnings)
        end
    end
    if event.setting == preferences.overlay_setting then
        refresh_overlays()
    end
end
export.events[defines.events.on_selected_entity_changed] = selection_changed
export.events[defines.events.on_player_selected_area] = manage_area
export.events[defines.events.on_player_alt_selected_area] = manage_area
export.events[defines.events.on_player_cursor_stack_changed] = cursor_changed
export.events[defines.events.on_player_changed_surface] = refresh_overlays
export.events[defines.events.on_player_removed] = refresh_overlays
export.events[defines.events.on_player_changed_force] = refresh_overlays
export.events[defines.events.on_player_joined_game] = refresh_overlays
export.events[defines.events.on_player_left_game] = refresh_overlays
for _, event in ipairs({
    defines.events.on_built_entity,
    defines.events.on_robot_built_entity,
    defines.events.on_space_platform_built_entity,
    defines.events.script_raised_built,
    defines.events.script_raised_revive,
    defines.events.on_player_rotated_entity,
    defines.events.on_player_flipped_entity,
    defines.events.on_player_mined_entity,
    defines.events.on_robot_mined_entity,
    defines.events.on_space_platform_mined_entity,
    defines.events.on_entity_died,
    defines.events.script_raised_destroy,
}) do
    export.events[event] = changed
end
export.events[defines.events.on_entity_cloned] = function(event)
    changed({ entity = event.destination })
end

return export
