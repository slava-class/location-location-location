local Fluid = require("scripts.fluid-context")
local FluidRender = require("scripts.fluid-render")
local Connections = require("scripts.fluid-connections")
local Policy = require("scripts.fluid-policy")
local Inspect = require("scripts.inspect")
local H = require("tests.helpers")

local setting_names = { "fluid-context", "fluid-background", "fluid-radius", "fluid-search-radius" }
---@type LuaSurface
local surface
---@type LuaPlayer
local player
---@type table
local state = {}
---@type {surface:LuaSurface,position:MapPosition,force:LuaForce,alt:boolean,settings:table<string,boolean|string|number>}
local original
---@type LuaSurface[]
local extra_surfaces = {}
---@type LuaRenderObject[]
local test_objects = {}

local function visible(entity)
    if not entity.valid or entity.surface ~= player.surface or not Inspect.permitted(entity) then
        return false
    end
    if
        entity.force ~= player.force and not (player.force --[[@as LuaForce]]).get_friend(entity.force)
    then
        return false
    end
    return (player.force --[[@as LuaForce]]).is_chunk_visible(
        entity.surface,
        { math.floor(entity.position.x / 32), math.floor(entity.position.y / 32) }
    )
end

local function view()
    local selected = player.selected
    if selected and not visible(selected) then
        selected = nil
    end
    return {
        selected = selected,
        surface = player.surface,
        position = player.position,
        alt = player.game_view_settings.show_entity_info,
        tick = game.tick,
        blocked = player.opened ~= nil or player.render_mode == defines.render_mode.chart,
        visible = visible,
    }
end

local function record(entity)
    return state.records and state.records[entity.unit_number]
end

---@return integer
local function kind_count(entity, kind)
    local count = 0
    for _, object in ipairs(record(entity) and record(entity).objects or {}) do
        if
            object.valid
            and object.type == "sprite"
            and (
                (kind == "icons" and object.sprite:sub(1, 6) == "fluid/")
                or (kind == "arrows" and object.orientation_target ~= nil)
            )
        then
            count = count + 1
        end
    end
    return count
end

local function machine(position, name)
    local entity = H.entity(surface, name or "no-alt-needed-test-fluid-machine", position)
    if entity.type == "assembling-machine" then
        entity.set_recipe(
            name == "no-alt-needed-test-asymmetric-fluid-machine" and "no-alt-needed-test-asymmetric-fluid-recipe"
                or "no-alt-needed-test-fluid-recipe"
        )
    end
    return entity
end

local function pump(position)
    local entity = H.entity(surface, "pump", position)
    assert(entity.set_fluid_filter(1, { fluid = "water" }), "Native pump rejected its public filter")
    return entity
end

local function find_port(snapshot, predicate)
    for _, port in ipairs(snapshot.ports) do
        if predicate(port) then
            return port
        end
    end
    return nil
end

-- These are native ticks with a real LuaPlayer from the canonical CLI seed.
-- Direct module calls qualify presentation semantics, not connected-client
-- input delivery or multiplayer. The separate native scene uses core events.
local function phases(values)
    local total = 0
    for _, value in ipairs(values) do
        total = total + value.ticks
    end
    async(total + 120)
    local index, remaining = 1, values[1].ticks
    local function step()
        Fluid.update(player, state, view())
        if state.work then
            assert(state.work.queries <= 2, "Fluid discovery exceeded one cell per tick")
            assert(
                state.work.discoveries <= Fluid.work_limits.discoveries,
                "Fluid discovery exceeded its entity budget"
            )
            assert(
                state.work.snapshots <= Fluid.work_limits.refreshes + 1,
                "Fluid refresh exceeded its selected-plus-background budget"
            )
        end
        remaining = remaining - 1
        if remaining == 0 then
            values[index].after()
            index = index + 1
            if index > #values then
                done()
                return
            end
            remaining = values[index].ticks
        end
        after_ticks(1, step)
    end
    after_ticks(1, step)
end

describe("fluid semantics", function()
    before_each(function()
        player = assert(game.get_player(1), "Canonical FactorioTest seed must contain player 1")
        original = {
            surface = player.surface,
            position = player.position,
            force = player.force --[[@as LuaForce]],
            alt = player.game_view_settings.show_entity_info,
            settings = {},
        }
        for _, name in ipairs(setting_names) do
            original.settings[name] = settings.get_player_settings(player)["no-alt-needed-" .. name].value
        end
        surface = H.surface()
        H.player(surface)
        player.opened = nil
        player.selected = nil
        player.clear_cursor()
        H.setting(player, "fluid-context", true)
        H.setting(player, "fluid-background", "none")
        H.setting(player, "fluid-radius", 15)
        H.setting(player, "fluid-search-radius", 50)
        state = {}
        extra_surfaces, test_objects = {}, {}
    end)

    after_each(function()
        Fluid.clear(state)
        for _, object in ipairs(test_objects) do
            object.destroy()
        end
        local panel = player.gui.screen.no_alt_needed_fluid_test_panel
        if panel and panel.valid then
            panel.destroy()
        end
        player.opened = nil
        player.selected = nil
        player.clear_cursor()
        if player.controller_type == defines.controllers.remote then
            player.exit_remote_view()
        end
        player.force = original.force
        player.teleport(original.position, original.surface)
        player.game_view_settings.show_entity_info = original.alt
        for _, name in ipairs(setting_names) do
            H.setting(player, name, original.settings[name])
        end
        H.destroy_surface(surface)
        for _, extra in ipairs(extra_surfaces) do
            if extra.valid then
                game.delete_surface(extra)
            end
        end
    end)

    test("startup categories jointly suppress only owned public connections", function()
        local configuration = Connections.configuration()
        assert(configuration.declutter and configuration.has_owned)
        local entry = configuration.entities["no-alt-needed-test-fluid-machine"]
        local owned, hidden = 0, 0
        for _, port in pairs(entry.ports) do
            if port.owned then
                owned = owned + 1
            else
                hidden = hidden + 1
            end
        end
        assert(owned == 3 and hidden == 1, "Original hidden port must not become ours")
        for _, box in ipairs(prototypes.entity["no-alt-needed-test-fluid-machine"].fluidbox_prototypes) do
            for _, connection in ipairs(box.pipe_connections) do
                assert(connection.hide_connection_info)
            end
        end
        assert(not configuration.entities["pipe"], "Pipeline storage icons are not participating machinery")
    end)

    test("resolved ports distinguish directions filters and actual fluid without temperature labels", function()
        local entity = machine({ 0, 0 })
        local empty = Fluid.snapshot(entity)
        assert(empty.unresolved == 0 and #empty.ports == 3)
        local water = assert(find_port(empty, function(port)
            return port.filter == "water"
        end))
        assert(water.flow_direction == "input" and water.fluid == nil)
        local steam = assert(find_port(empty, function(port)
            return port.flow_direction == "output"
        end))
        assert(steam.filter == "steam")
        assert(entity.set_fluid(water.storage_index, { name = "water", amount = 25, temperature = 25 }) > 0)
        local populated = Fluid.snapshot(entity)
        local filled = assert(find_port(populated, function(port)
            return port.fluid == "water"
        end))
        assert(filled.filter == "water" and filled.amount > 0)
        local rendered = { entity = entity }
        for _, mode in ipairs({ "icons", "arrows", "both" }) do
            FluidRender.refresh(player, rendered, populated, mode, surface, false)
            for _, object in ipairs(rendered.objects) do
                test_objects[#test_objects + 1] = object
                assert(object.type ~= "text", "Fluid overlays must not draw temperature labels")
            end
        end
        FluidRender.clear(rendered)
        assert(not find_port(empty, function(port)
            return math.abs(port.position.x) < 0.0001 and port.position.y < -1
        end), "Intentionally hidden north port leaked")
    end)

    test("connected pipe icons share native anchors through rotation replacement and ALT", function()
        local entity = machine({ 0, 0 })
        local rendered = { entity = entity }
        for _, direction in ipairs({ 0, 4, 8, 12 }) do
            entity.direction = direction
            for _, mirrored in ipairs({ false, true }) do
                entity.mirroring = mirrored
                local water = assert(find_port(Fluid.snapshot(entity), function(port)
                    return port.filter == "water"
                end))
                local connection = assert(entity.get_fluid_box_pipe_connections(water.storage_index)[1])
                for _, name in ipairs({ "pipe", "pipe-to-ground", "no-alt-needed-test-shifted-pipe" }) do
                    local pipe = H.entity(surface, name, connection.target_position, {
                        direction = (direction + (mirrored and 12 or 4)) % 16,
                    })
                    assert(pipe.insert_fluid({ name = "water", amount = 25 }) > 0)
                    assert(entity.get_fluid_box_pipe_connections(water.storage_index)[1].target == pipe)
                    for _, alt in ipairs({ false, true }) do
                        player.game_view_settings.show_entity_info = alt
                        FluidRender.refresh(player, rendered, Fluid.snapshot(entity), "both", surface, false)
                        local found = false
                        for _, object in ipairs(rendered.objects) do
                            if object.type == "sprite" and object.sprite == "fluid/water" then
                                local offset = assert(object.target.offset)
                                local specification = pipe.prototype.icon_draw_specification
                                local shift = specification.shift
                                local pipe_x, pipe_y = Policy.xy(pipe.position)
                                local shift_x, shift_y = Policy.xy(shift)
                                local x = entity.position.x + (offset.x or offset[1])
                                local y = entity.position.y + (offset.y or offset[2])
                                assert(
                                    math.abs(x - pipe_x - shift_x) < 0.000001
                                        and math.abs(y - pipe_y - shift_y) < 0.000001,
                                    "Connected fluid icon must use the pipe's native ALT anchor: "
                                        .. helpers.table_to_json({
                                            actual = { x, y },
                                            pipe = pipe.position,
                                            shift = shift,
                                        })
                                )
                                assert(
                                    math.abs(object.x_scale - specification.scale * 0.9) < 0.000001
                                        and math.abs(object.y_scale - specification.scale * 0.9) < 0.000001,
                                    "Connected fluid icon must retain the native content scale"
                                )
                                found = true
                            end
                        end
                        assert(found, "The connected pipe's fluid must remain visible across ALT changes")
                    end
                    pipe.destroy()
                end
            end
        end
        FluidRender.clear(rendered)
    end)

    test("rotation mirroring and asymmetric layouts follow resolved runtime geometry", function()
        local entity = machine({ 0, 0 })
        local cases = {
            { 0, false, -2, 0 },
            { 4, false, 0, -2 },
            { 8, false, 2, 0 },
            { 12, false, 0, 2 },
            { 0, true, 2, 0 },
            { 4, true, 0, 2 },
            { 8, true, -2, 0 },
            { 12, true, 0, -2 },
        }
        for _, value in ipairs(cases) do
            entity.direction = value[1]
            entity.mirroring = value[2]
            local snapshot = Fluid.snapshot(entity)
            local water = assert(find_port(snapshot, function(port)
                return port.filter == "water"
            end))
            assert(snapshot.unresolved == 0 and #snapshot.ports == 3)
            assert(math.abs(water.position.x - value[3]) < 0.0001 and math.abs(water.position.y - value[4]) < 0.0001)
            local rendered = { entity = entity }
            FluidRender.refresh(player, rendered, snapshot, "arrows", surface, false)
            for _, port in ipairs(snapshot.ports) do
                local matched = false
                for _, object in ipairs(rendered.objects) do
                    local from = assert(object.target.offset)
                    local x, y = from[1] or from.x, from[2] or from.y
                    if (x - port.position.x) ^ 2 + (y - port.position.y) ^ 2 < 0.07 then
                        local facing = assert(object.orientation_target)
                        assert(facing.type == "entity" and facing.entity == entity)
                        local to = assert(facing.offset)
                        local dx, dy = (to[1] or to.x) - x, (to[2] or to.y) - y
                        local sign = port.flow_direction == "input" and -1 or 1
                        assert(
                            math.abs(dx * port.direction.x + dy * port.direction.y - sign) < 0.0001,
                            "The native marker must point along flow after rotation or mirroring"
                        )
                        matched = true
                    end
                end
                assert(matched, "Every visible fixture port must retain its direction marker")
            end
            FluidRender.clear(rendered)
        end
        local asymmetric = machine({ 8, 0 }, "no-alt-needed-test-asymmetric-fluid-machine")
        for _, direction in ipairs({ 0, 4, 8, 12 }) do
            asymmetric.direction = direction
            local snapshot = Fluid.snapshot(asymmetric)
            assert(snapshot.unresolved == 0 and #snapshot.ports == 1)
            local expected = direction == 0 or direction == 8
            assert(snapshot.ports[1].position.x == (expected and -2 or 1))
            assert(snapshot.ports[1].position.y == (expected and 1 or -2))
        end
    end)

    test("ghost filters survive rotation and revival without fabricated contents", function()
        local ghost = H.entity(
            surface,
            "entity-ghost",
            { 6, 0 },
            { inner_name = "no-alt-needed-test-fluid-machine", direction = defines.direction.east }
        )
        ghost.set_recipe("no-alt-needed-test-fluid-recipe")
        local before = Fluid.snapshot(ghost)
        assert(before.unresolved == 0 and #before.ports == 3)
        assert(find_port(before, function(port)
            return port.filter == "water"
        end))
        for _, port in ipairs(before.ports) do
            assert(port.fluid == nil and port.amount == nil)
        end
        local _, revived = ghost.revive({ raise_revive = true })
        assert(revived and revived.valid and not ghost.valid)
        local after = Fluid.snapshot(revived)
        assert(after.unresolved == 0 and #after.ports == #before.ports)
        assert(find_port(after, function(port)
            return port.filter == "water"
        end))
    end)

    test("native category fixtures expose every available category", function()
        local names = {
            ["assembling-machine"] = "no-alt-needed-test-fluid-machine",
            furnace = "no-alt-needed-test-fluid-furnace",
            boiler = "boiler",
            generator = "steam-engine",
            ["mining-drill"] = "pumpjack",
            ["offshore-pump"] = "offshore-pump",
            pump = "pump",
            ["rocket-silo"] = "no-alt-needed-test-fluid-silo",
            ["fusion-reactor"] = "fusion-reactor",
            ["fusion-generator"] = "fusion-generator",
            thruster = "thruster",
        }
        local entities = {}
        for index, category in ipairs(Policy.categories) do
            local name = names[category]
            local prototype = prototypes.entity[name] --[[@as LuaEntityPrototype?]]
            if prototype then
                local entity = H.entity(surface, name, { (index - 6) * 12, 24 })
                if category == "assembling-machine" then
                    entity.set_recipe("no-alt-needed-test-fluid-recipe")
                end
                if category == "furnace" then
                    entity.insert({ name = "stone", count = 1 })
                end
                entities[#entities + 1] = { entity = entity, category = category }
            else
                assert(
                    not script.active_mods["space-age"]
                        and (category == "fusion-reactor" or category == "fusion-generator" or category == "thruster"),
                    "Required category prototype missing"
                )
            end
        end
        phases({
            {
                ticks = 5,
                after = function()
                    for _, fixture in ipairs(entities) do
                        local snapshot = Fluid.snapshot(fixture.entity)
                        assert(
                            snapshot.unresolved == 0 and #snapshot.ports > 0,
                            "No resolved ports for " .. fixture.category
                        )
                    end
                    assert(#entities == (script.active_mods["space-age"] and 11 or 8))
                end,
            },
        })
    end)

    test("stationary recipe changes and clearing update owned detail", function()
        local entity = machine({ 0, 0 })
        player.selected = entity
        phases({
            {
                ticks = 2,
                after = function()
                    assert(find_port(record(entity).snapshot, function(port)
                        return port.filter == "water"
                    end))
                    entity.set_recipe("no-alt-needed-test-other-fluid-recipe")
                end,
            },
            {
                ticks = 20,
                after = function()
                    assert(find_port(record(entity).snapshot, function(port)
                        return port.filter == "crude-oil"
                    end))
                    assert(not find_port(record(entity).snapshot, function(port)
                        return port.filter == "water"
                    end))
                    entity.set_recipe(nil)
                end,
            },
            {
                ticks = 20,
                after = function()
                    assert(not find_port(record(entity).snapshot, function(port)
                        return port.filter == "crude-oil" or port.filter == "light-oil"
                    end))
                end,
            },
        })
    end)

    test("quiet construction follows selection and clears after selection loss", function()
        local focus = H.entity(surface, "transport-belt", { 25, 0 })
        local nearby, player_nearby = pump({ 27, 4 }), pump({ 0, 4 })
        assert(assert(player.cursor_stack).set_stack({ name = "pipe", count = 1 }))
        player.selected = focus
        phases({
            {
                ticks = 40,
                after = function()
                    assert(kind_count(nearby, "arrows") > 0 and kind_count(nearby, "icons") > 0)
                    assert(not record(player_nearby), "Construction detail silently used player position")
                    player.selected = nil
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(not state.order or #state.order == 0, "Last selection was retained after loss")
                    assert(not state.preview, "Holding a pipe must not invent a machine preview")
                    assert(
                        not Fluid.active(player, view()),
                        "Quiet pipe holding without selection retained periodic work"
                    )
                    player.clear_cursor()
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(next(state) == nil and not Fluid.active(player, view()))
                end,
            },
        })
    end)

    test("background modes work without ALT and detail is not duplicated with ALT", function()
        local entity = pump({ 8, 0 })
        H.setting(player, "fluid-background", "icons")
        player.game_view_settings.show_entity_info = false
        phases({
            {
                ticks = 85,
                after = function()
                    assert(kind_count(entity, "icons") > 0 and kind_count(entity, "arrows") == 0)
                    for _, object in ipairs(record(entity).objects) do
                        assert(object.type ~= "circle", "Fluid icons must not have surrounding rings")
                        if object.type == "sprite" then
                            local color = object.color
                            assert(
                                color.a == 1 and color.r == 1 and color.g == 1 and color.b == 1,
                                "Filter-only fluid icons must be opaque and untinted"
                            )
                        end
                    end
                    H.setting(player, "fluid-background", "arrows")
                end,
            },
            {
                ticks = 85,
                after = function()
                    assert(kind_count(entity, "icons") == 0 and kind_count(entity, "arrows") > 0)
                    for _, object in ipairs(record(entity).objects) do
                        local facing = assert(object.orientation_target)
                        assert(object.target.type == "entity" and facing.type == "entity")
                        assert(object.target.entity == entity and facing.entity == entity)
                    end
                    assert(entity.insert_fluid({ name = "water", amount = 20 }) > 0)
                    player.selected = entity
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(kind_count(entity, "icons") > 0 and kind_count(entity, "arrows") > 0)
                    for _, object in ipairs(record(entity).objects) do
                        if object.type == "sprite" and object.sprite:sub(1, 6) == "fluid/" then
                            local color = object.color
                            assert(
                                color.a == 1 and color.r == 1 and color.g == 1 and color.b == 1,
                                "Actual fluid icons must remain opaque and untinted"
                            )
                        end
                    end
                    local first = record(entity).objects[1]
                    player.game_view_settings.show_entity_info = true
                    assert(Fluid.update(player, state, view()))
                    assert(record(entity).objects[1] == first, "Native ALT caused duplicate fluid detail")
                    H.setting(player, "fluid-context", false)
                    H.setting(player, "fluid-background", "none")
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(next(state) == nil and player.game_view_settings.show_entity_info)
                end,
            },
        })
    end)

    test("envelope uses footprint edges and selected targets remain eligible outside it", function()
        local edge = machine({ 51.5, 0 })
        local outside = machine({ 57.5, 8 })
        player.teleport({ edge.bounding_box.left_top.x - 50, 0 }, surface)
        H.setting(player, "fluid-background", "icons")
        phases({
            {
                ticks = 100,
                after = function()
                    assert(record(edge), "Near edge of a large footprint was omitted")
                    assert(not record(outside), "Background exceeded its circular envelope")
                    H.setting(player, "fluid-background", "none")
                    H.setting(player, "fluid-search-radius", 1)
                    player.selected = outside
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(
                        record(outside) and kind_count(outside, "arrows") > 0,
                        "Selected target was clipped by background radius"
                    )
                    assert(not record(edge))
                end,
            },
        })
    end)

    test("dense construction discovery completes without truncation or budget overruns", function()
        local entities = {}
        for y = -3, 3 do
            for x = -3, 3 do
                entities[#entities + 1] = pump({ x * 4, y * 4 })
            end
        end
        local focus = H.entity(surface, "transport-belt", { 0, -1 })
        player.selected = focus
        assert(assert(player.cursor_stack).set_stack({ name = "pipe", count = 1 }))
        H.setting(player, "fluid-radius", 30)
        phases({
            {
                ticks = 150,
                after = function()
                    assert(#state.order == #entities, "Dense local discovery permanently dropped entities")
                    for _, entity in ipairs(entities) do
                        assert(kind_count(entity, "arrows") > 0 and kind_count(entity, "icons") > 0)
                    end
                end,
            },
        })
    end)

    test("held previews transform marker orientation and omit asymmetric diagrams", function()
        assert(assert(player.cursor_stack).set_stack({ name = "no-alt-needed-test-fluid-machine", count = 1 }))
        phases({
            {
                ticks = 2,
                after = function()
                    assert(state.preview and #state.preview.objects > 0 and state.preview_unsupported == 0)
                    local arrows = 0
                    for _, object in ipairs(state.preview.objects) do
                        assert(object.render_mode == "build-cursor")
                        assert(object.type ~= "text", "Held fluid previews must not draw temperature labels")
                        if object.type == "sprite" and object.orientation_target then
                            local facing = object.orientation_target
                            assert(
                                object.target.type == "build-cursor" and facing.type == "build-cursor",
                                "Both marker position and direction must rotate and mirror with the held machine"
                            )
                            local from, to = assert(object.target.offset), assert(facing.offset)
                            assert(
                                (from[1] or from.x) ~= (to[1] or to.x) or (from[2] or from.y) ~= (to[2] or to.y),
                                "The marker must have an actual facing direction"
                            )
                            arrows = arrows + 1
                        end
                    end
                    assert(arrows > 0, "Preview must rotate the marker, not only its center")
                    assert(player.cursor_stack).set_stack({
                        name = "no-alt-needed-test-asymmetric-fluid-machine",
                        count = 1,
                    })
                end,
            },
            {
                ticks = 2,
                after = function()
                    local preview = Fluid.preview(prototypes.entity["no-alt-needed-test-asymmetric-fluid-machine"])
                    assert(preview.unresolved > 0 and #preview.ports == 0 and next(state) == nil)
                    player.clear_cursor()
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(next(state) == nil)
                end,
            },
        })
    end)

    test("blocked views force changes and destruction clean only this fluid layer", function()
        local entity = pump({ 0, 0 })
        local foreign =
            rendering.draw_circle({ target = { 4, 4 }, surface = surface, radius = 0.3, color = { 1, 0, 0 } })
        test_objects[#test_objects + 1] = foreign
        player.selected = entity
        phases({
            {
                ticks = 2,
                after = function()
                    local object = assert(record(entity).objects[1])
                    player.opened = player.gui.screen.add({ type = "frame", name = "no_alt_needed_fluid_test_panel" })
                    assert(not Fluid.update(player, state, view()))
                    assert(not object.valid and foreign.valid)
                    player.opened = nil
                    assert(player.gui.screen.no_alt_needed_fluid_test_panel).destroy()
                end,
            },
            {
                ticks = 2,
                after = function()
                    local object = assert(record(entity).objects[1])
                    player.force = game.forces.enemy
                    assert(not Fluid.update(player, state, view()))
                    assert(
                        not object.valid and foreign.valid,
                        "Force change retained old-force detail or deleted foreign state"
                    )
                    player.force = original.force
                    player.selected = entity
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(record(entity))
                    local object = record(entity).objects[1]
                    entity.destroy({ raise_destroy = true })
                    assert(not object.valid, "Entity-bound fluid object survived native destruction")
                    player.selected = nil
                    assert(not Fluid.update(player, state, view()))
                    assert(foreign.valid, "Fluid cleanup deleted another presentation object")
                    foreign.destroy()
                end,
            },
        })
    end)

    test("force visibility and viewed surfaces do not leak fluid information", function()
        local own = pump({ 0, 0 })
        local hostile = H.entity(surface, "pump", { 8, 0 }, { force = game.forces.enemy })
        hostile.set_fluid_filter(1, { fluid = "water" })
        local fogged = pump({ 42, 0 })
        H.setting(player, "fluid-background", "icons")
        ---@type LuaSurface
        local second
        phases({
            {
                ticks = 85,
                after = function()
                    assert(record(own) and not record(hostile))
                    for _, object in ipairs(record(own).objects) do
                        assert(
                            #object.players == 1 and object.players[1].index == player.index,
                            "Fluid render audience is not per-player"
                        )
                        assert(#object.forces == 1 and object.forces[1] == player.force)
                    end
                    assert(record(fogged))
                    local force = player.force --[[@as LuaForce]]
                    force.unchart_chunk({ 1, 0 }, surface)
                end,
            },
            {
                ticks = 20,
                after = function()
                    assert(not record(fogged), "Fog-of-war retained a fluid background")
                    second = H.surface()
                    extra_surfaces[#extra_surfaces + 1] = second
                    player.set_controller({ type = defines.controllers.remote, surface = second, position = { 0, 0 } })
                    local force = player.force --[[@as LuaForce]]
                    force.chart(second, { { -64, -64 }, { 64, 64 } })
                    assert(player.surface == second)
                end,
            },
            {
                ticks = 2,
                after = function()
                    assert(not record(own), "Remote surface retained the physical surface's ports")
                    player.exit_remote_view()
                    game.delete_surface(second)
                end,
            },
        })
    end)
end)
