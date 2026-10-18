local pencil = data.raw["utility-sprites"].default.rename_icon

data:extend({
    {
        type = "custom-input",
        name = "py-research-dossier-flag",
        key_sequence = "CONTROL + SHIFT + K",
        include_selected_prototype = true,
    },
    {
        type = "shortcut",
        name = "py-research-dossier-flag",
        associated_control_input = "py-research-dossier-flag",
        action = "lua",
        order = "d[research-dossier]",
        icons = { { icon = pencil.filename, icon_size = 32 } },
        small_icons = { { icon = pencil.filename, icon_size = 32, scale = 0.5 } },
    },
})
