local mtg = require("map_tag_generator.constants")

local pref = "map_tag_generator_"

for _, category in pairs(mtg.entity_categories) do
    data:extend({
        {
            type = "bool-setting",
            setting_type = "runtime-per-user",
            name = pref.."include_"..category,
            default_value = mtg.entity_category_defaults[category],
            order = "[g]"..category,
        }
    })
end

data:extend({
    {
        type = "bool-setting",
        setting_type = "runtime-per-user",
        name = pref.."show_spawn_tool_button",
        default_value = true,
        order = "[a]",
    },

    {
        type = "string-setting",
        setting_type = "runtime-per-user",
        name = pref.."position_style",
        allowed_values = mtg.position_styles,
        default_value = mtg.position_styles.middle_of_entities,
        order = "[b]",
    },

    {
        type = "string-setting",
        setting_type = "runtime-per-user",
        name = pref.."layout_style",
        allowed_values = mtg.layout_styles,
        default_value = mtg.layout_styles.horizontal,
        order = "[c]",
    },

    {
        type = "bool-setting",
        setting_type = "runtime-per-user",
        name = pref.."add_tags_dialog",
        default_value = true,
        order = "[d]",
    },

    {
        type = "bool-setting",
        setting_type = "runtime-per-user",
        name = pref.."always_add_tags_dialog",
        default_value = false,
        order = "[e]",
    },

    {
        type = "bool-setting",
        setting_type = "runtime-per-user",
        name = pref.."generate_tag_names",
        default_value = false,
        order = "[f]",
    },

    {
        type = "bool-setting",
        setting_type = "runtime-per-user",
        name = pref.."restrict_deletion_player",
        default_value = false,
        order = "[h]",
    },

    {
        type = "bool-setting",
        setting_type = "runtime-per-user",
        name = pref.."delete_tags_dialog",
        default_value = true,
        order = "[i]",
    },

    {
        type = "bool-setting",
        setting_type = "runtime-global",
        name = pref.."restrict_deletion_map",
        default_value = false,
        order = "[a]",
    },
})