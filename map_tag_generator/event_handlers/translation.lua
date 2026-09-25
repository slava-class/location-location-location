local flib_dictionary = require("__flib__.dictionary")

local export = { events = {} }

---@param e EventData.on_player_dictionaries_ready
export.events[flib_dictionary.on_player_dictionaries_ready] = function(e)
    local dicts = flib_dictionary.get_all(e.player_index)
    if dicts then
        storage.player_table[e.player_index].translations = dicts
    end
end

return export
