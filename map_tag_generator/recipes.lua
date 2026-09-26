local dictionary = require("__flib__.dictionary")
local recipes = {}
local order_keys = {"group_order", "group", "subgroup_order", "subgroup", "order", "name"}

function recipes.unlocked(force)
    local unlocked = {}
    for name, recipe in pairs(force.recipes) do
        if recipe.enabled then unlocked[name] = true end
    end
    for _, technology in pairs(force.technologies) do
        if technology.researched then
            for _, effect in pairs(technology.prototype.effects) do
                if effect.type == "unlock-recipe" then unlocked[effect.recipe] = true end
            end
        end
    end
    return unlocked
end

local function entry(prototype, kind, translations)
    local translated = translations and translations[prototype.name]
    return {name = prototype.name, type = kind, key = kind.."/"..prototype.name,
        group = prototype.group.name, group_order = prototype.group.order,
        subgroup = prototype.subgroup.name, subgroup_order = prototype.subgroup.order,
        order = prototype.order, translated_name = helpers.multilingual_to_lower(translated or prototype.name)}
end

local function ordered(a, b)
    for _, key in ipairs(order_keys) do
        if a[key] ~= b[key] then return a[key] < b[key] end
    end
    return a.type < b.type
end

function recipes.catalog(player)
    local unlocked = recipes.unlocked(player.force)
    local translations = {}
    for _, kind in ipairs({"recipe", "item", "fluid"}) do translations[kind] = dictionary.get(player.index, kind) end
    local catalog = {recipes = {}, products = {}, by_product = {}}
    local products = {}
    for name, recipe in pairs(player.force.recipes) do
        local prototype = recipe.prototype
        if not prototype.hidden and #prototype.ingredients > 0 then
            local recipe_entry = entry(prototype, "recipe", translations.recipe)
            recipe_entry.unlocked = unlocked[name] == true
            catalog.recipes[#catalog.recipes + 1] = recipe_entry
        end
    end
    table.sort(catalog.recipes, ordered)
    for _, recipe in ipairs(catalog.recipes) do
        local seen = {}
        for _, product in pairs(prototypes.recipe[recipe.name].products) do
            local key = product.type.."/"..product.name
            local prototype = prototypes[product.type][product.name]
            if prototype and not prototype.hidden and not seen[key] and (product.probability or 1) > 0 then
                seen[key] = true
                if not products[key] then
                    products[key] = entry(prototype, product.type, translations[product.type])
                    products[key].unlocked = false
                    catalog.products[#catalog.products + 1] = products[key]
                    catalog.by_product[key] = {}
                end
                products[key].unlocked = products[key].unlocked or recipe.unlocked
                local choices = catalog.by_product[key]
                choices[#choices + 1] = recipe
            end
        end
    end
    table.sort(catalog.products, ordered)
    return catalog
end

function recipes.matches(entry, query, researched_only)
    return (not researched_only or entry.unlocked)
        and (query == "" or query == entry.name or entry.translated_name:find(query, 1, true) ~= nil)
end

function recipes.choices(catalog, product, researched_only)
    local choices = {}
    for _, recipe in ipairs(catalog.by_product[product] or {}) do
        if not researched_only or recipe.unlocked then choices[#choices + 1] = recipe end
    end
    return choices
end

return recipes
