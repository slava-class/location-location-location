local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local signals = require("map_tag_generator.signals")
local util = require("map_tag_generator.lualib")

---@type SelectionHandler
local assemblers = {} ---@diagnostic disable-line: missing-fields

---@param product { type: "item"|"fluid", name: string, quality_name: string }
---@param enabled boolean
---@param player_table PlayerData
---@return TagTable
local function get_tag_table(product, enabled, player_table)
    local signal = signals.get_valid_signal({type = product.type, name = product.name, quality = product.quality_name}, {type = "virtual", name = "signal-unknown"}) --[[@as SignalID]]
    local text
    if player_table.generate_tag_names and player_table.translations[signal.type] then
        text = player_table.translations[signal.type][signal.name]
    end
    return tag_tables.new({signal = signal, enabled = enabled, text = text})
end

---@class (exact) DetectMainProductsData
---@field type "item"|"fluid" The type of product.
---@field is_product boolean If the item/fluid is a product of any recipes from the assemblers.
---@field is_main boolean If the item/fluid is a product and is **not** an ingredient in any other recipes from the assemblers. Is also false if there is a higher-quality version of the item/fluid present.

---@param assembler_entities LuaEntity[]
---@return { [string]: DetectMainProductsData }
assemblers.detect_main_products = function(assembler_entities)
    -- get table of products that are not used as non-catalyst ingredients
    ---@type { [string]: DetectMainProductsData }
    local items_table = {} -- track ingredient/product status
    ---@type { [string]: boolean }
    local recipes_table = {} -- track recipes

    for _, assembler in pairs(assembler_entities) do
        local recipe, quality = assembler.get_recipe()
        if recipe then
            local quality_name
            if quality == nil then
                quality_name = "normal"
            else
                quality_name = quality.name
            end

            local recipes_table_key = recipe.name .. "||" .. quality_name
            if not recipes_table[recipes_table_key] then
                -- flag recipe as processed
                recipes_table[recipes_table_key] = true

                for _, product in pairs(recipe.products) do
                    -- if product isn't already in items_table, enable it
                    local items_table_key = product.name .. "||" .. quality_name
                    if not items_table[items_table_key] then
                        items_table[items_table_key] = {type = product.type, is_product = true, is_main = true}

                    -- if product is already there, make sure it's flagged as a product
                    else
                        items_table[items_table_key].is_product = true
                    end

                    for other_product_quality, other_data in pairs(items_table) do
                        local other_product, other_quality = other_product_quality:match("^(.-)%|%|(.-)$")
                        if other_product == product.name then
                            -- set all lower-quality versions of the product as not-main
                            if util.quality_is_less_than(other_quality, quality_name) then
                                other_data.is_main = false
                            -- also, if there is already a higher-quality version of the product, set THIS to not-main
                            elseif util.quality_is_less_than(quality_name, other_quality) then
                                items_table[items_table_key].is_main = false
                            end
                        end
                    end
                end

                for _, ingredient in pairs(recipe.ingredients) do
                    -- disable non-catalyst ingredients
                    items_table_key = ingredient.name .. "||" .. quality_name
                    if (ingredient.ignored_by_stats == nil) or ingredient.ignored_by_stats < ingredient.amount then
                        if items_table[items_table_key] then
                            items_table[items_table_key].is_main = false
                        else
                            items_table[items_table_key] = {type = ingredient.type, is_product = false, is_main = false}
                        end
                    end
                end
            end
        end
    end

    return items_table
end

---@param entities LuaEntity[]
---@param player_table PlayerData
---@return TagPackage
assemblers.get_tag_package = function(entities, player_table)
    local tag_package = tag_packages.new()
    for item_quality_name, data in pairs(assemblers.detect_main_products(entities)) do
        local item_name, quality_name = item_quality_name:match("^(.-)%|%|(.-)$")
        if data.is_product then
            tag_packages.add(tag_package, get_tag_table({type = data.type, name = item_name, quality_name = quality_name}, data.is_main, player_table))
        end
    end
    return tag_package
end

return assemblers