local gui_add_tags = require("map_tag_generator.gui.add_tags")
local gui_edit_icon = require("map_tag_generator.gui.edit_icon")
local gui_delete_tags = require("map_tag_generator.gui.delete_tags")
local signals = require("map_tag_generator.signals")

local export = { events = {} }

export.events["map_tag_generator_confirm_gui_linked"] = function(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[player.index]
    local opened = player.opened

    if player_table.gui.add_tags and not player_table.gui.edit_icon and not opened then
        if player_table.gui.add_tags.confirm_button.enabled then
            gui_add_tags.confirm_window(player)
            gui_add_tags.close_window(player)
        end
    elseif opened and player.opened_gui_type == defines.gui_type.custom then
        if player_table.gui.edit_icon and
        opened == player_table.gui.edit_icon.map_tag_generator_edit_icon_window then
            gui_edit_icon.confirm_window(player)

        elseif player_table.gui.delete_tags and
        opened == player_table.gui.delete_tags.map_tag_generator_delete_tags_window then
            gui_delete_tags.confirm_window(player)
        end
    end
end

export.events[defines.events.on_player_cursor_stack_changed] = function(e)
    local player = game.get_player(e.player_index)
    if not player then return end
    local player_table = storage.player_table[player.index]
    if not player_table or not player_table.gui.add_tags or player_table.gui.edit_icon then return end
    local cursor = player.cursor_stack
    if not cursor or not cursor.valid_for_read or cursor.name ~= "map_tag_generator_selection_tool" then
        gui_add_tags.close_window(player)
    end
end

export.events[defines.events.on_player_changed_surface] = function(e)
    local player = game.get_player(e.player_index)
    if not player then return end
    local player_table = storage.player_table[player.index]
    if player_table and player_table.gui.add_tags then gui_add_tags.close_window(player) end
end

---@param e EventData.CustomInputEvent
export.events["map_tag_generator_pipette_linked"] = function(e)
    if not e.in_gui then return end
    local element = e.element
    if not element then return end

    local player = game.get_player(e.player_index)
    if not player then return end

    local prototype
    local quality
    if element.tags.tag_table then
        local signal = element.tags.tag_table.signal --[[@as SignalID]]
        prototype = signals.get_prototype_from_signal(signal)
        quality = signals.get_quality_from_signal(signal)
    elseif element.tags.type == "map_tag_generator_delete_tag_icon_button" then
        local type, name = element.sprite:match("([^/]+)/(.+)")
        if type and name then
            type = type:gsub("-", "_")
            prototype = prototypes[type][name]
            quality = element.quality.name
        end
    end
    if prototype then player.pipette(prototype, quality, true) end
end

return export
