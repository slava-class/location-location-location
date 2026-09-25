local flib_gui = require("__flib__.gui")
local mod_gui = require("mod-gui")

local gui_modgui = {}

---@param e EventData.on_gui_click
local function mod_gui_on_spawn_selection_tool_button_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    if player.clear_cursor() then
        player.cursor_stack.set_stack({name = "map_tag_generator_selection_tool"})
    end
end

flib_gui.add_handlers({
    mod_gui_on_spawn_selection_tool_button_click=mod_gui_on_spawn_selection_tool_button_click,
})

---@param player LuaPlayer
gui_modgui.init = function(player)
    local player_table = storage.player_table[player.index]

    if not player_table.gui.mod_gui then
        player_table.gui.mod_gui = {}
    end

    if not player_table.gui.mod_gui.spawn_tool_button then
        local _, first = flib_gui.add(mod_gui.get_button_flow(player),
            {
                type = "sprite-button",
                sprite = "map_tag_generator_tag_icon",
                tooltip = { "map-tag-generator-mod-gui.spawn_selection_tool_tooltip" },
                style = mod_gui.button_style,
                mouse_button_filter = {"left"},
                handler = { [defines.events.on_gui_click] = mod_gui_on_spawn_selection_tool_button_click, },
                visible = player_table.show_spawn_tool_button,
            }
        )
        player_table.gui.mod_gui.spawn_tool_button = first
    end
end

---@param player LuaPlayer
gui_modgui.set_visibility = function(player)
    local player_table = storage.player_table[player.index]

    if player_table.gui.mod_gui and player_table.gui.mod_gui.spawn_tool_button and player_table.gui.mod_gui.spawn_tool_button.valid then
        player_table.gui.mod_gui.spawn_tool_button.visible = player_table.show_spawn_tool_button
    end
end

return gui_modgui
