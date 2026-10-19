local appearance = {}
local prefix = "location_location_location_"

appearance.colors = { muted = { 0.65, 0.65, 0.65 }, warning = { 1, 0.75, 0.35 } }
-- Button children have a native 4 px container inset in addition to style padding.
appearance.row =
    { height = 28, horizontal_padding = 8, vertical_padding = 4, child_inset = 4, count_width = 44, gap = 4 }
appearance.navigation = { width = 240, height = 524, list_height = 444, padding = 4, scrollbar_width = 12 }
appearance.highlight_source = "move_tag"
appearance.picker = { width = 400, group_widths = { 66, 67, 67, 66, 67, 67 } }
appearance.close_sprite = prefix .. "close_black"
appearance.styles = {
    titlebar = prefix .. "titlebar_toggle",
    dirty_apply = prefix .. "apply_dirty",
    delete = prefix .. "delete",
    confirm_delete = prefix .. "confirm_delete",
    row = prefix .. "recipe_tag_row",
    row_text = prefix .. "row_text",
    selected_row_text = prefix .. "selected_row_text",
    retired_row_text = prefix .. "retired_row_text",
    picker_group = prefix .. "picker_group_tab",
    picker_tabs = prefix .. "picker_tabs",
}
---@type table<string, string?>
local toggle_icons = {
    compact = "utility/track_button_white",
    highlights = prefix .. "highlight_sources_white",
    picker_unresearched = "utility/tip_icon",
}

---@param button flib.GuiElemDef
function appearance.toggle(button, active)
    local tags = assert(button.tags)
    local action = tags.action
    ---@cast action string
    local icon = assert(toggle_icons[action], "Unknown titlebar toggle")
    button.toggled = active
    button.sprite = icon
end

---@param button flib.GuiElemDef
function appearance.titlebar_button(button, leading)
    local action = button.tags and button.tags.action
    ---@cast action string?
    local close = action == "close"
    local search = action == "picker_search"
    local toggle = toggle_icons[action]
    ---@cast toggle string?
    if toggle then
        button.style = appearance.styles.titlebar
    end
    button.style_mods = button.style_mods or {}
    -- Close and search inherit stock sizing, padding, and sprite inversion.
    if not close and not search then
        button.style_mods.size = leading and 18 or 22
        button.style_mods.padding = toggle and 0 or math.floor((button.style_mods.size - 16) / 2)
    end
    button.style_mods.left_margin = close and 0 or (search and 4 or 2)
    button.style_mods.right_margin = leading and 4 or 0
end

---@param button flib.GuiElemDef
function appearance.apply(button, changes)
    button.style = changes > 0 and appearance.styles.dirty_apply or "confirm_button"
    button.caption = changes > 0 and { "location-location-location.apply-changes", changes }
        or { "location-location-location.apply" }
    button.tooltip = { "location-location-location.apply-tooltip" }
end

---@param button flib.GuiElemDef
function appearance.delete(button, armed)
    button.style = armed and appearance.styles.confirm_delete or appearance.styles.delete
    button.caption =
        { armed and "location-location-location.confirm-delete-label" or "location-location-location.delete-label" }
    button.tooltip = { armed and "location-location-location.confirm-delete" or "location-location-location.delete" }
end

function appearance.row_text_style(selected, retired)
    if selected then
        return appearance.styles.selected_row_text
    end
    return retired and appearance.styles.retired_row_text or appearance.styles.row_text
end

function appearance.slot_style(unlocked, recipe_choice)
    if not unlocked then
        return "flib_slot_button_yellow"
    end
    return recipe_choice and "flib_slot_button_green" or "slot_button"
end

-- Data-stage registration lives beside the runtime policy so native inversion,
-- palette, and state-specific artwork cannot drift between separate definitions.
function appearance.register()
    local utility = data.raw["utility-sprites"].default
    for _, icon in ipairs({
        { "highlight_sources_white", utility[appearance.highlight_source], true },
        { "close_black", utility.close, false },
        { "show_retired", utility.expand, false },
    }) do
        local sprite = table.deepcopy(icon[2])
        ---@cast sprite +{type:string,name:string}
        sprite.type, sprite.name = "sprite", prefix .. icon[1]
        sprite.invert_colors = icon[3]
        if not icon[3] then
            sprite.tint = { 0, 0, 0 }
        end
        ---@cast sprite data.SpritePrototype
        data:extend({ sprite })
    end
    local styles = data.raw["gui-style"].default
    styles[appearance.styles.titlebar] = {
        type = "button_style",
        parent = "frame_action_button",
        selected_graphical_set = styles.frame_button.clicked_graphical_set,
        selected_hovered_graphical_set = styles.frame_button.hovered_graphical_set,
        selected_clicked_graphical_set = styles.frame_button.default_graphical_set,
    }
    styles[appearance.styles.row] = {
        type = "button_style",
        parent = "list_box_item",
        width = 0,
        height = appearance.row.height,
        horizontally_stretchable = "on",
        top_padding = appearance.row.vertical_padding - appearance.row.child_inset,
        bottom_padding = appearance.row.vertical_padding - appearance.row.child_inset,
        left_padding = appearance.row.horizontal_padding - appearance.row.child_inset,
        right_padding = appearance.row.horizontal_padding - appearance.row.child_inset,
    }
    styles[appearance.styles.row_text] = {
        type = "label_style",
        parent = "label",
        font = "default-listbox",
        font_color = styles.list_box_item.default_font_color,
        hovered_font_color = { 0, 0, 0 },
        parent_hovered_font_color = { 0, 0, 0 },
        clicked_font_color = { 0, 0, 0 },
        game_controller_hovered_font_color = { 0, 0, 0 },
        disabled_font_color = appearance.colors.muted,
    }
    styles[appearance.styles.selected_row_text] = {
        type = "label_style",
        parent = appearance.styles.row_text,
        font_color = { 0, 0, 0 },
    }
    styles[appearance.styles.retired_row_text] = {
        type = "label_style",
        parent = appearance.styles.row_text,
        font_color = appearance.colors.muted,
    }
    styles[appearance.styles.dirty_apply] = {
        type = "button_style",
        parent = "confirm_button",
        default_graphical_set = styles.forward_button.hovered_graphical_set,
        hovered_graphical_set = styles.forward_button.hovered_graphical_set,
        clicked_graphical_set = styles.forward_button.clicked_graphical_set,
    }
    styles[appearance.styles.delete] = {
        type = "button_style",
        parent = "red_button",
        width = 88,
        height = 28,
        top_padding = 0,
        bottom_padding = 0,
        left_padding = 8,
        right_padding = 8,
    }
    styles[appearance.styles.confirm_delete] = {
        type = "button_style",
        parent = "red_button",
        width = 64,
        height = 28,
        top_padding = 0,
        bottom_padding = 0,
        left_padding = 4,
        right_padding = 4,
        default_graphical_set = styles.button.hovered_graphical_set,
        hovered_graphical_set = styles.button.hovered_graphical_set,
        clicked_graphical_set = styles.button.clicked_graphical_set,
        default_font_color = styles.button.hovered_font_color,
        hovered_font_color = styles.button.hovered_font_color,
        clicked_font_color = styles.button.clicked_font_color,
    }
    -- Picker styles adapted from Factory Planner 2.1.15 (MIT, Claude Metz).
    styles[appearance.styles.picker_group] = {
        type = "button_style",
        parent = "filter_group_button_tab_slightly_larger",
        horizontally_stretchable = "off",
        width = 0,
        padding = 1,
    }
    local tile_widths = {}
    for index, width in ipairs(appearance.picker.group_widths) do
        tile_widths[index] = width - 8
    end
    styles[appearance.styles.picker_tabs] = {
        type = "scroll_pane_style",
        parent = "deep_scroll_pane",
        background_graphical_set = deep_slot_background_tiling(nil, 76, tile_widths),
        vertically_squashable = "off",
        padding = 0,
    }
end

return appearance
