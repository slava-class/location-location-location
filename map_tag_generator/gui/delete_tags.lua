---@diagnostic disable: missing-fields

local gui_util = require("map_tag_generator.gui.util")
local mtg = require("map_tag_generator.constants")
local flib_gui = require("__flib__.gui")

local gui_delete_tags = {}

---@param player LuaPlayer
local function update_toggle_all_button(player)
    local player_table = storage.player_table[player.index]
    local button = player_table.gui.delete_tags.toggle_all_button

    -- if all tags are selected, set the button to "deselect all"
    -- otherwise, set it to "select all"
    -- need to ignore non-deletable tags in the count
    local tag_count = table_size(player_table.gui.delete_tags.icon_button_table.children)
    for _, button in pairs(player_table.gui.delete_tags.icon_button_table.children) do
        if not button.tags.can_toggle then
            tag_count = tag_count - 1
        end
    end
    if player_table.tags_to_delete_count == tag_count then
        button.sprite = "map_tag_generator_deselect_all"
        button.tooltip = {"map-tag-generator-delete-tags-gui.deselect_all"}
        player_table.toggle_all_mode = mtg.toggle_all_modes.deselect
    else
        button.sprite = "map_tag_generator_select_all"
        button.tooltip = {"map-tag-generator-delete-tags-gui.select_all"}
        player_table.toggle_all_mode = mtg.toggle_all_modes.select
    end
end

---@param player LuaPlayer
---@param button LuaGuiElement
---@param set_selected boolean
local function set_tag_button_selected_state(player, button, set_selected)
    local player_table = storage.player_table[player.index]

    if button.tags.can_toggle then -- must be able to toggle this button
        -- deselect a selected button
        if not set_selected and button.tags.selected then
            player_table.tags_to_delete_count = player_table.tags_to_delete_count - 1
            gui_util.update_tags(button, {selected = false})
            button.style = "flib_slot_button_default"
        -- select a deselected button
        elseif set_selected and not button.tags.selected then
            player_table.tags_to_delete_count = player_table.tags_to_delete_count + 1
            gui_util.update_tags(button, {selected = true})
            button.style = "flib_selected_slot_button_green"
        end
    end
end

---@param e EventData.on_gui_closed
local function on_gui_closed(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_delete_tags.close_window(player)
end

---@param e EventData.on_gui_click
local function on_toggle_all_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[e.player_index]

    if player_table.toggle_all_mode == mtg.toggle_all_modes.select then
        for _, button in pairs(player_table.gui.delete_tags.icon_button_table.children) do
            set_tag_button_selected_state(player, button, true)
        end
    elseif player_table.toggle_all_mode == mtg.toggle_all_modes.deselect then
        for _, button in pairs(player_table.gui.delete_tags.icon_button_table.children) do
            set_tag_button_selected_state(player, button, false)
        end
    end
    gui_delete_tags.update_enabled_states(player)
    update_toggle_all_button(player)
end

---@param e EventData.on_gui_click
local function on_icon_button_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[e.player_index]
    local element = e.element

    if e.button == defines.mouse_button_type.left then
        -- toggle icon
        set_tag_button_selected_state(player, element, not element.tags.selected)

        gui_delete_tags.update_enabled_states(player)
        update_toggle_all_button(player)
    end
end

---@param e EventData.on_gui_click
local function on_cancel_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_delete_tags.close_window(player)
end

---@param e EventData.on_gui_click
local function on_confirm_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_delete_tags.confirm_window(player)
    gui_delete_tags.close_window(player)
end

flib_gui.add_handlers({
    delete_tags_on_gui_closed=on_gui_closed,
    delete_tags_on_toggle_all_click=on_toggle_all_click,
    delete_tags_on_icon_button_click=on_icon_button_click,
    delete_tags_on_cancel_click=on_cancel_click,
    delete_tags_on_confirm_click=on_confirm_click,
})

---@param player LuaPlayer
gui_delete_tags.build_window = function(player)
    local player_table = storage.player_table[player.index]

    if player_table.gui.delete_tags then return end

    -- initialize temp variables
    player_table.tags_to_delete_count = 0 -- how many icon buttons are currently selected

    local elems = flib_gui.add(player.gui.screen,
        {
            -- outer window
            type = "frame",
            name = "map_tag_generator_delete_tags_window",
            direction = "vertical",
            handler = { [defines.events.on_gui_closed] = on_gui_closed, },
            children = {
                {
                    -- header
                    type = "flow",
                    direction = "horizontal",
                    drag_target = "map_tag_generator_delete_tags_window",
                    children = {
                        {
                            -- window title
                            type = "label",
                            style = "frame_title",
                            caption = {"map-tag-generator-delete-tags-gui.title"},
                            ignored_by_interaction = true,
                        },
                        {
                            -- drag bars
                            type = "empty-widget",
                            style = "flib_titlebar_drag_handle",
                            ignored_by_interaction = true,
                        },
                    },
                },
                {
                    -- flow for the tag settings
                    type = "flow",
                    direction = "horizontal",
                    style_mods = {bottom_margin = 8, horizontal_spacing = 12},
                    children = {
                        {
                            -- select icons frame
                            type = "frame",
                            direction = "vertical",
                            style = "inside_shallow_frame",
                            style_mods = {horizontally_stretchable = true, vertically_stretchable = true},
                            children = {
                                {
                                    -- select icons subheader
                                    type = "frame",
                                    style = "subheader_frame",
                                    style_mods = {horizontally_stretchable = true, height = 36},
                                    children = {
                                        {
                                            -- select icons title
                                            type = "label",
                                            style = "subheader_caption_label",
                                            caption = {"map-tag-generator-delete-tags-gui.icon_subheader_title"},
                                        },
                                        {
                                            -- spacer
                                            type = "empty-widget",
                                            style = "flib_horizontal_pusher",
                                        },
                                        {
                                            -- toggle all button
                                            type = "sprite-button",
                                            name = "toggle_all_button",
                                            style = "tool_button",
                                            style_mods = {top_margin = 1}, -- makes the button look a bit more vertically centered
                                            sprite = "map_tag_generator_select_all",
                                            tooltip = {"map-tag-generator-delete-tags-gui.select_all"},
                                            size = 28,
                                            handler = { [defines.events.on_gui_click] = on_toggle_all_click },
                                        },
                                    },
                                },
                                {
                                    -- icon buttons frame
                                    type = "frame",
                                    style = "slot_button_deep_frame",
                                    style_mods = {margin = 12},
                                    children = {
                                        {
                                            -- icon buttons scroll pane
                                            type = "scroll-pane",
                                            style = "flib_naked_scroll_pane",
                                            elem_mods = {horizontal_scroll_policy = "never", vertical_scroll_policy = "always"},
                                            -- one slot button is 40x40, scroll bar adds an extra 12 to width
                                            style_mods = {width = 40*6 + 12, height = 40*5, padding = 0},
                                            children = {
                                                {
                                                    -- icon buttons table
                                                    type = "table",
                                                    name = "icon_button_table",
                                                    column_count = 6,
                                                    style_mods = {horizontal_spacing = 0, vertical_spacing = 0},
                                                    -- icon buttons
                                                    children = gui_util.tag_buttons_from_array(player_table.tags_selected_for_deletion, player_table, on_icon_button_click),
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    -- footer
                    type = "flow",
                    direction = "horizontal",
                    drag_target = "map_tag_generator_delete_tags_window",
                    style_mods = {vertical_align = "center"},
                    children = {
                        {
                            -- cancel button
                            type = "button",
                            name = "cancel_button",
                            style = "back_button",
                            caption = {"gui-mod-settings.cancel"}, -- gui-tag-edit.confirm was removed but this is close enough
                            handler = { [defines.events.on_gui_click] = on_cancel_click },
                        },
                        {
                            -- drag bars
                            type = "empty-widget",
                            style = "flib_dialog_footer_drag_handle",
                            ignored_by_interaction = true,
                        },
                        {
                            -- confirm button
                            type = "button",
                            name = "confirm_button",
                            style = "confirm_button",
                            caption = {"gui-tag-edit.confirm"},
                            enabled = (player_table.tags_to_delete_count > 0),
                            handler = { [defines.events.on_gui_click] = on_confirm_click },
                        },
                    },
                },
            },
        }
    )

    player_table.gui.delete_tags = elems

    elems.map_tag_generator_delete_tags_window.force_auto_center()
    update_toggle_all_button(player)

    player.opened = elems.map_tag_generator_delete_tags_window
end

---@param player LuaPlayer
gui_delete_tags.close_window = function(player)
    local player_table = storage.player_table[player.index]

    -- close window
    player_table.gui.delete_tags.map_tag_generator_delete_tags_window.destroy()

    -- remove temp storage
    player_table.gui.delete_tags = nil
    player_table.tags_to_delete_count = nil
end

---@param player LuaPlayer
gui_delete_tags.confirm_window = function(player)
    local player_table = storage.player_table[player.index]

    if player_table.tags_to_delete_count > 0 then
        -- delete selected tags
        for _, icon_button in pairs(player_table.gui.delete_tags.icon_button_table.children) do
            if icon_button.tags.selected then
                local tag_to_delete = player_table.tags_selected_for_deletion[icon_button.tags.index]
                if tag_to_delete.valid then
                    tag_to_delete.destroy()
                end
            end
        end
    end
end

---@param player LuaPlayer
gui_delete_tags.update_enabled_states = function(player)
    local player_table = storage.player_table[player.index]

    -- update enabled state of confirm button
    player_table.gui.delete_tags.confirm_button.enabled = (player_table.tags_to_delete_count > 0)
end

return gui_delete_tags
