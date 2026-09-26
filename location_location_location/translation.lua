local dictionary = require("__flib__.dictionary")
local gui = require("location_location_location.gui.planner")

local function build()
    for _, kind in ipairs({"recipe", "item", "fluid"}) do
        dictionary.new(kind)
        for name, prototype in pairs(prototypes[kind]) do dictionary.add(kind, name, prototype.localised_name) end
    end
end

return {
    on_init = build,
    on_configuration_changed = build,
    events = {
        [dictionary.on_player_dictionaries_ready] = function(e)
            local player = game.get_player(e.player_index)
            if player then gui.refresh_picker(player) end
        end,
    },
}
