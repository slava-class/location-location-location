local Experiments = {}
local root_name = "no_alt_needed_experiments"
local shortcut_name = "no-alt-needed-experiments"

local function exposed(prototype)
    if not prototype or prototype.setting_type ~= "runtime-per-user" then
        return false
    end
    local prefix = prototype.mod .. "-experiment-"
    if
        prototype.mod ~= script.mod_name
        and (
            prototype.name:sub(1, #prefix) ~= prefix
            or not remote.interfaces[prototype.mod .. "-experiments"]
            or not remote.interfaces[prototype.mod .. "-experiments"].set
        )
    then
        return false
    end
    return prototype.type == "bool-setting" or (prototype.type == "string-setting" and prototype.allowed_values ~= nil)
end

local function choices(prototype, value)
    local items = {}
    ---@type integer?
    local selected
    for index, choice in ipairs(assert(prototype.allowed_values)) do
        items[index] = { "string-mod-setting." .. prototype.name .. "-" .. choice }
        if choice == value then
            selected = index
        end
    end
    return items, assert(selected, "The engine setting must belong to its declared choices")
end

function Experiments.set(player_index, name, value)
    local prototype = prototypes.mod_setting[name]
    assert(prototype and prototype.mod == script.mod_name and exposed(prototype), "Not an owned live control")
    local player = assert(game.get_player(player_index), "The live-control player must exist")
    local values = settings.get_player_settings(player)
    if values[name].value ~= value then
        values[name] = { value = value }
    end
    return values[name].value
end

function Experiments.close(player)
    local frame = player.gui.screen[root_name]
    if frame then
        frame.destroy()
    end
    player.set_shortcut_toggled(shortcut_name, false)
end

function Experiments.refresh(player)
    local frame = player.gui.screen[root_name] --[[@as NoAltNeededExperimentsFrame?]]
    if not frame then
        return
    end
    local values = settings.get_player_settings(player)
    for _, element in ipairs(frame.body.controls.children) do
        local name = element.tags.setting
        if type(name) == "string" then
            local prototype = prototypes.mod_setting[name]
            if prototype.type == "bool-setting" then
                element.state = values[name].value --[[@as boolean]]
            else
                local _, selected = choices(prototype, values[name].value)
                element.selected_index = selected
            end
        end
    end
end

function Experiments.toggle(player)
    if player.gui.screen[root_name] then
        Experiments.close(player)
        return
    end
    local controls = {}
    for _, prototype in pairs(prototypes.mod_setting) do
        if exposed(prototype) then
            controls[#controls + 1] = prototype
        end
    end
    table.sort(controls, function(a, b)
        if a.mod ~= b.mod then
            if a.mod == script.mod_name then
                return true
            end
            if b.mod == script.mod_name then
                return false
            end
            return a.mod < b.mod
        end
        if a.order ~= b.order then
            return a.order < b.order
        end
        return a.name < b.name
    end)
    local frame = player.gui.screen.add({ type = "frame", name = root_name, direction = "vertical" })
    frame.style.width = 480
    local header = frame.add({ type = "flow", name = "header", direction = "horizontal" })
    local title = header.add({ type = "label", caption = { "no-alt-needed.experiments" }, style = "frame_title" })
    title.drag_target = frame
    local drag = header.add({ type = "empty-widget", style = "draggable_space_header" })
    drag.style.horizontally_stretchable, drag.style.height = true, 24
    drag.drag_target = frame
    header.add({ type = "sprite-button", name = "close", sprite = "utility/close", style = "frame_action_button" })
    local notice = frame.add({ type = "label", caption = { "no-alt-needed.experiments-scope" } })
    notice.style.single_line, notice.style.maximal_width = false, 440
    local body = frame.add({
        type = "scroll-pane",
        name = "body",
        horizontal_scroll_policy = "never",
        vertical_scroll_policy = "auto",
    })
    body.style.maximal_height =
        math.floor(math.max(160, math.min(420, player.display_resolution.height / player.display_scale - 220)))
    local grid = body.add({ type = "table", name = "controls", column_count = 2 })
    local values = settings.get_player_settings(player)
    local owner
    for _, prototype in ipairs(controls) do
        if owner ~= prototype.mod then
            owner = prototype.mod
            grid.add({ type = "label", caption = owner, style = "bold_label" })
            grid.add({ type = "empty-widget" })
        end
        local label =
            grid.add({ type = "label", caption = prototype.localised_name, tooltip = prototype.localised_description })
        label.style.width, label.style.single_line = 240, false
        if prototype.type == "bool-setting" then
            grid.add({
                type = "checkbox",
                name = prototype.name,
                state = values[prototype.name].value,
                tags = { setting = prototype.name },
            })
        else
            local items, selected = choices(prototype, values[prototype.name].value)
            local choice = grid.add({
                type = "drop-down",
                name = prototype.name,
                items = items,
                selected_index = selected,
                tags = { setting = prototype.name },
            })
            choice.style.width = 180
        end
    end
    frame.location = { x = 16, y = 64 }
    player.set_shortcut_toggled(shortcut_name, true)
    -- Deliberately do not set player.opened: inspection must remain usable behind this panel.
end

function Experiments.changed(event)
    local player = game.get_player(event.player_index)
    local element = event.element
    if not player or not element or not element.valid then
        return
    end
    local frame = player.gui.screen[root_name] --[[@as NoAltNeededExperimentsFrame?]]
    if not frame then
        return
    end
    if element.parent == frame.header and element.name == "close" then
        Experiments.close(player)
        return
    end
    if element.parent ~= frame.body.controls then
        return
    end
    local name = element.tags.setting
    local prototype = name and prototypes.mod_setting[name]
    if not exposed(prototype) then
        return
    end
    local value
    if prototype.type == "bool-setting" then
        value = element.state
    else
        value = assert(prototype.allowed_values)[element.selected_index]
        if value == nil then
            return
        end
    end
    if prototype.mod == script.mod_name then
        Experiments.set(player.index, name, value)
    else
        (remote.call --[[@as NoAltNeededRemoteSettingCall]])(
            prototype.mod .. "-experiments",
            "set",
            player.index,
            name,
            value
        )
    end
end

return Experiments
