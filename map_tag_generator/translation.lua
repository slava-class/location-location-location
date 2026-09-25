local flib_dictionary = require("__flib__.dictionary")

---@alias TranslationData { [string]: TranslatedDictionary }

local translation = {}

local function build_dictionaries()
    for type, prototypes in pairs({
        item = prototypes.item,
        fluid = prototypes.fluid,
        virtual_signal = prototypes.virtual_signal,
    }) do
        flib_dictionary.new(type)
        for name, prototype in pairs(prototypes) do
            flib_dictionary.add(type, name, { "?", prototype.localised_name, name })
        end
    end
    flib_dictionary.new("misc")
    flib_dictionary.add("misc", "combined_yield", { "map-info-combined-yield-percentage" })
end

translation.init = function()
    flib_dictionary.on_init()
    build_dictionaries()
end

translation.handle_configuration_changed = function()
    flib_dictionary.on_configuration_changed()
    build_dictionaries()
end

return translation
