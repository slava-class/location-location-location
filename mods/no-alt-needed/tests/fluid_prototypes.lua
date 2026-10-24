-- Only loaded with FactorioTest. Native prototypes supply graphics/placement;
-- the connection layouts and recipes below are independently authored fixtures.
local function copy(kind, source, name)
    local prototype = table.deepcopy(data.raw[kind][source])
    prototype.name = name
    prototype.minable = nil
    prototype.hidden = false
    prototype.hidden_in_factoriopedia = true
    prototype.next_upgrade = nil
    prototype.fast_replaceable_group = nil
    return prototype
end

local machine = copy("assembling-machine", "assembling-machine-3", "no-alt-needed-test-fluid-machine")
machine.collision_box = { { -2.4, -2.4 }, { 2.4, 2.4 } }
machine.selection_box = { { -2.5, -2.5 }, { 2.5, 2.5 } }
machine.crafting_categories = { "no-alt-needed-test-fluid" }
machine.fluid_boxes_off_when_no_fluid_recipe = false
machine.use_mirroring = true
machine.fluid_boxes = {
    {
        volume = 100,
        production_type = "input",
        pipe_connections = { { direction = defines.direction.west, position = { -2, 0 }, flow_direction = "input" } },
    },
    {
        volume = 100,
        production_type = "input",
        pipe_connections = {
            {
                direction = defines.direction.north,
                position = { 0, -2 },
                flow_direction = "input",
                hide_connection_info = true,
            },
        },
    },
    {
        volume = 100,
        production_type = "output",
        pipe_connections = { { direction = defines.direction.east, position = { 2, 0 }, flow_direction = "output" } },
    },
}
machine.energy_source = {
    type = "fluid",
    effectivity = 1,
    burns_fluid = false,
    fluid_usage_per_tick = 0.1,
    maximum_temperature = 165,
    fluid_box = {
        volume = 100,
        production_type = "input",
        filter = "steam",
        pipe_connections = { { direction = defines.direction.south, position = { 0, 2 }, flow_direction = "input" } },
    },
}

local asymmetric = copy("assembling-machine", "assembling-machine-3", "no-alt-needed-test-asymmetric-fluid-machine")
asymmetric.collision_box = { { -2.4, -2.4 }, { 2.4, 2.4 } }
asymmetric.selection_box = { { -2.5, -2.5 }, { 2.5, 2.5 } }
asymmetric.crafting_categories = { "no-alt-needed-test-fluid" }
asymmetric.fluid_boxes_off_when_no_fluid_recipe = false
asymmetric.fluid_boxes = {
    {
        volume = 100,
        production_type = "input",
        pipe_connections = {
            {
                direction = defines.direction.west,
                positions = { { -2, 1 }, { 1, -2 }, { -2, 1 }, { 1, -2 } },
                flow_direction = "input",
            },
        },
    },
}

local furnace = copy("furnace", "electric-furnace", "no-alt-needed-test-fluid-furnace")
furnace.collision_box = { { -2.4, -2.4 }, { 2.4, 2.4 } }
furnace.selection_box = { { -2.5, -2.5 }, { 2.5, 2.5 } }
furnace.crafting_categories = { "no-alt-needed-test-fluid-smelting" }
furnace.fluid_boxes = {
    {
        volume = 100,
        production_type = "input",
        pipe_connections = { { direction = defines.direction.north, position = { 0, -2 }, flow_direction = "input" } },
    },
}

local silo = copy("rocket-silo", "rocket-silo", "no-alt-needed-test-fluid-silo")
silo.fluid_boxes = {
    {
        volume = 100,
        production_type = "input",
        pipe_connections = { { direction = defines.direction.west, position = { -4, 0 }, flow_direction = "input" } },
    },
}
silo.fluid_boxes_off_when_no_fluid_recipe = false
silo.fixed_recipe = "no-alt-needed-test-silo-fluid-recipe"

local recipes = {
    {
        type = "recipe",
        name = "no-alt-needed-test-fluid-recipe",
        categories = { "no-alt-needed-test-fluid" },
        enabled = true,
        hidden = true,
        energy_required = 2,
        ingredients = {
            {
                type = "fluid",
                name = "water",
                amount = 10,
                fluidbox_index = 1,
                optional_fluidbox_indexes = { 2 },
                minimum_temperature = 15,
                maximum_temperature = 100,
            },
        },
        results = { { type = "fluid", name = "steam", amount = 10, fluidbox_index = 1, temperature = 165 } },
        icons = { { icon = "__base__/graphics/icons/fluid/steam.png", icon_size = 64 } },
    },
    {
        type = "recipe",
        name = "no-alt-needed-test-other-fluid-recipe",
        categories = { "no-alt-needed-test-fluid" },
        enabled = true,
        hidden = true,
        energy_required = 2,
        ingredients = { { type = "fluid", name = "crude-oil", amount = 10, fluidbox_index = 1 } },
        results = { { type = "fluid", name = "light-oil", amount = 10, fluidbox_index = 1 } },
        icons = { { icon = "__base__/graphics/icons/fluid/light-oil.png", icon_size = 64 } },
    },
    {
        type = "recipe",
        name = "no-alt-needed-test-asymmetric-fluid-recipe",
        categories = { "no-alt-needed-test-fluid" },
        enabled = true,
        hidden = true,
        energy_required = 2,
        ingredients = { { type = "fluid", name = "water", amount = 10 } },
        results = { { type = "item", name = "iron-plate", amount = 1 } },
    },
}

local shifted_pipe = copy("pipe", "pipe", "no-alt-needed-test-shifted-pipe")
shifted_pipe.icon_draw_specification = { shift = { 0.25, -0.75 }, scale = 1.25 }

data:extend({
    shifted_pipe,
    machine,
    asymmetric,
    furnace,
    silo,
    { type = "recipe-category", name = "no-alt-needed-test-fluid" },
    { type = "recipe-category", name = "no-alt-needed-test-fluid-smelting" },
    {
        type = "item",
        name = "no-alt-needed-test-fluid-machine",
        icon = "__base__/graphics/icons/assembling-machine-3.png",
        icon_size = 64,
        stack_size = 50,
        place_result = machine.name,
        hidden = true,
    },
    {
        type = "item",
        name = "no-alt-needed-test-asymmetric-fluid-machine",
        icon = "__base__/graphics/icons/assembling-machine-3.png",
        icon_size = 64,
        stack_size = 50,
        place_result = asymmetric.name,
        hidden = true,
    },
})
data:extend(recipes)
local furnace_recipe = {
    type = "recipe",
    name = "no-alt-needed-test-furnace-fluid-recipe",
    categories = { "no-alt-needed-test-fluid-smelting" },
    enabled = true,
    hidden = true,
    ingredients = { { type = "item", name = "stone", amount = 1 }, { type = "fluid", name = "water", amount = 10 } },
    results = { { type = "item", name = "iron-plate", amount = 1 } },
    energy_required = 1,
}
local silo_recipe = table.deepcopy(data.raw.recipe["rocket-part"])
silo_recipe.name = silo.fixed_recipe
silo_recipe.hidden = true
silo_recipe.enabled = true
silo_recipe.ingredients = { { type = "fluid", name = "water", amount = 10 } }
data:extend({ furnace_recipe, silo_recipe })
