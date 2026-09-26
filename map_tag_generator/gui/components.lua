local ui = {}

function ui.caption(key, ...) return {"map-tag-planner."..key, ...} end

function ui.button(handler, name, action, text, tags, style)
    tags = tags or {}
    tags.action = action
    return {type = "button", name = name, caption = text, tags = tags, style = style,
        handler = {[defines.events.on_gui_click] = handler}}
end

function ui.icon(handler, name, action, sprite, tooltip, tags, style)
    local definition = ui.button(handler, name, action, nil, tags, style or "tool_button")
    definition.type, definition.sprite, definition.tooltip = "sprite-button", sprite, tooltip
    definition.mouse_button_filter = {"left"}
    return definition
end

function ui.subheader(text, controls)
    local children = {{type = "label", style = "subheader_caption_label", caption = text}}
    if controls and #controls > 0 then
        children[#children + 1] = {type = "empty-widget", style_mods = {horizontally_stretchable = true}}
    end
    for _, control in ipairs(controls or {}) do children[#children + 1] = control end
    return {type = "frame", style = "subheader_frame",
        style_mods = {height = 36, horizontally_stretchable = true}, children = children}
end

function ui.footer(window, buttons, primary, status)
    buttons[#buttons + 1] = {type = "empty-widget", style = "flib_dialog_footer_drag_handle", ignored_by_interaction = true}
    if status then buttons[#buttons + 1] = status end
    if primary then buttons[#buttons + 1] = primary end
    return {type = "flow", drag_target = window,
        style_mods = {vertical_align = "center", horizontal_spacing = 8, horizontally_stretchable = true}, children = buttons}
end

function ui.window(name, title, actions, body)
    local header = {
        {type = "label", style = "frame_title", caption = title, ignored_by_interaction = true},
        {type = "empty-widget", style = "flib_titlebar_drag_handle", ignored_by_interaction = true},
    }
    for _, action in ipairs(actions) do
        if action.type == "sprite-button" then
            local close = action.tags and action.tags.action == "close"
            action.style_mods = action.style_mods or {}
            action.style_mods.size = close and 28 or 22
            action.style_mods.padding = 2
            action.style_mods.left_margin = close and 0 or 2
        end
        header[#header + 1] = action
    end
    return {type = "frame", name = name, direction = "vertical", children = {
        {type = "flow", drag_target = name, style_mods = {height = 28, vertical_align = "center", horizontal_spacing = 4}, children = header},
        body,
    }}
end

return ui
