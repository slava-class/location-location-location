local appearance = require("location_location_location.gui.appearance")
local ui = {}

function ui.caption(key, ...) return {"location-location-location."..key, ...} end

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

function ui.recipe_tag_row(handler, id, text, count, selected, retired, width)
    local row = appearance.row
    local height = row.height - 2 * row.vertical_padding
    local content_width = width - 2 * row.horizontal_padding
    local button = ui.button(handler, "plan_"..id, "open", "", {id = id}, appearance.styles.row)
    button.toggled = selected
    button.style_mods = {width = width}
    local text_style = appearance.row_text_style(selected, retired)
    -- Button children share its inner content box, not its outer dimensions.
    -- Both labels remain direct children so native parent-hover colours apply.
    button.children = {
        {type = "label", caption = text, style = text_style, ignored_by_interaction = true,
            style_mods = {width = content_width - row.count_width - row.gap, height = height,
                single_line = true, vertical_align = "center"}},
        {type = "label", caption = count, style = text_style, ignored_by_interaction = true,
            style_mods = {width = content_width, height = height, horizontal_align = "right", vertical_align = "center"}},
    }
    return button
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

function ui.footer(window, buttons, primary)
    buttons[#buttons + 1] = {type = "empty-widget", style = "flib_dialog_footer_drag_handle", ignored_by_interaction = true}
    if primary then buttons[#buttons + 1] = primary end
    return {type = "flow", drag_target = window,
        style_mods = {vertical_align = "center", horizontal_spacing = 8, horizontally_stretchable = true}, children = buttons}
end

function ui.window(name, title, actions, body, leading_action)
    local header = {
        {type = "label", style = "frame_title", caption = title, ignored_by_interaction = true},
        {type = "empty-widget", style = "flib_titlebar_drag_handle", ignored_by_interaction = true},
    }
    if leading_action then table.insert(header, 1, leading_action) end
    for _, action in ipairs(actions) do header[#header + 1] = action end
    for _, action in ipairs(header) do
        if action.type == "sprite-button" then
            appearance.titlebar_button(action, action == leading_action)
        end
    end
    return {type = "frame", name = name, direction = "vertical", children = {
        {type = "flow", drag_target = name, style_mods = {height = 28, vertical_align = "center", horizontal_spacing = 4}, children = header},
        body,
    }}
end

return ui
