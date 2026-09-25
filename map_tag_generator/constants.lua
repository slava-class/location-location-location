return {
    ---@enum EntityCategory
    entity_categories = {
        "accumulators",
        "turrets",
        "assemblers",
        "power_generators",
        "labs",
        "resources",
        "train_stops",
        "agricultural_towers",
        "cargo_landing_pads",
    },

    ---@type table<EntityCategory, boolean>
    entity_category_defaults = {
        accumulators = true,
        turrets = false,
        assemblers = true,
        power_generators = true,
        labs = true,
        resources = true,
        train_stops = false,
        agricultural_towers = true,
        cargo_landing_pads = true,
    },

    ---@type table<EntityCategory, string[]>
    entity_types = {
        accumulators = {
            "accumulator",
        },
        turrets = {
            "ammo-turret",
            "artillery-turret",
            "electric-turret",
            "fluid-turret",
            -- in vanilla, "turret" category is for worms, so we don't want to include those
            -- if any mods add regular turrets in this category, we'll have to re-enable it and filter more specifically
            -- "turret",
        },
        assemblers = {
            "assembling-machine",
            "furnace",
            "rocket-silo",
        },
        power_generators = {
            "burner-generator",
            "generator",
            "solar-panel",
            "fusion-generator",
        },
        labs = {
            "lab",
        },
        resources = {
            "resource",
        },
        train_stops = {
            "train-stop",
        },
        agricultural_towers = {
            "agricultural-tower",
        },
        cargo_landing_pads = {
            "cargo-landing-pad",
        },
    },

    ---@enum PositionStyle
    position_styles = {
        middle_of_entities = "map_tag_generator_middle_of_entities",
        average_of_entities = "map_tag_generator_average_of_entities",
        center_of_selection = "map_tag_generator_center_of_selection",
    },

    ---@enum LayoutStyle
    layout_styles = {
        horizontal = "map_tag_generator_horizontal",
        vertical = "map_tag_generator_vertical",
        square = "map_tag_generator_square",
    },

    ---@enum ToggleAllMode
    toggle_all_modes = {
        select = "map_tag_generator_select",
        deselect = "map_tag_generator_deselect",
    },

    tag_shift_amount = 18,
}