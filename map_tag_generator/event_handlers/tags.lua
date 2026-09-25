local tag_util = require("map_tag_generator.tags")

local export = { events = {} }

export.events[defines.events.on_chart_tag_removed] = function(e)
    -- remove any invalid tags from each player's table, to help clear up some space
    -- this won't remove the tag that is getting deleted during this event, since the event is called before the tag reference becomes invalid
    -- but it's not that big of a deal
    for _, player in pairs(game.players) do
        tag_util.remove_invalid_tags(storage.player_table[player.index].generated_tags)
    end
end

return export
