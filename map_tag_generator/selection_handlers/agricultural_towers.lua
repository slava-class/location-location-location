local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local signals = require("map_tag_generator.signals")

---@type SelectionHandler
local agricultural_towers = {} ---@diagnostic disable-line: missing-fields

---@param agricultural_towers LuaEntity[]
---@return SignalID[]
local function get_yields_from_towers(agricultural_towers)
    local yields = {}

    for _, agricultural_tower in pairs(agricultural_towers) do
        local prototype
        if agricultural_tower.type == "entity-ghost" then
            prototype = agricultural_tower.ghost_prototype
        else
            prototype = agricultural_tower.prototype
        end
        local search_distance = prototype.agricultural_tower_radius * prototype.growth_grid_tile_size

        local plants = agricultural_tower.surface.find_entities_filtered({
            area = {
                {agricultural_tower.selection_box.left_top.x - search_distance, agricultural_tower.selection_box.left_top.y - search_distance},
                {agricultural_tower.selection_box.right_bottom.x + search_distance, agricultural_tower.selection_box.right_bottom.y + search_distance}
            },
            type = "plant",
        })

        for _, plant in pairs(plants) do
            if plant.prototype and plant.prototype.mineable_properties and plant.prototype.mineable_properties.products then
                for _, yield in pairs(plant.prototype.mineable_properties.products) do
                    table.insert(yields, yield)
                end
            end
        end
    end

    return yields
end

---@param agricultural_towers LuaEntity[]
---@param player_table PlayerData
---@return TagTable[]
local function get_tag_tables(agricultural_towers, player_table)
    local tables = {}
    local all_yields = get_yields_from_towers(agricultural_towers)

    if not next(all_yields) then
        for _, agricultural_tower in pairs(agricultural_towers) do
            local entity_name
            if agricultural_tower.type == "entity-ghost" then
                entity_name = agricultural_tower.ghost_name
            else
                entity_name = agricultural_tower.name
            end
            local signal = signals.get_valid_signal({type = "item", name = entity_name}, {type = "item", name = "agricultural-tower"}) --[[@as SignalID]]
            local text
            if player_table.generate_tag_names and player_table.translations[signal.type] then
                text = player_table.translations[signal.type][signal.name]
            end
            table.insert(tables, tag_tables.new({signal = signal, enabled = true, text = text}))
        end

    else
        for _, yield in pairs(all_yields) do
            local signal = signals.get_valid_signal(yield, {type = "item", name = "agricultural-tower"}) --[[@as SignalID]]
            local text
            if player_table.generate_tag_names and player_table.translations[signal.type] then
                text = player_table.translations[signal.type][signal.name]
            end
            table.insert(tables, tag_tables.new({signal = signal, enabled = true, text = text}))
        end
    end

    return tables
end

---@param entities LuaEntity[]
---@param player_table PlayerData
---@return TagPackage
agricultural_towers.get_tag_package = function(entities, player_table)
    local tag_package = tag_packages.new()
    for _, tag_table in pairs(get_tag_tables(entities, player_table)) do
        tag_packages.add(tag_package, tag_table)
    end
    return tag_package
end

return agricultural_towers