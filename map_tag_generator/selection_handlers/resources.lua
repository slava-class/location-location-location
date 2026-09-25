local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local signals = require("map_tag_generator.signals")

---@type SelectionHandler
local resources = {} ---@diagnostic disable-line: missing-fields

---@param resource LuaEntity
---@param amount number
local function convert_amount_to_yield(resource, amount)
    if not resource.prototype.infinite_resource then return end

    -- formula determined via trial-and-error and some guesswork, hopefully it's correct
    return math.floor(amount / resource.prototype.normal_resource_amount * 100)
end

---@param resource LuaEntity
---@param amount number
---@param amount_is_yield boolean
---@param player_table PlayerData
---@return TagTable
local function get_tag_table(resource, amount, amount_is_yield, player_table)
    local signal

    -- first check for a matching "item" signal
    signal = signals.get_valid_signal({type = "item", name = resource.name}) -- will be nil if no match

    -- then check for a matching "fluid" signal, and if that doesn't match, use default fallback
    if not signal then
        signal = signals.get_valid_signal({type = "fluid", name = resource.name}, {type = "virtual", name = "signal-unknown"})  --[[@as SignalID]]
    end

    -- format amount
    local text = ""
    if amount_is_yield then
        -- infinite resources
        if player_table.generate_tag_names and player_table.translations[signal.type] and player_table.translations["misc"] then
            text = player_table.translations["misc"]["combined_yield"]:gsub("__1__", player_table.translations[signal.type][signal.name]):gsub("__2__", amount)
        else
            text = amount .. "%"
        end
    else
        -- finite resources
        text = tostring(util.format_number(amount, true))
        -- remove any decimals if the number (with units) is at least 10 (check if decimal is at least 3rd character)
        if text:find("%.") and text:find("%.") >= 3 then
            text = text:sub(1, text:find("%.") - 1) .. text:sub(text:len(), text:len())
        end
        if player_table.generate_tag_names and player_table.translations[signal.type] then
            text = player_table.translations[signal.type][signal.name] .. " " .. text
        end
    end
    return tag_tables.new({signal = signal, enabled = true, text = text})
end

---@param entities LuaEntity[]
---@param player_table PlayerData
---@return TagPackage
resources.get_tag_package = function(entities, player_table)
    local tag_package = tag_packages.new()

    ---@type { [string]: [LuaEntity, number] }
    local resource_data = {}
    for _, entity in pairs(entities) do
        if resource_data[entity.name] then
            resource_data[entity.name][2] = resource_data[entity.name][2] + entity.amount
        else
            resource_data[entity.name] = {entity, entity.amount}
        end
    end

    for _, data in pairs(resource_data) do
        local amount_is_yield = false
        if data[1].prototype.infinite_resource then
            data[2] = convert_amount_to_yield(data[1], data[2])
            amount_is_yield = true
        end
        tag_packages.add(tag_package, get_tag_table(data[1], data[2], amount_is_yield, player_table))
    end

    tag_packages.remove_duplicates(tag_package, true)
    return tag_package
end

return resources