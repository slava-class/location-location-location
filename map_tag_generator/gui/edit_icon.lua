---@diagnostic disable: missing-fields

local gui_util = require("map_tag_generator.gui.util")
local signals = require("map_tag_generator.signals")
local flib_gui = require("__flib__.gui")

local gui_edit_icon = {}

---@param player LuaPlayer
local function update_enabled_states(player)
    local player_table = storage.player_table[player.index]

    -- update enabled state of confirm button
    player_table.gui.edit_icon.confirm_button.enabled = (
        player_table.gui.edit_icon.name_textfield.text ~= ""
        or player_table.gui.edit_icon.choose_icon_button.elem_value ~= nil
    )
end

---@param e EventData.on_gui_closed
local function on_gui_closed(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_edit_icon.close_window(player)
end

---@param e EventData.on_gui_text_changed
local function on_name_textfield_text_changed(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    update_enabled_states(player)
end

---@param e EventData.on_gui_elem_changed
local function on_choose_icon_button_elem_changed(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    update_enabled_states(player)
end

---@param e EventData.on_gui_click
local function on_cancel_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_edit_icon.close_window(player)
end

---@param e EventData.on_gui_click
local function on_confirm_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_edit_icon.confirm_window(player)
    gui_edit_icon.close_window(player)
end

flib_gui.add_handlers({
    edit_icon_on_gui_closed=on_gui_closed,
    edit_icon_on_name_textfield_text_changed=on_name_textfield_text_changed,
    edit_icon_on_choose_icon_button_elem_changed=on_choose_icon_button_elem_changed,
    edit_icon_on_cancel_click=on_cancel_click,
    edit_icon_on_confirm_click=on_confirm_click,
})

---@param player LuaPlayer
gui_edit_icon.build_window = function(player)
    local player_table = storage.player_table[player.index]

    if player_table.gui.edit_icon then return end

    local elems = flib_gui.add(player.gui.screen,
        {
            -- outer window
            type = "frame",
            name = "map_tag_generator_edit_icon_window",
            direction = "vertical",
            handler = { [defines.events.on_gui_closed] = on_gui_closed },
            children = {
                {
                    -- header
                    type = "flow",
                    direction = "horizontal",
                    drag_target = "map_tag_generator_edit_icon_window",
                    children = {
                        {
                            -- window title
                            type = "label",
                            style = "frame_title",
                            caption = {"gui-tag-edit.title-edit"},
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
                    -- inner frame
                    type = "frame",
                    style = "inside_shallow_frame_with_padding",
                    style_mods = {bottom_margin = 8},
                    children = {
                        {
                            -- table
                            type = "table",
                            style = "player_input_table",
                            -- style_mods = {horizontal_spacing = 8, vertical_spacing = 4},
                            column_count = 2,
                            children = {
                                {
                                    -- name label
                                    type = "label",
                                    caption = {"gui-tag-edit.name"},
                                },
                                {
                                    -- name textfield
                                    type = "textfield",
                                    name = "name_textfield",
                                    text = player_table.icon_button_to_edit.tags.tag_table.text,
                                    icon_selector = true,
                                    style_mods = {width = 248},
                                    handler = { [defines.events.on_gui_text_changed] = on_name_textfield_text_changed },
                                },
                                {
                                    -- icon label
                                    type = "label",
                                    caption = {"gui-tag-edit.icon"},
                                },
                                {
                                    -- icon chooser
                                    type = "choose-elem-button",
                                    name = "choose_icon_button",
                                    style = "flib_standalone_slot_button_default",
                                    elem_type = "signal",
                                    signal = player_table.icon_button_to_edit.tags.tag_table.signal,
                                    handler = { [defines.events.on_gui_elem_changed] = on_choose_icon_button_elem_changed },
                                },
                            },
                        },
                    },
                },
                {
                    -- footer
                    type = "flow",
                    direction = "horizontal",
                    drag_target = "map_tag_generator_edit_icon_window",
                    style_mods = {vertical_align = "center"},
                    children = {
                        {
                            -- cancel button
                            type = "button",
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
                            enabled = (
                                player_table.icon_button_to_edit.tags.tag_table.text ~= ""
                                or player_table.icon_button_to_edit.tags.tag_table.signal ~= nil
                            ),
                            handler = { [defines.events.on_gui_click] = on_confirm_click },
                        },
                    },
                },
            },
        }
    )

    player_table.gui.edit_icon = elems

    elems.name_textfield.focus()
    elems.map_tag_generator_edit_icon_window.force_auto_center()

    player.opened = elems.map_tag_generator_edit_icon_window
end

---@param player LuaPlayer
gui_edit_icon.close_window = function(player)
    local player_table = storage.player_table[player.index]

    -- close window
    player_table.gui.edit_icon.map_tag_generator_edit_icon_window.destroy()

    -- re-enable add_tags window
    if player_table.gui.add_tags then
        gui_util.deep_enable(player_table.gui.add_tags.map_tag_generator_add_tags_window)
        player.opened = player_table.gui.add_tags.map_tag_generator_add_tags_window
    end

    -- make button_to_edit visible (only needed if it's a new button, but if it's already visible, this doesn't do any harm)
    player_table.icon_button_to_edit.visible = true

    -- if the icon button does not have an icon or text, it's an invalid tag, so we destroy it
    -- (this should only ever happen if this window was opened to add a new tag and the user didn't provide a name or icon)
    -- (but it's also not bad as a small safety to avoid invalid tags)
    local tags = player_table.icon_button_to_edit.tags
    if tags.tag_table.signal == nil and tags.tag_table.text == "" then
        player_table.icon_button_to_edit.destroy()
        if tags.tag_table.enabled then
            player_table.selected_icon_count = player_table.selected_icon_count - 1
            -- the tag will probably always not be a train-stop tag (because we're only here as the result of manually adding a new tag)
            -- but we should keep the conditional as a safety check / best practice
            if not tags.tag_table.train_stop then
                player_table.selected_icon_count_ex_train = player_table.selected_icon_count_ex_train - 1
            end
        end
    end

    if player_table.gui.add_tags then
        gui_util.update_addtags_enabled_states(player)
    end

    -- remove temp storage
    player_table.gui.edit_icon = nil
    player_table.icon_button_to_edit = nil
end

---@param player LuaPlayer
gui_edit_icon.confirm_window = function(player)
    local player_table = storage.player_table[player.index]

    -- update button if there is an icon or name set
    if player_table.gui.edit_icon.name_textfield.text ~= "" or player_table.gui.edit_icon.choose_icon_button.elem_value ~= nil then
        local tag_table = player_table.icon_button_to_edit.tags.tag_table --[[@as TagTable]]

        tag_table.text = player_table.gui.edit_icon.name_textfield.text --[[@as string]]

        -- update the signal
        -- we need a special case for when the chosen icon was the virtual "?" (signal-unknown)
        -- because for whatever reason the elem_value returns {type = "virtual"} instead of {type = "virtual", name = "signal-unknown"}
        if player_table.gui.edit_icon.choose_icon_button.elem_value ~= nil
        and player_table.gui.edit_icon.choose_icon_button.elem_value.type == "virtual"
        and player_table.gui.edit_icon.choose_icon_button.elem_value.name == nil then
            tag_table.signal = {type = "virtual", name = "signal-unknown"}
        else
            tag_table.signal = player_table.gui.edit_icon.choose_icon_button.elem_value --[[@as SignalID]]
        end
        gui_util.update_tags(player_table.icon_button_to_edit, {tag_table = tag_table})
        player_table.icon_button_to_edit.tooltip = gui_util.icon_button_tooltip_from_table(tag_table)
        player_table.icon_button_to_edit.sprite = signals.get_sprite_from_signal(tag_table.signal, nil) --[[@as string]]
        player_table.icon_button_to_edit.quality = signals.get_quality_from_signal(tag_table.signal, "normal")
    end

    if player_table.gui.add_tags then
        gui_util.update_addtags_enabled_states(player)
        gui_util.update_addtags_preview(player)
    end
end

return gui_edit_icon
