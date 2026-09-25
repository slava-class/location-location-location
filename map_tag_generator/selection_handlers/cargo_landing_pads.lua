local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local signals = require("map_tag_generator.signals")

---@type SelectionHandler
local cargo_landing_pads = {} ---@diagnostic disable-line: missing-fields

---@param cargo_landing_pad LuaEntity
---@param player_table PlayerData
---@return TagTable
local function get_tag_table(cargo_landing_pad, player_table)
    local entity_name
    if cargo_landing_pad.type == "entity-ghost" then
        entity_name = cargo_landing_pad.ghost_name
    else
        entity_name = cargo_landing_pad.name
    end
    local signal = signals.get_valid_signal({type = "item", name = entity_name}, {type = "item", name = "cargo-landing-pad"}) --[[@as SignalID]]
    local text
    if player_table.generate_tag_names and player_table.translations[signal.type] then
        text = player_table.translations[signal.type][signal.name]
    end
    return tag_tables.new({signal = signal, enabled = true, text = text})
end

---@param entities LuaEntity[]
---@param player_table PlayerData
---@return TagPackage
cargo_landing_pads.get_tag_package = function(entities, player_table)
    local tag_package = tag_packages.new()
    for _, entity in pairs(entities) do
        tag_packages.add(tag_package, get_tag_table(entity, player_table))
    end
    return tag_package
end

return cargo_landing_pads