local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local signals = require("map_tag_generator.signals")

---@type SelectionHandler
local labs = {} ---@diagnostic disable-line: missing-fields

---@param lab LuaEntity
---@param player_table PlayerData
---@return TagTable
local function get_tag_table(lab, player_table)
    local entity_name
    if lab.type == "entity-ghost" then
        entity_name = lab.ghost_name
    else
        entity_name = lab.name
    end
    local signal = signals.get_valid_signal({type = "item", name = entity_name}, {type = "item", name = "lab"}) --[[@as SignalID]]
    local text
    if player_table.generate_tag_names and player_table.translations[signal.type] then
        text = player_table.translations[signal.type][signal.name]
    end
    return tag_tables.new({signal = signal, enabled = true, text = text})
end

---@param entities LuaEntity[]
---@param player_table PlayerData
---@return TagPackage
labs.get_tag_package = function(entities, player_table)
    local tag_package = tag_packages.new()
    for _, entity in pairs(entities) do
        tag_packages.add(tag_package, get_tag_table(entity, player_table))
    end
    return tag_package
end

return labs