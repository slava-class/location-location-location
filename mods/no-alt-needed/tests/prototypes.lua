local fixtures = {}
for _, slots in ipairs({ 10, 20, 30, 40 }) do
    local machine = table.deepcopy(data.raw["assembling-machine"]["assembling-machine-3"])
    machine.name = "no-alt-needed-test-farm-" .. slots
    machine.module_slots = slots
    machine.allowed_effects = { "consumption", "speed", "pollution", "productivity", "quality" }
    machine.allowed_module_categories = { "speed" }
    machine.collision_box = { { -4.8, -4.8 }, { 4.8, 4.8 } }
    machine.selection_box = { { -5, -5 }, { 5, 5 } }
    machine.icon_draw_specification = { scale = 2, shift = { 0.25, -0.5 } }
    machine.icons_positioning = {
        {
            inventory_index = defines.inventory.crafter_modules,
            shift = { 0, 2 },
            max_icons_per_row = 10,
            max_icon_rows = 4,
            scale = 0.5,
        },
    }
    fixtures[#fixtures + 1] = machine
    local item = table.deepcopy(data.raw.item["assembling-machine-3"])
    item.name = machine.name
    item.place_result = machine.name
    item.hidden = true
    fixtures[#fixtures + 1] = item
end
local storage = table.deepcopy(data.raw.container["steel-chest"])
storage.name = "no-alt-needed-test-enlarged-storage"
storage.icon_draw_specification = { scale = 2, scale_for_many = 3, shift = { 0.25, -1.25 } }
fixtures[#fixtures + 1] = storage
local quiet = table.deepcopy(data.raw["assembling-machine"]["assembling-machine-3"])
quiet.name = "no-alt-needed-test-no-recipe-icon"
quiet.show_recipe_icon = false
fixtures[#fixtures + 1] = quiet
local hidden = table.deepcopy(quiet)
hidden.name = "no-alt-needed-test-hidden-info"
local flags = assert(hidden.flags)
flags[#flags + 1] = "hide-alt-info"
fixtures[#fixtures + 1] = hidden
for _, suffix in ipairs({ "a", "b" }) do
    local recipe = table.deepcopy(data.raw.recipe["iron-gear-wheel"])
    recipe.name = "no-alt-needed-test-gears-" .. suffix
    recipe.enabled = true
    fixtures[#fixtures + 1] = recipe
end
local automatic = table.deepcopy(data.raw.furnace["electric-furnace"])
automatic.name = "no-alt-needed-test-automatic-furnace"
automatic.crafting_categories = { "no-alt-needed-test-smelting" }
automatic.energy_source = { type = "void" }
automatic.crafting_speed = 1
automatic.source_inventory_size = 1
automatic.result_inventory_size = 1
fixtures[#fixtures + 1] = automatic
fixtures[#fixtures + 1] = { type = "recipe-category", name = "no-alt-needed-test-smelting" }
fixtures[#fixtures + 1] = {
    type = "recipe",
    name = "no-alt-needed-test-automatic-smelting",
    categories = { "no-alt-needed-test-smelting" },
    enabled = true,
    hidden = true,
    ingredients = { { type = "item", name = "stone", amount = 1 } },
    results = { { type = "item", name = "iron-plate", amount = 1 } },
    energy_required = 100,
}
fixtures[#fixtures + 1] = {
    type = "recipe",
    name = "no-alt-needed-test-module-input",
    categories = { "crafting" },
    enabled = true,
    hidden = true,
    ingredients = { { type = "item", name = "speed-module", amount = 1 } },
    results = { { type = "item", name = "iron-plate", amount = 1 } },
}
for _, definition in ipairs({
    {
        suffix = "source",
        priority = "secondary-output",
        production = "1MW",
        usage = "0W",
        input = "0W",
        output = "1MW",
    },
    { suffix = "load", priority = "secondary-input", production = "0W", usage = "200kW", input = "1MW", output = "0W" },
}) do
    local interface = table.deepcopy(data.raw["electric-energy-interface"]["electric-energy-interface"])
    interface.name = "no-alt-needed-test-power-" .. definition.suffix
    interface.energy_production, interface.energy_usage = definition.production, definition.usage
    interface.energy_source = {
        type = "electric",
        usage_priority = definition.priority,
        buffer_capacity = "100kJ",
        input_flow_limit = definition.input,
        output_flow_limit = definition.output,
        drain = "0W",
    }
    fixtures[#fixtures + 1] = interface
end
for _, definition in ipairs({
    {
        resource = "iron-ore",
        suffix = "ore",
        category = "basic-solid",
        product = "item",
        drill = "electric-mining-drill",
        drill_suffix = "drill",
    },
    {
        resource = "crude-oil",
        suffix = "oil",
        category = "basic-fluid",
        product = "fluid",
        drill = "pumpjack",
        drill_suffix = "pumpjack",
    },
}) do
    local resource = table.deepcopy(data.raw.resource[definition.resource])
    resource.name = "no-alt-needed-test-" .. definition.suffix
    resource.category, resource.autoplace = definition.category, nil
    ---@type data.ProductPrototype
    local product
    if definition.product == "item" then
        product = { type = "item", name = definition.resource, amount = 1 }
    else
        product = { type = "fluid", name = definition.resource, amount = 1 }
    end
    resource.minable = {
        mining_time = 1,
        results = { product },
    }
    fixtures[#fixtures + 1] = resource
    local drill = table.deepcopy(data.raw["mining-drill"][definition.drill])
    drill.name = "no-alt-needed-test-" .. definition.drill_suffix
    drill.resource_categories = { definition.category }
    drill.energy_source = { type = "void" }
    fixtures[#fixtures + 1] = drill
end
local inserter = table.deepcopy(data.raw.inserter["fast-inserter"])
inserter.name = "no-alt-needed-test-inserter"
inserter.energy_source = { type = "void" }
inserter.allow_custom_vectors = true
inserter.rotation_speed, inserter.extension_speed = 0.04, 0.07
fixtures[#fixtures + 1] = inserter
local inserter_item = table.deepcopy(data.raw.item["fast-inserter"])
inserter_item.name, inserter_item.place_result, inserter_item.hidden = inserter.name, inserter.name, true
fixtures[#fixtures + 1] = inserter_item
local radar = table.deepcopy(data.raw.radar.radar)
radar.name = "no-alt-needed-test-radar"
radar.energy_source = { type = "void" }
radar.max_distance_of_nearby_sector_revealed = 3
fixtures[#fixtures + 1] = radar
data:extend(fixtures)
