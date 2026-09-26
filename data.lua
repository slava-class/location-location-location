local prefix = "map_tag_generator_"
local graphics = "__map-tag-generator__/graphics/"
local function selection(color, cursor)
    return {border_color = color, cursor_box_type = cursor, mode = {"any-entity"}}
end

data:extend({
    {
        type = "selection-tool", name = prefix.."planner_tool", hidden = true,
        flags = {"not-stackable", "only-in-cursor", "spawnable"}, stack_size = 1,
        draw_label_for_cursor_render = true,
        select = selection({0.2, 0.8, 1}, "copy"),
        alt_select = selection({0.2, 0.8, 1}, "copy"),
        reverse_select = selection({1, 0.3, 0.2}, "not-allowed"),
        alt_reverse_select = selection({1, 0.3, 0.2}, "not-allowed"),
        icons = {
            {icon = graphics.."black_square.png", icon_size = 64},
            {icon = graphics.."map_tag_icon_white.png", icon_size = 32, scale = 0.5},
        },
        custom_tooltip_fields = {{order = 1, name = "", value = {"map-tag-planner.tool-instructions"}}},
    },
    {type = "custom-input", name = prefix.."open_planner", key_sequence = "CONTROL + SHIFT + T"},
    {type = "custom-input", name = prefix.."highlight_sources", key_sequence = ""},
    {
        type = "shortcut", name = prefix.."open_planner", associated_control_input = prefix.."open_planner",
        action = "lua", order = "a[recipe-planner]",
        icons = {{icon = graphics.."map_tag_icon_black.png", icon_size = 32}},
        small_icons = {{icon = graphics.."map_tag_icon_black.png", icon_size = 32, scale = 0.5}},
    },
    {
        type = "shortcut", name = prefix.."highlight_sources", associated_control_input = prefix.."highlight_sources",
        action = "lua", toggleable = true, order = "b[recipe-planner-sources]",
        icons = {{icon = graphics.."map_tag_icon_white.png", icon_size = 32, tint = {0.15, 0.65, 1}}},
        small_icons = {{icon = graphics.."map_tag_icon_white.png", icon_size = 32, scale = 0.5, tint = {0.15, 0.65, 1}}},
    },
    {
        type = "sprite", name = prefix.."planner_icon", filename = graphics.."map_tag_icon_black_small.png",
        priority = "extra-high-no-scale", size = 32, flags = {"icon"},
    },
    {
        type = "sprite", name = prefix.."highlight_icon_white", filename = graphics.."map_tag_icon_white.png",
        priority = "extra-high-no-scale", size = 32, flags = {"icon"},
    },
    {
        type = "sprite", name = prefix.."archive", filename = graphics.."archive.png",
        size = 32, mipmap_count = 2, flags = {"gui-icon"},
    },
})

-- Picker styles adapted from Factory Planner 2.1.15 (MIT, Claude Metz).
local styles = data.raw["gui-style"].default
styles.map_tag_generator_picker_group_tab = {
    type = "button_style", parent = "filter_group_button_tab_slightly_larger",
    horizontally_stretchable = "on", width = 0, padding = 1,
}
styles.map_tag_generator_picker_tabs = {
    type = "scroll_pane_style", parent = "naked_scroll_pane",
    background_graphical_set = deep_slot_background_tiling(71, 76),
    scrollbars_go_outside = true, vertically_squashable = "off", padding = 0,
}
styles.map_tag_generator_picker_tabs_scrolling = {
    type = "scroll_pane_style", parent = "map_tag_generator_picker_tabs",
    background_graphical_set = deep_slot_background_tiling(69, 76),
}
styles.map_tag_generator_picker_frame_button = {
    type = "button_style", parent = "frame_action_button",
    selected_graphical_set = styles.frame_button.clicked_graphical_set,
    selected_hovered_graphical_set = styles.frame_button.hovered_graphical_set,
    selected_clicked_graphical_set = styles.frame_button.default_graphical_set,
}
