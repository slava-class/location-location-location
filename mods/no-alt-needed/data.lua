data:extend({
    {
        type = "custom-input",
        name = "no-alt-needed-experiments",
        key_sequence = "",
        consuming = "none",
    },
    {
        type = "shortcut",
        name = "no-alt-needed-experiments",
        action = "lua",
        toggleable = true,
        associated_control_input = "no-alt-needed-experiments",
        order = "z[no-alt-needed]-a[experiments]",
        icon = "__core__/graphics/icons/mip/technology-white.png",
        icon_size = 64,
        small_icon = "__core__/graphics/icons/mip/technology-white.png",
        small_icon_size = 64,
    },
})

-- View-local hover targets. Ordinary entities always win selection.
for exponent = 1, 6 do
    local size = 2 ^ exponent
    data:extend({
        {
            type = "simple-entity-with-owner",
            name = "no-alt-needed-pointer-" .. size,
            localised_name = "",
            hidden = true,
            flags = {
                "placeable-off-grid",
                "not-on-map",
                "not-blueprintable",
                "not-deconstructable",
                "not-upgradable",
                "not-repairable",
                "not-flammable",
                "not-in-kill-statistics",
                "hide-alt-info",
            },
            max_health = 1,
            collision_box = { { 0, 0 }, { 0, 0 } },
            collision_mask = { layers = {} },
            selection_box = { { -size / 2, -size / 2 }, { size / 2, size / 2 } },
            selection_priority = 1,
            selectable_in_game = true,
            allow_copy_paste = false,
            picture = { filename = "__core__/graphics/empty.png", width = 1, height = 1 },
        },
    })
end
