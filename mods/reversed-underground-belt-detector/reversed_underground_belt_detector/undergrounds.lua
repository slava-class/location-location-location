local export = { events = {} }
local deepcopy = require("__core__.lualib.util").table.deepcopy
local appearance = require("reversed_underground_belt_detector.appearance")
local preferences = require("reversed_underground_belt_detector.underground_preferences")
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
---@param cached RUBDExterior?
---@return RUBDExterior?, MapPosition.struct?
local function opposing_belt(entity, cached)
    local direction = entity.direction
    local vector = vectors[direction]
    if not vector then
        return
    end
    local sign = entity.belt_to_ground_type == "input" and -1 or 1
    local position = entity.position
    ---@cast position MapPosition.struct
    local x, y = position.x + sign * vector.x, position.y + sign * vector.y
    local opposite = (direction + 8) % 16
    local force, surface = entity.force, entity.surface
    -- Valid transport belts cannot teleport. A proven lookup stays valid while
    -- its query point/surface, entity validity, force and direction still match.
    if
        cached
        and cached.x == x
        and cached.y == y
        and cached.surface == surface
        and cached.entity.valid
        and cached.entity.direction == opposite
        and cached.entity.force == force
    then
        return cached, position
    end
    for _, belt in
        pairs(surface.find_entities_filtered({
            position = { x, y },
            type = "transport-belt",
            force = force,
        }))
    do
        if belt.direction == opposite then
            return { entity = belt, x = x, y = y, surface = surface }, position
        end
    end
end

---@param entity LuaEntity
---@param warnings table<integer, RUBDWarning?>
---@return LuaEntity?, number?, RUBDExterior?, RUBDExterior?
local function reversed_neighbour(entity, warnings)
    if not entity.valid then
        return
    end
    local neighbour = entity.underground_belt_neighbour
    if not neighbour or neighbour.force ~= entity.force or neighbour.direction ~= entity.direction then
        return
    end
    local id, partner_id = entity.unit_number, neighbour.unit_number
    ---@cast id integer
    ---@cast partner_id integer
    local own, other = warnings[id], warnings[partner_id]
    local first_belt, first = opposing_belt(entity, own and own.exterior)
    if not first_belt then
        return
    end
    local second_belt, second = opposing_belt(neighbour, other and other.exterior)
    if not second_belt then
        return
    end
    ---@cast first MapPosition.struct
    ---@cast second MapPosition.struct
    return neighbour, math.abs(second.x - first.x) + math.abs(second.y - first.y), first_belt, second_belt
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
local function clear(warning)
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
---@param audiences table<RUBDStyle, RUBDAudience>
local function sync_warning(warning, audiences)
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
---@param cache table<number, table<RUBDStyle, RUBDAudience>?>
---@param force LuaForce
---@return table<RUBDStyle, RUBDAudience>
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
    for _, player in pairs(game.players) do
        state.hovering[player.index] = preferences.hovered_mouth(player)
    end
    update_tints(game.tick)
    ---@type table<number, table<RUBDStyle, RUBDAudience>?>
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
                if entity.valid and entity.force == force and not occupied[id] then
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

local function changed(event)
    local entity = event.entity
    if not entity.valid or (entity.type ~= "transport-belt" and entity.type ~= "underground-belt") then
        return
    end
    queue(entity)
    -- Batch until the next tick: removal events still expose the old entity,
    -- and construction can create either end of the pair first.
    local position = entity.position
    for _, nearby in
        pairs(entity.surface.find_entities_filtered({
            area = { { position.x - 1, position.y - 1 }, { position.x + 1, position.y + 1 } },
            type = "underground-belt",
        }))
    do
        queue(nearby)
    end
end

local function initialize()
    local previous = storage.reversed_underground_belt_detector
    if previous then
        for _, warning in pairs(previous.warnings) do
            clear(warning)
        end
    end
    clear_owned_alerts()
    storage.reversed_underground_belt_detector = {
        pending = {},
        warnings = {},
        alerts_dirty = false,
        hovering = {},
        validation_count = 0,
        validation_credit = 0,
        validation_peak = 0,
        validation_previous_peak = 0,
        validation_window_end = game.tick + validation_period,
    }
    -- Existing factories are surveyed only on installation/configuration change;
    -- ordinary play checks changed neighbourhoods and active warnings, not the map.
    for _, surface in pairs(game.surfaces) do
        for _, entity in pairs(surface.find_entities_filtered({ type = "underground-belt" })) do
            queue(entity)
        end
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

---@param state RUBDState
---@param entity LuaEntity
---@param partner_id integer
---@param distance number
---@param exterior RUBDExterior
---@param by_force table<number, table<RUBDStyle, RUBDAudience>?>
local function update_warning(state, entity, partner_id, distance, exterior, by_force)
    local id = entity.unit_number
    ---@cast id integer
    local warning = state.warnings[id]
    if warning then
        warning.exterior = exterior
    end
    local force = entity.force
    ---@cast force LuaForce
    local direction, belt_type = entity.direction, entity.belt_to_ground_type
    if
        warning
        and warning.partner_id == partner_id
        and warning.force_index == force.index
        and warning.direction == direction
        and warning.belt_type == belt_type
        and warning.distance == distance
        and render_valid(warning)
        and (not warning.steady or render_valid(warning.steady))
    then
        return
    end
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
    ---@type table<number, table<RUBDStyle, RUBDAudience>?>
    local by_force = {}
    local checked = {}
    for id, entity in pairs(state.pending) do
        if not checked[id] then
            checked[id] = true
            local neighbour, distance, first_belt, second_belt = reversed_neighbour(entity, state.warnings)
            if neighbour then
                ---@cast distance number
                ---@cast first_belt RUBDExterior
                ---@cast second_belt RUBDExterior
                local partner_id = neighbour.unit_number
                ---@cast partner_id integer
                checked[partner_id] = true
                update_warning(state, entity, partner_id, distance, first_belt, by_force)
                update_warning(state, neighbour, id, distance, second_belt, by_force)
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
---@param by_force table<number, table<RUBDStyle, RUBDAudience>?>
local function refresh_hover_pair(state, id, by_force)
    local warning = id and state.warnings[id]
    if not warning or not warning.entity.valid then
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
    ---@type table<number, table<RUBDStyle, RUBDAudience>?>
    local by_force = {}
    refresh_hover_pair(state, previous, by_force)
    refresh_hover_pair(state, selected, by_force)
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
