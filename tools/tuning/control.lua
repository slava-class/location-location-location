local deepcopy = require("util").table.deepcopy
local request = helpers.json_to_table(require("request"))
local adapter = require("adapter")
local descriptor = request.descriptor
local prefix, root_name = "modkit_studio_", "modkit_studio_window"
local controls = {}
for _, control in ipairs(descriptor.controls) do
    controls[control.key] = control
end

local function validate(values)
    assert(type(values) == "table", "Candidate must be an object")
    for key in pairs(values) do
        assert(controls[key], "Unknown candidate field")
    end
    for key, control in pairs(controls) do
        local value = values[key]
        assert(type(value) == control.kind, "Incorrect candidate scalar type: " .. key)
        if control.kind == "number" then
            assert(
                value == value and value >= control.min and value <= control.max,
                "Candidate outside interval: " .. key
            )
            local steps = (value - control.min) / control.step
            assert(math.abs(steps - math.floor(steps + 0.5)) <= 0.0000001, "Candidate violates increment: " .. key)
        end
    end
end

local function viewport_ready(player)
    local viewport = request.viewport
    return player
        and player.connected
        and player.display_resolution.width == viewport.width
        and player.display_resolution.height == viewport.height
        and player.display_scale == viewport.scale
        and player.locale == viewport.locale
end

local function snapshot()
    local state = storage.studio
    return {
        schema = 1,
        session = request.session,
        mod = request.mod,
        tuner = descriptor.id,
        sourceSha256 = request.sourceSha256,
        configurationSha256 = request.configurationSha256,
        descriptorSha256 = request.descriptorSha256,
        revision = state.revision,
        active = state.active,
        ready = state.ready,
        discardRequested = state.discard_requested,
        canUndo = state.previous ~= nil,
        values = deepcopy(state.values),
        baseline = deepcopy(request.baseline),
        tick = game.tick,
        observations = adapter.inspect(),
    }
end

local function record(event)
    local state = snapshot()
    helpers.write_file("modkit-studio/state.json", helpers.table_to_json(state), false)
    print(
        "MODKIT_STUDIO:"
            .. helpers.table_to_json({ event = event, session = request.session, revision = state.revision })
    )
    return state
end

local function close(player)
    local frame = player.gui.screen[root_name]
    if frame then
        frame.destroy()
    end
end

local function readout(control, value)
    if control.kind == "boolean" then
        return tostring(value)
    end
    return string.format("%." .. control.precision .. "f", value) .. control.unit
end

local function refresh()
    local state = storage.studio
    for _, player in pairs(game.players) do
        local frame = player.gui.screen[root_name]
        if frame then
            frame.status.caption = "Proxy preview · revision "
                .. state.revision
                .. (state.active and " · active" or " · stopped")
            for _, control in ipairs(descriptor.controls) do
                local element = frame.body.controls[prefix .. control.key]
                element.enabled = state.capture == nil
                if control.kind == "boolean" then
                    element.state = state.values[control.key]
                else
                    element.slider_value = state.values[control.key]
                end
                frame.body.controls[prefix .. control.key .. "_value"].caption = readout(
                    control,
                    state.values[control.key]
                ) .. " / " .. readout(control, request.baseline[control.key])
            end
            frame.footer[prefix .. "undo"].enabled = state.previous ~= nil and state.capture == nil
            frame.footer[prefix .. "reset"].enabled = state.capture == nil
            frame.footer[prefix .. "stop"].enabled = state.capture == nil
        end
    end
end

local function open(player)
    close(player)
    local frame = player.gui.screen.add({ type = "frame", name = root_name, direction = "vertical" })
    frame.style.width = 620
    local header = frame.add({ type = "flow", direction = "horizontal" })
    local title = header.add({ type = "label", caption = descriptor.title, style = "frame_title" })
    title.drag_target = frame
    local drag = header.add({ type = "empty-widget", style = "draggable_space_header" })
    drag.style.horizontally_stretchable = true
    drag.style.height = 24
    drag.drag_target = frame
    header.add({
        type = "sprite-button",
        name = prefix .. "close",
        sprite = "utility/close",
        style = "frame_action_button",
    })
    frame.add({ type = "label", name = "status", caption = "" })
    local notice = frame.add({
        type = "label",
        caption = "Candidate / baseline. Preview is shared and does not change the product. \z
            Source controls require restart after promotion.",
    })
    notice.style.single_line, notice.style.maximal_width = false, 580
    local body = frame.add({
        type = "scroll-pane",
        name = "body",
        horizontal_scroll_policy = "never",
        vertical_scroll_policy = "auto",
    })
    body.style.maximal_height =
        math.max(180, math.min(480, player.display_resolution.height / player.display_scale - 300))
    local grid = body.add({ type = "table", name = "controls", column_count = 3 })
    for _, control in ipairs(descriptor.controls) do
        local label =
            grid.add({ type = "label", caption = control.label .. (control.scope == "preview" and " [preview]" or "") })
        label.style.width = 205
        if control.kind == "boolean" then
            grid.add({
                type = "checkbox",
                name = prefix .. control.key,
                state = storage.studio.values[control.key],
                tags = { studio_key = control.key },
            })
        else
            local slider = grid.add({
                type = "slider",
                name = prefix .. control.key,
                minimum_value = control.min,
                maximum_value = control.max,
                value_step = control.step,
                discrete_values = true,
                value = storage.studio.values[control.key],
                tags = { studio_key = control.key },
            })
            slider.style.width = 185
        end
        local label_value = grid.add({ type = "label", name = prefix .. control.key .. "_value", caption = "" })
        label_value.style.width = 160
    end
    local footer = frame.add({ type = "flow", name = "footer", direction = "horizontal" })
    for _, button in ipairs({
        { "reset", "Reset" },
        { "undo", "Undo" },
        { "stop", "Stop preview" },
        { "close", "Close panel" },
    }) do
        footer.add({ type = "button", name = prefix .. button[1], caption = button[2] })
    end
    frame.location = { x = math.max(0, player.display_resolution.width / player.display_scale - 645), y = 50 }
    refresh()
end

local function update(op, revision, values)
    local state = storage.studio
    assert(revision == state.revision, "Stale studio revision")
    assert(not state.discard_requested, "Studio is being discarded")
    assert(not state.capture, "A capture is in progress")
    assert(state.revision < 2147483646, "Studio revisions exhausted")
    if op == "set" or op == "reset" then
        local candidate = op == "reset" and request.baseline or values
        validate(candidate)
        state.previous = deepcopy(state.values)
        state.values = deepcopy(candidate)
        state.active = true
    elseif op == "undo" then
        assert(state.previous, "No candidate to undo")
        state.values, state.previous, state.active = state.previous, nil, true
    elseif op == "stop" or op == "discard" then
        adapter.stop()
        state.active = false
        state.discard_requested = op == "discard"
    else
        error("Unsupported studio mutation")
    end
    state.revision = state.revision + 1
    if state.active then
        adapter.apply(state.values, game.tick)
    end
    refresh()
    return record(op)
end

local function player_ready(player)
    adapter.player_ready(player)
    if not player.gui.top[prefix .. "toggle"] then
        player.gui.top.add({ type = "button", name = prefix .. "toggle", caption = "Warning studio" })
    end
    open(player)
end

script.on_init(function()
    validate(request.baseline)
    -- Compare parsed host defaults with the actual imported engine configuration.
    for _, control in ipairs(descriptor.controls) do
        if control.scope == "source" then
            for _, path in ipairs(control.binding.paths) do
                local value = adapter.configuration
                for _, key in ipairs(path) do
                    value = value[key]
                end
                assert(
                    type(value) == "number"
                        and math.abs(value / control.binding.multiplier - request.baseline[control.key])
                            <= 0.0000001,
                    "Engine configuration differs from parsed baseline"
                )
            end
        end
    end
    storage.studio = {
        revision = 0,
        active = true,
        ready = false,
        capture_number = 0,
        discard_requested = false,
        values = deepcopy(request.baseline),
    }
    adapter.initialize(descriptor.scene)
    for _, player in pairs(game.connected_players) do
        player_ready(player)
    end
    record("initialized")
end)

script.on_event(defines.events.on_player_joined_game, function(event)
    player_ready(assert(game.get_player(event.player_index)))
end)
script.on_event(
    { defines.events.on_player_display_resolution_changed, defines.events.on_player_display_scale_changed },
    function(event)
        local player = assert(game.get_player(event.player_index))
        if player.gui.screen[root_name] then
            open(player)
        end
    end
)

local function changed(event)
    local element = event.element
    if not element.valid or element.get_mod() ~= script.mod_name then
        return
    end
    local control = controls[element.tags.studio_key]
    if not control then
        return
    end
    if storage.studio.capture then
        assert(game.get_player(event.player_index)).print(
            "Studio capture is in progress; the candidate was not changed."
        )
        refresh()
        return
    end
    local candidate = deepcopy(storage.studio.values)
    if control.kind == "boolean" then
        candidate[control.key] = element.state
    else
        candidate[control.key] = element.slider_value
    end
    update("set", storage.studio.revision, candidate)
end
script.on_event(defines.events.on_gui_value_changed, changed)
script.on_event(defines.events.on_gui_checked_state_changed, changed)
script.on_event(defines.events.on_gui_click, function(event)
    local element, player = event.element, assert(game.get_player(event.player_index))
    if not element.valid or element.get_mod() ~= script.mod_name then
        return
    end
    if storage.studio.capture then
        player.print("Studio capture is in progress; the panel was not changed.")
        return
    end
    if element.name == prefix .. "toggle" then
        if player.gui.screen[root_name] then
            close(player)
        else
            open(player)
        end
    elseif element.name == prefix .. "close" then
        close(player)
    elseif element.name == prefix .. "reset" then
        update("reset", storage.studio.revision)
    elseif element.name == prefix .. "undo" then
        update("undo", storage.studio.revision)
    elseif element.name == prefix .. "stop" then
        update("stop", storage.studio.revision)
    end
end)

script.on_nth_tick(6, function(event)
    local capture = storage.studio.capture
    if capture then
        if capture.stage == 1 then
            game.set_wait_for_screenshots_to_finish()
            capture.stage = 2
        else
            local player = assert(game.get_player(capture.player))
            helpers.write_file(
                capture.path .. ".json",
                helpers.table_to_json({
                    schema = 1,
                    session = request.session,
                    captureId = capture.id,
                    revision = capture.revision,
                    phaseTick = capture.tick,
                    width = player.display_resolution.width,
                    height = player.display_resolution.height,
                    scale = player.display_scale,
                    locale = player.locale,
                }),
                false,
                capture.player
            )
            storage.studio.capture = nil
            refresh()
            print("MODKIT_STUDIO_CAPTURE:" .. request.session .. ":" .. capture.id)
        end
        return
    end
    if storage.studio.active then
        adapter.apply(storage.studio.values, event.tick)
        if not storage.studio.ready and viewport_ready(game.connected_players[1]) and adapter.inspect().ready then
            storage.studio.ready = true
            record("ready")
            print("MODKIT_STUDIO_READY:" .. request.session)
        end
    end
end)

remote.add_interface("modkit-studio", {
    get = snapshot,
    update = update,
    capture = function(revision)
        local state = storage.studio
        assert(revision == state.revision, "Stale studio revision")
        assert(state.ready and not state.discard_requested and not state.capture, "Studio is not ready to capture")
        assert(state.capture_number < 2147483646, "Capture IDs exhausted")
        local player = assert(game.connected_players[1])
        assert(viewport_ready(player), "Actual viewport changed; restore the declared studio viewport before capture")
        state.capture_number = state.capture_number + 1
        local path = "modkit-studio/captures/" .. state.capture_number .. ".png"
        state.capture = {
            id = state.capture_number,
            revision = revision,
            tick = game.tick,
            player = player.index,
            path = path,
            stage = 1,
        }
        if state.active then
            adapter.apply(state.values, game.tick)
        end
        refresh()
        game.take_screenshot({
            player = player,
            by_player = player,
            path = path,
            surface = player.surface,
            position = player.position,
            resolution = { request.viewport.width, request.viewport.height },
            zoom = player.zoom,
            show_gui = true,
            anti_alias = true,
            force_render = true,
        })
        return {
            schema = 1,
            session = request.session,
            revision = revision,
            captureId = state.capture_number,
            path = path,
        }
    end,
    panel = function(action)
        assert(action == "open" or action == "close", "Unsupported panel action")
        assert(not storage.studio.capture, "A capture is in progress")
        for _, player in pairs(game.connected_players) do
            if action == "open" then
                open(player)
            else
                close(player)
            end
        end
        return record("panel-" .. action)
    end,
})
