local original = require("__reversed-underground-belt-detector__/reversed_underground_belt_detector/appearance")
local owner = "reversed-underground-belt-detector"
local adapter = { configuration = original }
local vectors = {
    [defines.direction.north] = { 0, -1 },
    [defines.direction.east] = { 1, 0 },
    [defines.direction.south] = { 0, 1 },
    [defines.direction.west] = { -1, 0 },
}
local mouth_color, span_color = {}, {}

function adapter.initialize(scene)
    assert(not game.surfaces["modkit-warning-studio"], "Studio surface already exists")
    local surface =
        game.create_surface("modkit-warning-studio", { width = 96, height = 96, water = 0, seed = scene.seed })
    surface.request_to_generate_chunks({ 0, 0 }, 2)
    surface.force_generate_chunk_requests()
    for _, entity in pairs(surface.find_entities()) do
        entity.destroy()
    end
    surface.destroy_decoratives({})
    local tiles = {}
    for x = -32, 32 do
        for y = -32, 32 do
            tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
        end
    end
    surface.set_tiles(tiles)
    surface.daytime, surface.freeze_daytime = 0, true
    storage.preview = { surface = surface, entities = {}, overlays = {}, touched = {} }
    for row, reversed in ipairs({ true, false }) do
        local y = row == 1 and -4.5 or 4.5
        for x = -7, 7 do
            local underground = x == -2 or x == 2
            if underground or x < -2 or x > 2 then
                local entity = assert(surface.create_entity({
                    name = underground and "underground-belt" or "transport-belt",
                    position = { x + 0.5, y },
                    force = "player",
                    direction = underground and reversed and defines.direction.west or defines.direction.east,
                    type = underground and ((x == -2) ~= reversed and "input" or "output") or nil,
                    raise_built = true,
                }))
                storage.preview.entities[entity.unit_number] = entity
            end
        end
        rendering.draw_text({
            text = reversed and "Proxy: reversed pair" or "Correct pair: no warning",
            surface = surface,
            target = { -7, y - 2 },
            color = { 1, 1, 1 },
            scale = 1.5,
        })
    end
    -- A same-sprite object with a non-fixture target must remain untouched.
    storage.preview.foreign =
        rendering.draw_sprite({ sprite = original.sprite, surface = surface, target = { 15, 15 }, visible = true })
    -- A real product warning outside the preview target set exercises selective
    -- ownership, not merely protection of this companion's own rendering.
    storage.preview.foreign_entities = {}
    for part, x in ipairs({ -2.5, -1.5, 2.5, 3.5 }) do
        local mouth = part == 2 or part == 3
        local entity = assert(surface.create_entity({
            name = mouth and "underground-belt" or "transport-belt",
            position = { x, 14.5 },
            force = "player",
            direction = mouth and defines.direction.west or defines.direction.east,
            type = mouth and (part == 2 and "output" or "input") or nil,
            raise_built = true,
        }))
        storage.preview.foreign_entities[entity.unit_number] = entity
    end
end

function adapter.player_ready(player)
    player.set_controller({ type = defines.controllers.god })
    assert(player.teleport({ 5, 0 }, storage.preview.surface))
    player.zoom = 2
    player.force.chart(storage.preview.surface, { { -32, -32 }, { 32, 32 } })
end

local function colors(c, tick)
    local period = math.floor(c.period * 60 + 0.5)
    local wave = c.pulse and (1 + math.cos(2 * math.pi * (tick % period) / period)) / 2 or 1
    local mouth_alpha = c.mouth_opacity / 100 * (c.mouth_floor / 100 + (1 - c.mouth_floor / 100) * wave)
    local span_alpha = c.span_opacity / 100 * (c.span_floor / 100 + (1 - c.span_floor / 100) * wave)
    mouth_color.r, mouth_color.g, mouth_color.b, mouth_color.a =
        c.red / 100 * mouth_alpha, c.green / 100 * mouth_alpha, c.blue / 100 * mouth_alpha, mouth_alpha
    span_color.r, span_color.g, span_color.b, span_color.a =
        c.red / 100 * span_alpha, c.green / 100 * span_alpha, c.blue / 100 * span_alpha, span_alpha
end

function adapter.apply(c, tick)
    if #game.connected_players == 0 then
        return
    end
    local state, spans, seen = storage.preview, {}, {}
    colors(c, tick)
    -- Proxy rendering is deliberate. Only fixture-targeted product objects are
    -- hidden; their original visibility and audience are not global toggles.
    for _, source in pairs(rendering.get_all_objects(owner)) do
        if source.valid and source.type == "sprite" and source.sprite == original.sprite then
            local target = source.target
            local entity = target.entity
            if entity and entity.valid and state.entities[entity.unit_number] == entity then
                seen[source.id] = true
                local touched = state.touched[source.id]
                if not touched then
                    touched = { object = source, visible = source.visible }
                    state.touched[source.id] = touched
                elseif source.visible then
                    touched.visible = true
                end
                source.visible = false
                local object = state.overlays[source.id]
                local players = source.players
                if not object or not object.valid then
                    object = rendering.draw_sprite({
                        sprite = original.sprite,
                        surface = source.surface,
                        target = target,
                        orientation = source.orientation,
                        forces = source.forces,
                        players = players,
                    })
                    state.overlays[source.id] = object
                end
                object.target, object.orientation, object.forces, object.players =
                    target, source.orientation, source.forces, players
                local offset = target.offset
                local muted = offset and (offset[1] ~= 0 or offset[2] ~= 0)
                -- The product hides empty audiences; the engine exposes their players as nil.
                local visible = c.show and touched.visible and players ~= nil and #players > 0
                if muted then
                    object.x_scale, object.y_scale = c.span_scale, c.span_scale
                    object.color, object.visible = span_color, false
                    if visible then
                        local id = entity.unit_number
                        spans[id] = spans[id] or { entity = entity, objects = {} }
                        local objects = spans[id].objects
                        objects[#objects + 1] = { object = object, visible = true }
                    end
                else
                    object.x_scale, object.y_scale = c.mouth_scale, c.mouth_scale
                    object.color, object.visible = mouth_color, visible
                end
            end
        end
    end
    for id, object in pairs(state.overlays) do
        if not seen[id] then
            if object.valid then
                object.destroy()
            end
            state.overlays[id], state.touched[id] = nil, nil
        end
    end
    for _, group in pairs(spans) do
        local objects, entity = group.objects, group.entity
        table.sort(objects, function(a, b)
            return a.object.id < b.object.id
        end)
        local total = #objects
        local count = c.span and (c.span_limit == 0 and total or math.min(total, c.span_limit)) or 0
        local vector = vectors[entity.direction]
        for index, entry in ipairs(objects) do
            entry.object.visible = entry.visible and index <= count
            if index <= count then
                local step = math.floor(index * (total + 1) / (count + 1) + 0.5)
                entry.object.target = { entity = entity, offset = { vector[1] * step, vector[2] * step } }
            end
        end
    end
end

function adapter.stop()
    local state = storage.preview
    for _, object in pairs(state.overlays) do
        if object.valid then
            object.destroy()
        end
    end
    for _, touched in pairs(state.touched) do
        if touched.object.valid then
            local players = touched.object.players
            touched.object.visible = touched.visible and players ~= nil and #players > 0
        end
    end
    state.overlays, state.touched = {}, {}
end

function adapter.inspect()
    local state = storage.preview
    local overlays, hidden, touched, entities = 0, 0, 0, 0
    for _, object in pairs(state.overlays) do
        if object.valid then
            overlays = overlays + 1
        end
    end
    for _, entry in pairs(state.touched) do
        if entry.object.valid then
            touched = touched + 1
            if not entry.object.visible then
                hidden = hidden + 1
            end
        end
    end
    for _, entity in pairs(state.entities) do
        if entity.valid then
            entities = entities + 1
        end
    end
    local foreign_visible, product_visible = 0, 0
    for _, object in pairs(rendering.get_all_objects(owner)) do
        if object.valid and object.type == "sprite" and object.sprite == original.sprite and object.visible then
            local entity = object.target.entity
            if entity and entity.valid then
                if state.foreign_entities[entity.unit_number] == entity then
                    foreign_visible = foreign_visible + 1
                end
                if state.entities[entity.unit_number] == entity then
                    product_visible = product_visible + 1
                end
            end
        end
    end
    return {
        ready = overlays > 0 and foreign_visible >= 5,
        overlays = overlays,
        hidden = hidden,
        touched = touched,
        entities = entities,
        productVisible = product_visible,
        foreignProductVisible = foreign_visible,
        foreignVisible = state.foreign.valid and state.foreign.visible,
    }
end

return adapter
