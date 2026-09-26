local prefix = "location_location_location_"
local utility = data.raw["utility-sprites"].default
local appearance = require("location_location_location.gui.appearance")
local highlight_icon = utility[appearance.highlight_source]
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
        icons = {{icon = utility.center.filename, icon_size = 32}},
        custom_tooltip_fields = {{order = 1, name = "", value = {"location-location-location.tool-instructions"}}},
    },
    {type = "custom-input", name = prefix.."open_planner", key_sequence = "CONTROL + SHIFT + L"},
    {type = "custom-input", name = prefix.."highlight_sources", key_sequence = ""},
    {type = "custom-input", name = prefix.."focus_search", key_sequence = "", linked_game_control = "focus-search"},
    {
        type = "shortcut", name = prefix.."open_planner", associated_control_input = prefix.."open_planner",
        action = "lua", order = "a[recipe-planner]",
        icons = {{icon = utility.map.filename, icon_size = 32}},
        small_icons = {{icon = utility.map.filename, icon_size = 32, scale = 0.5}},
    },
    {
        type = "shortcut", name = prefix.."highlight_sources", associated_control_input = prefix.."highlight_sources",
        action = "lua", toggleable = true, order = "b[recipe-planner-sources]",
        icons = {{icon = highlight_icon.filename, icon_size = 32, tint = {0, 0, 0}, draw_background = false}},
        small_icons = {{icon = highlight_icon.filename, icon_size = 32, scale = 0.5, tint = {0, 0, 0}, draw_background = false}},
    },
})

appearance.register()
