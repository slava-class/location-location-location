local mtg = require("map_tag_generator.constants")

local pref = "map_tag_generator_"
local path = "__map-tag-generator__/graphics/"

local selection_color = {r = 1, g = 0, b = 1, a = 1}
local deletion_color = {r = 1, g = 0, b = 0, a = 1}
local entity_type_filters = {}
for _, t in pairs(mtg.entity_types) do
    for _, type in pairs(t) do
        table.insert(entity_type_filters, type)
    end
end

data:extend({
    {
        -- selection and alt_selection are for generating tags
        -- reverse_selection is for deleting tags
        type = "selection-tool",
        name = pref.."selection_tool",
        draw_label_for_cursor_render = true,

        ---@diagnostic disable-next-line: missing-fields
        select = {
            border_color = selection_color,
            cursor_box_type = "copy",
            mode = {"any-entity"},
            entity_type_filters = entity_type_filters,
        },
        ---@diagnostic disable-next-line: missing-fields
        alt_select = {
            border_color = selection_color,
            cursor_box_type = "copy",
            mode = {"any-entity"},
            entity_type_filters = entity_type_filters,
        },
        ---@diagnostic disable-next-line: missing-fields
        super_forced_select = {
            border_color = selection_color,
            cursor_box_type = "copy",
            mode = {"any-entity"},
            entity_type_filters = entity_type_filters,
        },
        ---@diagnostic disable-next-line: missing-fields
        reverse_select = {
            border_color = deletion_color,
            cursor_box_type = "copy",
            mode = {"nothing"},
        },
        ---@diagnostic disable-next-line: missing-fields
        alt_reverse_select = {
            border_color = deletion_color,
            cursor_box_type = "copy",
            mode = {"nothing"},
        },

        hidden = true,
        flags = {"not-stackable", "only-in-cursor", "spawnable"},
        stack_size = 1,
        icons = {
            {
                icon = path.."black_square.png",
                icon_size = 64,
            },
            {
                icon = path.."map_tag_icon_white.png",
                icon_size = 32,
                scale = 0.5,
            },
        },

        custom_tooltip_fields = {
            {order = 1, name = {"gui.instruction-when-in-cursor"}, value = ""},
            {order = 2, name = "", value = {"map-tag-generator.instruction_to_create_tags"}},
            {order = 3, name = "", value = {"map-tag-generator.instruction_to_force_create_tags"}},
            {order = 4, name = "", value = {"map-tag-generator.instruction_to_delete_tags"}},
        },
    },

    {
        type = "custom-input",
        name = pref.."spawn_selection_tool",
        key_sequence = "SHIFT + T",
        action = "spawn-item",
        item_to_spawn = pref.."selection_tool"
    },

    {
        type = "custom-input",
        name = pref.."confirm_gui_linked",
        key_sequence = "",
        linked_game_control = "confirm-gui",
    },

    {
        type = "custom-input",
        name = pref.."pipette_linked",
        key_sequence = "",
        linked_game_control = "pipette",
    },

    {
        type = "shortcut",
        name = pref.."spawn_selection_tool",
        associated_control_input = pref.."spawn_selection_tool",
        action = "spawn-item",
        item_to_spawn = pref.."selection_tool",
        icons =
        {
            {
                icon = path.."map_tag_icon_black.png",
                icon_size = 32,
                scale = 1,
            },
        },
        small_icons =
        {
            {
                icon = path.."map_tag_icon_black.png",
                icon_size = 32,
                scale = 0.5,
            },
        },
    },

    {
        type = "sprite",
        name = pref.."tag_icon",
        filename = path.."map_tag_icon_black_small.png",
        priority = "extra-high-no-scale",
        size = 32,
        flags = {"icon"},
    },
    {
        type = "sprite",
        name = pref.."reorder_tags",
        filename = path.."reorder_tags.png",
        priority = "extra-high-no-scale",
        size = 64,
        flags = {"icon"},
    },
    {
        type = "sprite",
        name = pref.."select_all",
        filename = path.."select_all.png",
        priority = "extra-high-no-scale",
        size = 32,
        flags = {"icon"},
    },
    {
        type = "sprite",
        name = pref.."deselect_all",
        filename = path.."deselect_all.png",
        priority = "extra-high-no-scale",
        size = 32,
        flags = {"icon"},
    },
})

data.raw["gui-style"]["default"][pref.."no_toggle_button"] = {
    type = "button_style",
    parent = "flib_slot_button_red",
    left_click_sound = {{ filename = "__core__/sound/cannot-build.ogg", volume = 1 }},
}