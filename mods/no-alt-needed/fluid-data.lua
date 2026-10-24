local Policy = require("scripts.fluid-policy")

if mods["factorio-test"] then
    require("tests.fluid_prototypes")
end

local metadata = {
    schema = 1,
    declutter = settings.startup["no-alt-needed-fluid-declutter"].value,
    has_owned = false,
    categories = {},
    entities = {},
    recipe_routes = {},
}

local function suppress_box(box, source, entry)
    if not box then
        return
    end
    for _, connection in ipairs(box.pipe_connections or {}) do
        local key = Policy.connection_key(connection)
        if key then
            local owned = connection.hide_connection_info ~= true
            entry.ports[key] = { owned = owned, source = source }
            if owned then
                connection.hide_connection_info = true
                metadata.has_owned = true
            end
        end
    end
end

for _, category in ipairs(Policy.categories) do
    local enabled = Policy.enabled(settings.startup, category)
    metadata.categories[category] = enabled
    if enabled then
        for name, prototype in pairs(data.raw[category] or {}) do
            local entry = { category = category, ports = {} }
            for _, field in ipairs(Policy.fields[category]) do
                if field == "fluid_boxes" then
                    for _, box in ipairs(prototype.fluid_boxes or {}) do
                        suppress_box(box, "crafting", entry)
                    end
                else
                    suppress_box(prototype[field], "entity", entry)
                end
            end
            local energy = prototype.energy_source
            if energy and energy.type == "fluid" then
                suppress_box(energy.fluid_box, "energy", entry)
                suppress_box(energy.output_fluid_box, "energy", entry)
            end
            if next(entry.ports) then
                metadata.entities[name] = entry
            end
        end
    end
end

-- The runtime recipe ingredient/product contract omits optional fluidbox
-- indexes. Retain only recipes needing this public prototype-stage routing
-- information for ghosts whose runtime fluid storages are not instantiated.
local function has_optional_routes(values)
    for _, value in ipairs(values or {}) do
        if value.type == "fluid" and value.optional_fluidbox_indexes then
            return true
        end
    end
    return false
end

local function routes(values)
    local result = {}
    local ordinal = 0
    for _, value in ipairs(values or {}) do
        if value.type == "fluid" then
            ordinal = ordinal + 1
            result[#result + 1] = {
                name = value.name,
                index = value.fluidbox_index and value.fluidbox_index > 0 and value.fluidbox_index or ordinal,
                extra = value.optional_fluidbox_indexes or {},
            }
        end
    end
    return result
end

if metadata.declutter then
    for name, recipe in pairs(data.raw.recipe) do
        if has_optional_routes(recipe.ingredients) or has_optional_routes(recipe.results) then
            metadata.recipe_routes[name] = {
                input = routes(recipe.ingredients),
                output = routes(recipe.results),
            }
        end
    end
end

data:extend({
    {
        type = "mod-data",
        name = Policy.metadata_name,
        data_type = "no-alt-needed.fluid-policy.v1",
        data = metadata,
    },
})

return metadata
