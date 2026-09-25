local init = require("map_tag_generator.init")
local gui_add_tags = require("map_tag_generator.gui.add_tags")
local gui_delete_tags = require("map_tag_generator.gui.delete_tags")
local translation = require("map_tag_generator.translation")

local export = { events = {} }

export.on_init = function()
    init.initialize_globals()
    for _, player in pairs(game.players) do
        init.initialize_mod_for_player(player)
    end
    translation.init()
end

export.events[defines.events.on_player_created] = function(e)
    local player = game.get_player(e.player_index)
    if player then init.initialize_mod_for_player(player) end
end

export.on_configuration_changed = function(data)
    init.update_compatibility()

    if (data.mod_changes and data.mod_changes["map-tag-generator"]) or data.mod_startup_settings_changed then
        -- update globals
        init.update_globals()

        for _, player in pairs(game.players) do
            -- close any open GUI's
            if storage.player_table[player.index].gui then
                if storage.player_table[player.index].gui.add_tags then
                    gui_add_tags.close_window(player)
                end
                if storage.player_table[player.index].gui.delete_tags then
                    gui_delete_tags.close_window(player)
                end
            end

            -- update per-player data
            init.update_mod_for_player(player)
        end
    end

    translation.handle_configuration_changed()
end

export.events[defines.events.on_runtime_mod_setting_changed] = function(e)
    -- only respond to changes in map-tag-generator-related settings
    if string.find(e.setting, "^map_tag_generator") then
        -- this event can be triggered by a script, in which case e.player_index = nil
        if e.player_index then
            init.get_settings(game.get_player(e.player_index))
        else
            for _, player in pairs(game.players) do
                init.get_settings(player)
            end
        end
    end
end

export.events[defines.events.on_player_removed] = function(e)
    storage.player_table[e.player_index] = nil
end

return export
