-- Only loaded when FactorioTest is active; these recipes never enter normal saves.
data:extend({
    {
        type = "recipe",
        name = "location_location_location_probability_fixture",
        main_product = "copper-cable",
        enabled = true,
        ingredients = { { type = "item", name = "iron-plate", amount = 1 } },
        results = {
            { type = "item", name = "iron-stick", amount = 1, independent_probability = 0 },
            { type = "item", name = "electronic-circuit", amount = 1, shared_probability = { min = 0.5, max = 0.5 } },
            { type = "item", name = "copper-cable", amount = 1, independent_probability = 0.5 },
        },
    },
    {
        type = "recipe",
        name = "location_location_location_probability_consumer",
        enabled = true,
        hidden = true,
        ingredients = {
            { type = "item", name = "iron-stick", amount = 1 },
            { type = "item", name = "electronic-circuit", amount = 1 },
            { type = "item", name = "copper-cable", amount = 1 },
        },
        results = { { type = "item", name = "iron-plate", amount = 1 } },
    },
})
