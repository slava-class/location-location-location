local mtg_util = require("map_tag_generator.lualib")

local signals = {}

---@type { SignalIDType: { [string]: SignalID } }
local HARDCODES = {
    ["item"] = {
        -- Angel's Infinite Ores
        ["infinite-coal"] = {type = "item", name = "coal"},
        ["infinite-copper-ore"] = {type = "item", name = "copper-ore"},
        ["infinite-iron-ore"] = {type = "item", name = "iron-ore"},
        ["infinite-stone"] = {type = "item", name = "stone"},
        ["infinite-uranium-ore"] = {type = "item", name = "uranium-ore"},
    },
    ["fluid"] = {
        -- Space Age
        ["sulfuric-acid-geyser"] = {type = "fluid", name = "sulfuric-acid"},
        ["fluorine-vent"] = {type = "fluid", name = "fluorine"},

        -- Industrial Revolution 3
        ["steam-fissure"] = {type = "fluid", name = "steam"},
        ["dirty-steam-fissure"] = {type = "fluid", name = "dirty-steam"},
        ["sulphur-gas-fissure"] = {type = "fluid", name = "sulphur-gas"},
        ["natural-gas-fissure"] = {type = "fluid", name = "natural-gas"},
    },
    ["virtual"] = {},
    ["entity"] = {},
    ["recipe"] = {},
    ["space-location"] = {},
    ["asteroid-chunk"] = {},
    ["quality"] = {},
}

---Takes a signal that may or may not exist ingame, and always returns a signal that does exist (so long as a default is provided).
---@param signal SignalID A signal that may or may not exist ingame.
---@param default SignalID? An optional signal that MUST exist as part of vanilla Factorio (or something added by this mod or a dependency).
---@return SignalID? # A hardcoded compatibility value if applicable. Otherwise, `signal` if it exists ingame, and otherwise `default`.
signals.get_valid_signal = function(signal, default)
    if not signal.name then return default end

    if signal.type == nil and HARDCODES["item"][signal.name] then return HARDCODES["item"][signal.name] end
    if HARDCODES[signal.type][signal.name] then return HARDCODES[signal.type][signal.name] end

    if signal.type == "item" or signal.type == nil then
        if prototypes.item[signal.name] then return signal end
    elseif signal.type == "fluid" then
        if prototypes.fluid[signal.name] then return signal end
    elseif signal.type == "virtual" then
        if prototypes.virtual_signal[signal.name] then return signal end
    elseif signal.type == "entity" then
        if prototypes.entity[signal.name] then return signal end
    elseif signal.type == "recipe" then
        if prototypes.recipe[signal.name] then return signal end
    elseif signal.type == "space-location" then
        if prototypes.space_location[signal.name] then return signal end
    elseif signal.type == "asteroid-chunk" then
        if prototypes.asteroid_chunk[signal.name] then return signal end
    elseif signal.type == "quality" then
        if prototypes.quality[signal.name] then return signal end
    end

    return default
end

---Gets the corresponding SpritePath from a given signal.
---@param signal SignalID A signal that may or may not have a related sprite.
---@param default SpritePath? An optional sprite that MUST exist as part of vanilla Factorio (or something added by this mod or a dependency).
---@return SpritePath? # The sprite associated with `signal` if there is one, otherwise `default`.
signals.get_sprite_from_signal = function(signal, default)
    if signal == nil then return default end

    -- sometimes signal is not nil but doesn't have a name
    -- only case I've seen is for ? tags (unknown signals)
    if signal.name == nil then
        signal = {type = "virtual", name = "signal-unknown"}
    end

    local sprite
    if signal.type == "item" or signal.type == nil then
        sprite = mtg_util.get_sprite("item/"..signal.name)
    elseif signal.type == "fluid" then
        sprite = mtg_util.get_sprite("fluid/"..signal.name)
    elseif signal.type == "virtual" then
        sprite = mtg_util.get_sprite("virtual-signal/"..signal.name)
    elseif signal.type == "entity" then
        sprite = mtg_util.get_sprite("entity/"..signal.name)
    elseif signal.type == "recipe" then
        sprite = mtg_util.get_sprite("recipe/"..signal.name)
    elseif signal.type == "space-location" then
        sprite = mtg_util.get_sprite("space-location/"..signal.name)
    elseif signal.type == "asteroid-chunk" then
        sprite = mtg_util.get_sprite("asteroid-chunk/"..signal.name)
    elseif signal.type == "quality" then
        sprite = mtg_util.get_sprite("quality/"..signal.name)
    end

    if sprite ~= nil then
        return sprite
    else
        return default
    end
end

---Gets the corresponding prototype from a given signal.
---@param signal SignalID
---@return PipetteID? # The prototype associated with `signal` if there is one, otherwise `nil`.
signals.get_prototype_from_signal = function(signal)
    if signal == nil then return end

    -- sometimes signal is not nil but doesn't have a name
    -- only case I've seen is for ? tags (unknown signals)
    if signal.name == nil then
        signal = {type = "virtual", name = "signal-unknown"}
    end

    if signal.type == "item" or signal.type == nil then
        return prototypes.item[signal.name]
    elseif signal.type == "fluid" then
        return prototypes.fluid[signal.name]
    elseif signal.type == "virtual" then
        return prototypes.virtual_signal[signal.name]
    elseif signal.type == "entity" then
        return prototypes.entity[signal.name]
    elseif signal.type == "recipe" then
        return prototypes.recipe[signal.name]
    elseif signal.type == "space-location" then
        return prototypes.space_location[signal.name]
    elseif signal.type == "asteroid-chunk" then
        return prototypes.asteroid_chunk[signal.name]
    elseif signal.type == "quality" then
        return prototypes.quality[signal.name]
    end
end

---Gets the corresponding quality name from a given signal.
---@param signal SignalID A signal that may or may not have a related quality.
---@param default string? An optional quality name that MUST exist as part of vanilla Factorio (or something added by this mod or a dependency).
---@return string? # The quality name associated with `signal` if there is one, otherwise `default`.
signals.get_quality_from_signal = function(signal, default)
    if signal == nil then return default end
    if not signal.quality then return "normal" end

    -- apparently signal.quality can be either a LuaQualityPrototype or a string (just the quality name)
    if signal.quality.name then return signal.quality.name end
    return signal.quality --[[@as string]]
end

return signals