local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local signals = require("map_tag_generator.signals")

---@type SelectionHandler
local train_stops = {} ---@diagnostic disable-line: missing-fields

---@param stop LuaEntity
---@return TagTable
local function get_tag_table(stop)
    local entity_name
    if stop.type == "entity-ghost" then
        entity_name = stop.ghost_name
    else
        entity_name = stop.name
    end
    local signal = signals.get_valid_signal({type = "item", name = entity_name}, {type = "item", name = "train-stop"}) --[[@as SignalID]]
    return tag_tables.new({
        train_stop = stop.backer_name,
        signal = signal,
        enabled = true,
        position = stop.position,
        text = stop.backer_name,
    })
end

---@param entities LuaEntity[]
---@param player_table PlayerData
---@return TagPackage
train_stops.get_tag_package = function(entities, player_table)
    local tag_package = tag_packages.new()
    for _, entity in pairs(entities) do
        tag_packages.add(tag_package, get_tag_table(entity))
    end
    return tag_package
end

return train_stops