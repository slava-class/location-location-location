local FluidRender = {}

function FluidRender.clear(record)
    for _, object in ipairs(record.objects or {}) do
        object.destroy()
    end
    record.objects = nil
    record.snapshot = nil
    record.mode = nil
end

local function same(left, right)
    if not left or #left.ports ~= #right.ports or left.unresolved ~= right.unresolved then
        return false
    end
    for index, a in ipairs(left.ports) do
        local b = right.ports[index]
        if
            a.position.x ~= b.position.x
            or a.position.y ~= b.position.y
            or a.direction.x ~= b.direction.x
            or a.direction.y ~= b.direction.y
            or a.icon_x ~= b.icon_x
            or a.icon_y ~= b.icon_y
            or a.icon_scale ~= b.icon_scale
            or a.flow_direction ~= b.flow_direction
            or a.fluid ~= b.fluid
            or a.filter ~= b.filter
        then
            return false
        end
    end
    return true
end

local function target(entity, preview, x, y)
    if preview then
        return { type = "build-cursor", offset = { x, y } }
    end
    return { entity = entity, offset = { x, y } }
end

function FluidRender.refresh(player, record, snapshot, mode, surface, preview)
    local valid = record.objects ~= nil
    for _, object in ipairs(record.objects or {}) do
        if not object.valid then
            valid = false
            break
        end
    end
    if valid and record.mode == mode and same(record.snapshot, snapshot) then
        record.snapshot = snapshot
        return
    end
    FluidRender.clear(record)
    record.objects = {}
    record.snapshot = snapshot
    record.mode = mode
    local objects = record.objects
    local players = { player.index }
    local forces = { player.force }
    local render_mode = preview and "build-cursor" or "game"
    local function at(x, y)
        return target(record.entity, preview, x, y)
    end
    local function arrow(port, sign)
        local dx, dy = port.direction.x * sign, port.direction.y * sign
        local x, y = port.position.x + dx * 0.25, port.position.y + dy * 0.25
        objects[#objects + 1] = rendering.draw_sprite({
            sprite = "utility/indication_arrow",
            target = at(x, y),
            -- Both targets follow build-cursor rotation and mirroring, so the
            -- native marker turns with the port rather than only moving with it.
            orientation_target = at(x + dx, y + dy),
            surface = surface,
            players = players,
            forces = forces,
            render_layer = "entity-info-icon",
            render_mode = render_mode,
        })
    end
    local function icon(port, name, distance)
        local x = port.icon_x + port.direction.x * distance
        local y = port.icon_y + port.direction.y * distance
        objects[#objects + 1] = rendering.draw_sprite({
            sprite = "fluid/" .. name,
            target = at(x, y),
            surface = surface,
            players = players,
            forces = forces,
            x_scale = port.icon_scale,
            y_scale = port.icon_scale,
            render_layer = "entity-info-icon",
            render_mode = render_mode,
        })
    end
    for _, port in ipairs(snapshot.ports) do
        if mode ~= "icons" then
            if port.flow_direction ~= "output" then
                arrow(port, -1)
            end
            if port.flow_direction ~= "input" then
                arrow(port, 1)
            end
        end
        if mode ~= "arrows" then
            if port.fluid then
                icon(port, port.fluid, 0)
            end
            if port.filter and port.filter ~= port.fluid then
                icon(port, port.filter, port.fluid and 0.85 or 0)
            end
        end
    end
end

return FluidRender
