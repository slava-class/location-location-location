---@diagnostic disable: missing-fields

local gui_edit_icon = require("map_tag_generator.gui.edit_icon")
local gui_util = require("map_tag_generator.gui.util")
local tag_packages = require("map_tag_generator.structs.tag_package")
local tag_tables = require("map_tag_generator.structs.tag_table")
local mtg = require("map_tag_generator.constants")
local positions = require("map_tag_generator.positions")
local flib_gui = require("__flib__.gui")
local signals = require("map_tag_generator.signals")
local util = require("__core__.lualib.util")

local gui_add_tags = {}

---@param player LuaPlayer
local function update_toggle_all_button(player)
    local player_table = storage.player_table[player.index]
    local button = player_table.gui.add_tags.toggle_all_button

    -- if all tags are selected, set the button to "deselect all"
    -- otherwise, set it to "select all"
    local tag_count = table_size(player_table.gui.add_tags.icon_button_table.children)
    if player_table.selected_icon_count == tag_count then
        button.sprite = "map_tag_generator_deselect_all"
        button.tooltip = {"map-tag-generator-add-tags-gui.deselect_all"}
        player_table.toggle_all_mode = mtg.toggle_all_modes.deselect
    else
        button.sprite = "map_tag_generator_select_all"
        button.tooltip = {"map-tag-generator-add-tags-gui.select_all"}
        player_table.toggle_all_mode = mtg.toggle_all_modes.select
    end
end

---@param player LuaPlayer
---@param button LuaGuiElement
---@param set_enabled boolean
local function set_tag_button_enabled_state(player, button, set_enabled)
    local player_table = storage.player_table[player.index]
    local tag_table = button.tags.tag_table

    if tag_table ~= nil then
        -- disable an enabled button
        if not set_enabled and tag_table.enabled then
            player_table.selected_icon_count = player_table.selected_icon_count - 1
            if not tag_table.train_stop then
                player_table.selected_icon_count_ex_train = player_table.selected_icon_count_ex_train - 1
            end
            tag_table.enabled = false
            gui_util.update_tags(button, {tag_table = tag_table})
            button.style = "flib_slot_button_default"
        -- enable a disabled button
        elseif set_enabled and not tag_table.enabled then
            player_table.selected_icon_count = player_table.selected_icon_count + 1
            if not tag_table.train_stop then
                player_table.selected_icon_count_ex_train = player_table.selected_icon_count_ex_train + 1
            end
            tag_table.enabled = true
            gui_util.update_tags(button, {tag_table = tag_table})
            button.style = "flib_selected_slot_button_green"
        end
    end
end

---@param player LuaPlayer
local function disable_window(player)
    local player_table = storage.player_table[player.index]

    -- disable this window
    gui_util.deep_disable(player_table.gui.add_tags.inner_flow)
    player_table.gui.add_tags.cancel_button.enabled = false
    player_table.gui.add_tags.confirm_button.enabled = false
end

---@param e EventData.on_gui_click
local function on_icon_button_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[e.player_index]
    local element = e.element

    if player_table.is_reordering_tags then
        -- reordering tags behavior
        if player_table.index_of_tag_to_reorder then
            -- tag to reorder has already been selected, now we're choosing where to put it
            local source_index = player_table.index_of_tag_to_reorder --[[@as integer]]
            local destination_index = element.get_index_in_parent()

            if source_index < destination_index then
                for i = source_index, destination_index - 1 do
                    player_table.gui.add_tags.icon_button_table.swap_children(i, i + 1)
                end
            elseif source_index > destination_index then
                for i = source_index, destination_index + 1, -1 do
                    player_table.gui.add_tags.icon_button_table.swap_children(i, i - 1)
                end
            end

            player_table.index_of_tag_to_reorder = nil
            for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
                button.style = "flib_slot_button_grey"
                button.tooltip = {"map-tag-generator-add-tags-gui.reorder_tag"}
            end
        else
            -- selecting a tag to reorder
            element.style = "flib_selected_slot_button_default"
            player_table.index_of_tag_to_reorder = element.get_index_in_parent()
            for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
                button.tooltip = {"map-tag-generator-add-tags-gui.reorder_tag_destination"}
            end
        end
    else
        -- normal behavior
        if e.button == defines.mouse_button_type.left then
            -- toggle icon
            local tag_table = element.tags.tag_table
            set_tag_button_enabled_state(player, element, not tag_table.enabled)

            gui_util.update_addtags_enabled_states(player)
            update_toggle_all_button(player)

        elseif e.button == defines.mouse_button_type.right then
            disable_window(player)

            -- edit icon
            player_table.icon_button_to_edit = element
            gui_edit_icon.build_window(player)
        end
    end

    gui_util.update_addtags_preview(player)
end

---@param e EventData.on_gui_click
local function on_add_icon_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[e.player_index]

    -- create new tag_table and add a new button (invisible at first, to make it look like confirming the edit_icon window is what creates the button)
    local tag_table = tag_tables.new({enabled = true})
    local button_table = gui_util.icon_button_from_table(tag_table, player_table, on_icon_button_click)
    button_table.visible = false
    local _, new_button = flib_gui.add(player_table.gui.add_tags.icon_button_table, button_table)
    gui_util.update_addtags_enabled_states(player)

    -- open the editor window
    disable_window(player)
    player_table.icon_button_to_edit = new_button
    gui_edit_icon.build_window(player)
end

---@param e EventData.on_gui_click
local function on_reorder_tags_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[e.player_index]

    if player_table.is_reordering_tags then
        -- currently reordering tags, so disable that behavior
        player_table.is_reordering_tags = false
        player_table.gui.add_tags.reorder_tags_button.toggled = false
        player_table.gui.add_tags.reorder_tags_button.tooltip = {"map-tag-generator-add-tags-gui.start_reordering_tags"}
        for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
            local tag_table = button.tags.tag_table --[[@as TagTable]]
            if tag_table.enabled then
                button.style = "flib_selected_slot_button_green"
            else
                button.style = "flib_slot_button_default"
            end
            button.tooltip = gui_util.icon_button_tooltip_from_table(tag_table)
        end
        player_table.gui.add_tags.add_icon_button.enabled = true
        player_table.gui.add_tags.toggle_all_button.enabled = true
        update_toggle_all_button(player)
        gui_util.update_addtags_enabled_states(player)
    else
        -- not currently reordering tags, so enable that behavior
        player_table.is_reordering_tags = true
        player_table.gui.add_tags.reorder_tags_button.toggled = true
        player_table.gui.add_tags.reorder_tags_button.tooltip = {"map-tag-generator-add-tags-gui.stop_reordering_tags"}
        for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
            button.style = "flib_slot_button_grey"
            button.tooltip = {"map-tag-generator-add-tags-gui.reorder_tag"}
        end
        player_table.gui.add_tags.add_icon_button.enabled = false
        player_table.gui.add_tags.toggle_all_button.enabled = false
    end
end

---@param e EventData.on_gui_click
local function on_toggle_all_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    local player_table = storage.player_table[e.player_index]

    if player_table.toggle_all_mode == mtg.toggle_all_modes.select then
        for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
            set_tag_button_enabled_state(player, button, true)
        end
    elseif player_table.toggle_all_mode == mtg.toggle_all_modes.deselect then
        for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
            set_tag_button_enabled_state(player, button, false)
        end
    end
    gui_util.update_addtags_enabled_states(player)
    update_toggle_all_button(player)
    gui_util.update_addtags_preview(player)
end

local on_position_choice_checked_state_changed = {}
for _, position_style in pairs(mtg.position_styles) do
    ---@param e EventData.on_gui_checked_state_changed
    on_position_choice_checked_state_changed[position_style] = function(e)
        local player = game.get_player(e.player_index)
        if player == nil then return end
        local player_table = storage.player_table[e.player_index]

        player_table.position_style_temp = position_style
        for _, _position_style in pairs(mtg.position_styles) do
            player_table.gui.add_tags["position_choice_" .. _position_style].state = (player_table.position_style_temp == _position_style)
        end
        gui_util.update_addtags_preview(player)
    end
end

local on_layout_choice_checked_state_changed = {}
for _, layout_style in pairs(mtg.layout_styles) do
    ---@param e EventData.on_gui_checked_state_changed
    on_layout_choice_checked_state_changed[layout_style] = function(e)
        local player = game.get_player(e.player_index)
        if player == nil then return end
        local player_table = storage.player_table[e.player_index]

        player_table.layout_style_temp = layout_style
        for _, _layout_style in pairs(mtg.layout_styles) do
            player_table.gui.add_tags["layout_choice_" .. _layout_style].state = (player_table.layout_style_temp == _layout_style)
        end
        gui_util.update_addtags_preview(player)
    end
end

---@param e EventData.on_gui_click
local function on_cancel_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_add_tags.close_window(player)
end

---@param e EventData.on_gui_click
local function on_confirm_click(e)
    local player = game.get_player(e.player_index)
    if player == nil then return end
    gui_add_tags.confirm_window(player)
    gui_add_tags.close_window(player)
end

flib_gui.add_handlers({
    add_tags_on_add_icon_click=on_add_icon_click,
    add_tags_on_reorder_tags_click=on_reorder_tags_click,
    add_tags_on_toggle_all_click=on_toggle_all_click,
    add_tags_on_icon_button_click=on_icon_button_click,
    add_tags_on_position_choice_checked_state_changed_middle=on_position_choice_checked_state_changed[mtg.position_styles.middle_of_entities],
    add_tags_on_position_choice_checked_state_changed_average=on_position_choice_checked_state_changed[mtg.position_styles.average_of_entities],
    add_tags_on_position_choice_checked_state_changed_center=on_position_choice_checked_state_changed[mtg.position_styles.center_of_selection],
    add_tags_on_layout_choice_checked_state_changed_horizontal=on_layout_choice_checked_state_changed[mtg.layout_styles.horizontal],
    add_tags_on_layout_choice_checked_state_changed_vertical=on_layout_choice_checked_state_changed[mtg.layout_styles.vertical],
    add_tags_on_layout_choice_checked_state_changed_square=on_layout_choice_checked_state_changed[mtg.layout_styles.square],
    add_tags_on_cancel_click=on_cancel_click,
    add_tags_on_confirm_click=on_confirm_click,
})

local function source_key(tag)
    local signal = tag.signal or {}
    return (tag.source_category or "")..":"..(signal.type or "item")..":"..(signal.name or "")..":"
        ..signals.get_quality_from_signal(signal, "normal")..":"..tostring(tag.train_stop or "")
        ..":"..tag.position.x..":"..tag.position.y
end

---@param player LuaPlayer
local function refresh_window(player)
    local player_table = storage.player_table[player.index]
    local generated = {}
    for _, tag in pairs(player_table.current_tag_package.tag_tables) do
        generated[source_key(tag)] = tag
    end

    local buttons = player_table.gui.add_tags.icon_button_table
    local entries = {}
    for _, button in ipairs(buttons.children) do
        local tags = button.tags
        if tags.source_tag then
            local key = source_key(tags.source_tag)
            local tag = generated[key]
            if tag then
                local original = util.copy(tag)
                tag.enabled = tags.tag_table.enabled
                if tags.tag_table.text ~= tags.source_tag.text then tag.text = tags.tag_table.text end
                if source_key(tags.tag_table) ~= key then tag.signal = tags.tag_table.signal end
                table.insert(entries, {tag_table = tag, source_tag = original})
                generated[key] = nil
            end
        else
            -- Manually added tags are independent of the entity selection.
            table.insert(entries, tags)
        end
    end
    for _, tag in pairs(generated) do
        table.insert(entries, {tag_table = tag, source_tag = util.copy(tag)})
    end

    if player_table.is_reordering_tags then on_reorder_tags_click({player_index = player.index}) end
    buttons.clear()
    player_table.selected_icon_count = 0
    player_table.selected_icon_count_ex_train = 0
    for _, entry in ipairs(entries) do
        local button = gui_util.icon_button_from_table(entry.tag_table, player_table, on_icon_button_click)
        button.tags.source_tag = entry.source_tag
        flib_gui.add(buttons, button)
    end
    update_toggle_all_button(player)
    gui_util.update_addtags_enabled_states(player)
    gui_util.update_addtags_preview(player)
end

---@param player LuaPlayer
function gui_add_tags.build_window(player)
    local player_table = storage.player_table[player.index]

    if player_table.gui.add_tags then
        refresh_window(player)
        return
    end

    -- initialize temp variables
    player_table.position_style_temp = next(player_table.matching_entities) and player_table.position_style or mtg.position_styles.center_of_selection -- if no matching entities were selected, can only use center-of-selection
    player_table.layout_style_temp = player_table.layout_style
    player_table.selected_icon_count = 0 -- how many icon buttons are currently selected
    player_table.selected_icon_count_ex_train = 0 -- how many non-train-stop icon buttons are currently selected

    local elems = flib_gui.add(player.gui.screen,
        {
            -- outer window
            type = "frame",
            name = "map_tag_generator_add_tags_window",
            direction = "vertical",
            children = {
                {
                    -- header
                    type = "flow",
                    direction = "horizontal",
                    drag_target = "map_tag_generator_add_tags_window",
                    children = {
                        {
                            -- window title
                            type = "label",
                            style = "frame_title",
                            caption = {"map-tag-generator-add-tags-gui.title"},
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
                    name = "inner_flow",
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
                                            caption = {"map-tag-generator-add-tags-gui.icon_subheader_title"},
                                        },
                                        {
                                            -- spacer
                                            type = "empty-widget",
                                            style = "flib_horizontal_pusher",
                                        },
                                        {
                                            -- add icon button
                                            type = "sprite-button",
                                            name = "add_icon_button",
                                            style = "tool_button",
                                            style_mods = {top_margin = 1}, -- makes the button look a bit more vertically centered
                                            sprite = "utility/add",
                                            tooltip = {"map-tag-generator-add-tags-gui.add_icon"},
                                            size = 28,
                                            handler = { [defines.events.on_gui_click] = on_add_icon_click },
                                        },
                                        {
                                            -- reorder tags button
                                            type = "sprite-button",
                                            name = "reorder_tags_button",
                                            style = "tool_button",
                                            style_mods = {top_margin = 1}, -- makes the button look a bit more vertically centered
                                            sprite = "map_tag_generator_reorder_tags",
                                            tooltip = {"map-tag-generator-add-tags-gui.start_reordering_tags"},
                                            size = 28,
                                            handler = { [defines.events.on_gui_click] = on_reorder_tags_click },
                                        },
                                        {
                                            -- toggle all button
                                            type = "sprite-button",
                                            name = "toggle_all_button",
                                            style = "tool_button",
                                            style_mods = {top_margin = 1}, -- makes the button look a bit more vertically centered
                                            sprite = "map_tag_generator_select_all",
                                            tooltip = {"map-tag-generator-add-tags-gui.select_all"},
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
                                            style_mods = {width = 40*5 + 12, height = 40*5, padding = 0},
                                            children = {
                                                {
                                                    -- icon buttons table
                                                    type = "table",
                                                    name = "icon_button_table",
                                                    column_count = 5,
                                                    style_mods = {horizontal_spacing = 0, vertical_spacing = 0},
                                                    -- icon buttons
                                                    children = gui_util.icon_buttons_from_package(player_table.current_tag_package, player_table, on_icon_button_click),
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        {
                            -- flow for position/layout setting frames
                            type = "flow",
                            direction = "vertical",
                            style_mods = {vertical_spacing = 12, horizontally_stretchable = false},
                            children = {
                                {
                                    -- select position frame
                                    type = "frame",
                                    direction = "vertical",
                                    style = "inside_shallow_frame",
                                    style_mods = {vertically_stretchable = true},
                                    children = {
                                        {
                                            -- select position subheader
                                            type = "frame",
                                            style = "subheader_frame",
                                            style_mods = {horizontally_stretchable = true, height = 36},
                                            children = {
                                                {
                                                    -- select position title
                                                    type = "label",
                                                    style = "subheader_caption_label",
                                                    caption = {"map-tag-generator-add-tags-gui.position_subheader_title"},
                                                },
                                            },
                                        },
                                        {
                                            -- position radiobuttons flow
                                            type = "flow",
                                            direction = "vertical",
                                            style_mods = {padding = 12, vertical_spacing = 0},
                                            children = {
                                                {
                                                    -- position radiobutton: middle of entities
                                                    type = "radiobutton",
                                                    name = "position_choice_" .. mtg.position_styles.middle_of_entities,
                                                    caption = {"", {"string-mod-setting.map_tag_generator_position_style-map_tag_generator_middle_of_entities"}, " [img=info]"},
                                                    tooltip = (next(player_table.matching_entities) ~= nil) and {"map-tag-generator-add-tags-gui.layout_middle_of_entities"} or {"map-tag-generator-add-tags-gui.no_entities_found"},
                                                    state = (player_table.position_style_temp == mtg.position_styles.middle_of_entities),
                                                    handler = { [defines.events.on_gui_checked_state_changed] = on_position_choice_checked_state_changed[mtg.position_styles.middle_of_entities], },
                                                },
                                                {
                                                    -- position radiobutton: average of entities
                                                    type = "radiobutton",
                                                    name = "position_choice_" .. mtg.position_styles.average_of_entities,
                                                    caption = {"", {"string-mod-setting.map_tag_generator_position_style-map_tag_generator_average_of_entities"}, " [img=info]"},
                                                    tooltip = (next(player_table.matching_entities) ~= nil) and {"map-tag-generator-add-tags-gui.layout_average_of_entities"} or {"map-tag-generator-add-tags-gui.no_entities_found"},
                                                    state = (player_table.position_style_temp == mtg.position_styles.average_of_entities),
                                                    handler = { [defines.events.on_gui_checked_state_changed] = on_position_choice_checked_state_changed[mtg.position_styles.average_of_entities], },
                                                },
                                                {
                                                    -- position radiobutton: center of selection
                                                    type = "radiobutton",
                                                    name = "position_choice_" .. mtg.position_styles.center_of_selection,
                                                    caption = {"", {"string-mod-setting.map_tag_generator_position_style-map_tag_generator_center_of_selection"}, " [img=info]"},
                                                    tooltip = {"map-tag-generator-add-tags-gui.layout_center_of_selection"},
                                                    state = (player_table.position_style_temp == mtg.position_styles.center_of_selection),
                                                    handler = { [defines.events.on_gui_checked_state_changed] = on_position_choice_checked_state_changed[mtg.position_styles.center_of_selection], },
                                                },
                                            },
                                        },
                                    },
                                },
                                {
                                    -- select layout frame
                                    type = "frame",
                                    direction = "vertical",
                                    style = "inside_shallow_frame",
                                    style_mods = {vertically_stretchable = true},
                                    children = {
                                        {
                                            -- select layout subheader
                                            type = "frame",
                                            style = "subheader_frame",
                                            style_mods = {horizontally_stretchable = true, height = 36},
                                            children = {
                                                {
                                                    -- select layout title
                                                    type = "label",
                                                    style = "subheader_caption_label",
                                                    caption = {"map-tag-generator-add-tags-gui.layout_subheader_title"},
                                                },
                                            },
                                        },
                                        {
                                            -- layout radiobuttons flow
                                            type = "flow",
                                            direction = "vertical",
                                            style_mods = {padding = 12, vertical_spacing = 0},
                                            children = {
                                                {
                                                    -- layout radiobutton: horizontal
                                                    type = "radiobutton",
                                                    name = "layout_choice_" .. mtg.layout_styles.horizontal,
                                                    caption = {"string-mod-setting.map_tag_generator_layout_style-map_tag_generator_horizontal"},
                                                    state = (player_table.layout_style_temp == mtg.layout_styles.horizontal),
                                                    enabled = (player_table.selected_icon_count_ex_train > 1),
                                                    handler = { [defines.events.on_gui_checked_state_changed] = on_layout_choice_checked_state_changed[mtg.layout_styles.horizontal], },
                                                },
                                                {
                                                    -- layout radiobutton: vertical
                                                    type = "radiobutton",
                                                    name = "layout_choice_" .. mtg.layout_styles.vertical,
                                                    caption = {"string-mod-setting.map_tag_generator_layout_style-map_tag_generator_vertical"},
                                                    state = (player_table.layout_style_temp == mtg.layout_styles.vertical),
                                                    enabled = (player_table.selected_icon_count_ex_train > 1),
                                                    handler = { [defines.events.on_gui_checked_state_changed] = on_layout_choice_checked_state_changed[mtg.layout_styles.vertical], },
                                                },
                                                {
                                                    -- layout radiobutton: square
                                                    type = "radiobutton",
                                                    name = "layout_choice_" .. mtg.layout_styles.square,
                                                    caption = {"string-mod-setting.map_tag_generator_layout_style-map_tag_generator_square"},
                                                    state = (player_table.layout_style_temp == mtg.layout_styles.square),
                                                    enabled = (player_table.selected_icon_count_ex_train > 1),
                                                    handler = { [defines.events.on_gui_checked_state_changed] = on_layout_choice_checked_state_changed[mtg.layout_styles.square], },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        {
                            -- preview frame
                            type = "frame",
                            direction = "vertical",
                            style = "inside_shallow_frame",
                            style_mods = {horizontally_stretchable = false, vertically_stretchable = false},
                            children = {
                                {
                                    -- preview subheader
                                    type = "frame",
                                    style = "subheader_frame",
                                    style_mods = {horizontally_stretchable = true, height = 36},
                                    children = {
                                        {
                                            -- preview title
                                            type = "label",
                                            style = "subheader_caption_label",
                                            caption = {"map-tag-generator-add-tags-gui.preview_subheader_title"},
                                        },
                                        {
                                            -- spacer
                                            type = "empty-widget",
                                            style = "flib_horizontal_pusher",
                                        },
                                    },
                                },
                                {
                                    -- minimap frame
                                    type = "frame",
                                    style = "slot_button_deep_frame",
                                    style_mods = {margin = 12, maximal_height = 200, maximal_width = 200},
                                    children = {
                                        {
                                            -- minimap
                                            type = "minimap",
                                            name = "preview_minimap",
                                            style_mods = {height = 200, width = 200},
                                            position = positions.determine_tag_position({
                                                player = player,
                                                area = player_table.selection_event.area,
                                                position_style = mtg.position_styles.center_of_selection,
                                            }),
                                            surface_index = player.surface_index,
                                            chart_player_index = player.index,
                                            force = player.force.name,
                                            zoom = 1.25 * 1.5,
                                        },
                                        {
                                            type = "flow",
                                            name = "preview_icons_container",
                                            direction = "horizontal",
                                            style_mods = {horizontal_spacing = 0},
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
                    drag_target = "map_tag_generator_add_tags_window",
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
                            enabled = (player_table.selected_icon_count > 0),
                            handler = { [defines.events.on_gui_click] = on_confirm_click },
                        },
                    },
                },
            },
        }
    )

    player_table.gui.add_tags = elems

    elems.map_tag_generator_add_tags_window.force_auto_center()
    update_toggle_all_button(player)
    gui_util.update_addtags_preview(player)
    gui_util.update_addtags_enabled_states(player)

    -- Non-modal: world drags must not close the dialog and discard its selection.
end


---@param player LuaPlayer
gui_add_tags.close_window = function(player)
    local player_table = storage.player_table[player.index]

    -- close window
    if player_table.gui.edit_icon then
        gui_edit_icon.close_window(player)
    end
    player_table.gui.add_tags.map_tag_generator_add_tags_window.destroy()
    player_table.is_reordering_tags = false

    -- remove temp storage
    player_table.gui.add_tags = nil
    player_table.position_style_temp = nil
    player_table.layout_style_temp = nil
    player_table.selected_icon_count = nil
    player_table.selected_icon_count_ex_train = nil
    player_table.matching_entities = nil
    player_table.selection_event = nil
    player_table.current_tag_package = nil
    player_table.index_of_tag_to_reorder = nil
end

---@param player LuaPlayer
gui_add_tags.confirm_window = function(player)
    local player_table = storage.player_table[player.index]

    if player_table.selected_icon_count > 0 then
        -- refresh tag_package
        -- this is necessary because the icon buttons aren't able to directly edit the global tag_package
        -- so if they've been edited/reordered, we have to overwrite the tag_package first
        tag_packages.clear_tag_tables(player_table.current_tag_package)
        for _, sprite_button in pairs(player_table.gui.add_tags.icon_button_table.children) do
            tag_packages.add(player_table.current_tag_package, sprite_button.tags.tag_table --[[@as TagTable]])
        end

        -- get central position
        local tag_position
        if player_table.position_style_temp == mtg.position_styles.average_of_entities
        or player_table.position_style_temp == mtg.position_styles.middle_of_entities then
            -- get list of entities, ignoring any that have become invalid since GUI was opened
            local entities = {}
            for _, entity_list in pairs(player_table.matching_entities) do
                for _, entity in pairs(entity_list) do
                    if entity.valid then
                        -- train stops don't contribute to tag position
                        if not (entity.type == "train-stop" or (entity.type == "entity-ghost" and entity.ghost_type == "train-stop")) then
                            table.insert(entities, entity)
                        end
                    end
                end
            end
            -- if no non-train-stop entities were found, use the train stops
            if not entities[1] then
                for _, entity_list in pairs(player_table.matching_entities) do
                    for _, entity in pairs(entity_list) do
                        if entity.valid then
                            table.insert(entities, entity)
                        end
                    end
                end
            end
            -- if absolutely nothing was found, just default to center-of-selection
            if not entities[1] then
                player_table.position_style_temp = mtg.position_styles.center_of_selection
            end

            tag_position = positions.determine_tag_position({
                player = player,
                area = player_table.selection_event.area, -- may be needed if position style changes to center-of-selection
                entities = entities,
                position_style = player_table.position_style_temp,
            })
        elseif player_table.position_style_temp == mtg.position_styles.center_of_selection then
            tag_position = positions.determine_tag_position({
                player = player,
                area = player_table.selection_event.area,
                position_style = player_table.position_style_temp,
            })
        end

        -- create tags
        tag_packages.create_map_tags(player_table.current_tag_package, tag_position, player_table.layout_style_temp)
    end
end

return gui_add_tags
