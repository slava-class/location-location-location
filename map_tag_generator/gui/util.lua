local mtg = require("map_tag_generator.constants")
local signals = require("map_tag_generator.signals")
local positions = require("map_tag_generator.positions")
local tag_util = require("map_tag_generator.tags")
local flib_gui = require("__flib__.gui")

local gui_util = {}

---Disables a LuaGUIElement and all of its descendents.
---@param element LuaGuiElement
gui_util.deep_disable = function(element)
    if not element or element.enabled == nil then return end
    element.enabled = false

    if not element.children then return end
    for _, child in pairs(element.children) do
        gui_util.deep_disable(child)
    end
end

---Enables a GUI element and all of its descendents.
---@param element LuaGuiElement
gui_util.deep_enable = function(element)
    if not element or element.enabled == nil then return end
    element.enabled = true

    if not element.children then return end
    for _, child in pairs(element.children) do
        gui_util.deep_enable(child)
    end
end

---@param player LuaPlayer
gui_util.update_addtags_enabled_states = function(player)
    -- this should really be in gui_add_tags
    -- but both add_tags and edit_icon need to call this
    -- and edit_icon can't require add_tags because add_tags requires edit_icon
    -- (another solution would be to put add_tags and edit_icon in the same file since edit_icon is really just a sub-gui of add_tags, but eh)
    local player_table = storage.player_table[player.index]
    if not player_table.gui.add_tags then return end

    -- update enabled state of confirm button, toggle all button, position selection, and layout selection
    player_table.gui.add_tags.confirm_button.enabled = (player_table.selected_icon_count > 0)
    player_table.gui.add_tags.toggle_all_button.enabled = (next(player_table.gui.add_tags.icon_button_table.children) ~= nil)
    player_table.gui.add_tags["position_choice_" .. mtg.position_styles.middle_of_entities].enabled = next(player_table.matching_entities) ~= nil
    player_table.gui.add_tags["position_choice_" .. mtg.position_styles.average_of_entities].enabled = next(player_table.matching_entities) ~= nil
    for _, layout_style in pairs(mtg.layout_styles) do
        local radiobutton = player_table.gui.add_tags["layout_choice_" .. layout_style]
        radiobutton.enabled = (player_table.selected_icon_count_ex_train > 1)
    end
end

---@param player LuaPlayer
gui_util.update_addtags_preview = function(player)
    -- this should really be in gui_add_tags
    -- but both add_tags and edit_icon need to call this
    -- and edit_icon can't require add_tags because add_tags requires edit_icon
    -- (another solution would be to put add_tags and edit_icon in the same file since edit_icon is really just a sub-gui of add_tags, but eh)
    local player_table = storage.player_table[player.index]
    if not player_table.gui.add_tags then return end

    -- this code copied (and slightly changed) from gui_add_tags.confirm_window() - probably a better way to do it but eh this works for now
    -- get central position
    local center
    ---@type PositionStyle
    local position_style_temp = player_table.position_style_temp
    if position_style_temp == mtg.position_styles.average_of_entities
    or position_style_temp == mtg.position_styles.middle_of_entities then
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
            position_style_temp = mtg.position_styles.center_of_selection
        end

        center = positions.determine_tag_position({
            player = player,
            area = player_table.selection_event.area, -- may be needed if position style changes to center-of-selection
            entities = entities,
            position_style = position_style_temp,
        })
    elseif player_table.position_style_temp == mtg.position_styles.center_of_selection then
        center = positions.determine_tag_position({
            player = player,
            area = player_table.selection_event.area,
            position_style = position_style_temp,
        })
    end

    -- this code copied (and slightly changed) from tag_package.create_map_tags() - probably a better way to do it but eh this works for now
    -- get tag positions
    local enabled_count_ex_train = 0
    for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
        local tag_table = button.tags.tag_table --[[@as TagTable]]
        if tag_table.enabled and not tag_table.train_stop then
            enabled_count_ex_train = enabled_count_ex_train + 1
        end
    end
    local position_list = positions.multi_tag_positions(center, enabled_count_ex_train, player_table.layout_style_temp)

    player_table.gui.add_tags.preview_icons_container.clear()
    local sprite_size = 30
    local margin_offset = {
        x = -(player_table.gui.add_tags.preview_minimap.style.maximal_width / 2) - (sprite_size / 2),
        y = (player_table.gui.add_tags.preview_minimap.style.maximal_height / 2) - (sprite_size / 2),
    }
    local i = 1
    -- the way the sprites work is to create them with negative x margin
    -- as long as everything has negative x margin, they will be "created" at "x=0" and to move them 100px to the left we just set margin.x = -100
    -- however, if anything ever bumps up to having a positive x value (e.g., sprite width of 30 and margin.x of -20, so 10px are beyond the x=0 line), the parent flow will suddenly have a width of 10 instead of 0
    -- this means that future sprites will actually be created at x=10
    -- (this only happens in the x direction because the parent flow layout is horizontal)
    -- so we need to keep track of whether any sprites have bumped past x=0, and if so, offset all future sprites by that amount
    local push_beyond_y_axis = 0
    for _, button in pairs(player_table.gui.add_tags.icon_button_table.children) do
        local tag_table = button.tags.tag_table --[[@as TagTable]]
        if tag_table.enabled then
            local tag_position_in_world_space
            if tag_table.train_stop then
                tag_position_in_world_space = tag_table.position
            else
                tag_position_in_world_space = position_list[i]
                i = i + 1
            end
            local tag_offset_in_world_space = {
                x = tag_position_in_world_space.x - player_table.gui.add_tags.preview_minimap.position.x,
                y = tag_position_in_world_space.y - player_table.gui.add_tags.preview_minimap.position.y,
            }
            local tag_offset_in_preview_space = {
                -- magic conversion number
                x = tag_offset_in_world_space.x * 34 / mtg.tag_shift_amount,
                y = tag_offset_in_world_space.y * 34 / mtg.tag_shift_amount,
            }
            local margin = {
                -- the margin as if the flow was being started at x=0 in the parent. ignore the push_beyond_y_axis at this point
                x = margin_offset.x + tag_offset_in_preview_space.x,
                y = margin_offset.y + tag_offset_in_preview_space.y,
            }
            -- we only need to draw the sprite if any part of it would be visible on top of the minimap
            -- think of the sprite's origin as being its top-left point, and the margin as being the desired coordinates of that origin (with the coordinate system having (0, 0) at the top-right of the minimap)
            if margin.x >= -player_table.gui.add_tags.preview_minimap.style.maximal_width - sprite_size
            and margin.x <= 0
            and margin.y >= 0 - sprite_size
            and margin.y <= player_table.gui.add_tags.preview_minimap.style.maximal_height
            then
                local includes_quality = (tag_table.signal and tag_table.signal.quality and tag_table.signal.quality ~= "normal") or false
                flib_gui.add(player_table.gui.add_tags.preview_icons_container,
                    {
                        -- we have to wrap the sprite within a flow so the positioning actually works
                        type = "flow",
                        style_mods = {width = 0, horizontal_spacing = 0}, ---@diagnostic disable-line: missing-fields
                        children = {
                            {
                                type = "sprite",
                                sprite = signals.get_sprite_from_signal(tag_table.signal, "utility/show_tags_in_map_view"),
                                -- subtract the push_beyond_y_axis to make it so the flow really does start from x=0 in the parent
                                -- (in reality it's starting from x=push_beyond_y_axis, so we adjust for that)
                                style_mods = {margin = {margin.y, 0, 0, margin.x - push_beyond_y_axis}, size = sprite_size}, ---@diagnostic disable-line: missing-fields
                                resize_to_sprite = false,
                            },
                            {
                                type = "sprite",
                                sprite = includes_quality and "quality/" .. tag_table.signal.quality or "utility/any_quality", -- just add any_quality as a fallback, should never be visible though
                                style_mods = {margin = {margin.y + (sprite_size / 2), 0, 0, -sprite_size}, size = sprite_size / 2}, ---@diagnostic disable-line: missing-fields
                                resize_to_sprite = false,
                                visible = includes_quality,
                            },
                        },
                    }
                )
                if includes_quality then
                    -- don't fully understand why we have to account for the quality icon even when it still has negative x margin, but it does seem to work
                    push_beyond_y_axis = math.max(push_beyond_y_axis, (margin.x + sprite_size - (sprite_size / 2)))
                else
                    push_beyond_y_axis = math.max(push_beyond_y_axis, (margin.x + sprite_size))
                end
            end
        end
    end
end

---Updates a value in a LuaGUIElement's tags table.
---@param element LuaGuiElement
---@param updates { [string]: AnyBasic }
gui_util.update_tags = function(element, updates)
    local elem_tags = element.tags

    for k, v in pairs(updates) do
        elem_tags[k] = v
    end

    element.tags = elem_tags
end

---Generates an icon button tooltip from a TagTable. Used by GUIs related to adding tags.
---@param tag_table TagTable
---@return LocalisedString
gui_util.icon_button_tooltip_from_table = function(tag_table)
    local tooltip = {""}
    if tag_table.train_stop then
        table.insert(tooltip, {"map-tag-generator-add-tags-gui.linked_train_stop", tag_table.train_stop})
        table.insert(tooltip, "\n---\n")
    end
    if tag_table.text ~= "" then
        table.insert(tooltip, {"map-tag-generator-add-tags-gui.tag_text", tag_table.text})
        table.insert(tooltip, "\n---\n")
    end
    table.insert(tooltip, {"map-tag-generator-add-tags-gui.icon_button_instructions"})
    return tooltip
end

---Generates an icon button from a TagTable. Used by GUIs related to adding tags.
---@param tag_table TagTable
---@param player_table PlayerData
---@param on_click_callback function
---@return GuiElemDef
gui_util.icon_button_from_table = function(tag_table, player_table, on_click_callback)
    local style
    if tag_table.enabled then
        player_table.selected_icon_count = player_table.selected_icon_count + 1
        if not tag_table.train_stop then
            player_table.selected_icon_count_ex_train = player_table.selected_icon_count_ex_train + 1
        end
        style = "flib_selected_slot_button_green"
    else
        style = "flib_slot_button_default"
    end
    return {
        type = "sprite-button",
        elem_mods = {mouse_button_filter = {"left-and-right"}},
        style = style,
        sprite = signals.get_sprite_from_signal(tag_table.signal, nil),
        quality = signals.get_quality_from_signal(tag_table.signal, "normal"),
        tooltip = gui_util.icon_button_tooltip_from_table(tag_table),
        handler = { [defines.events.on_gui_click] = on_click_callback },
        tags = {tag_table = tag_table},
    }
end

---Generates an array of icon buttons from a TagPackage. Used by GUIs related to adding tags.
---@param tag_package TagPackage
---@param player_table PlayerData
---@param on_click_callback function
---@return GuiElemDef[]
gui_util.icon_buttons_from_package = function(tag_package, player_table, on_click_callback)
    local buttons = {}
    for _, tag_table in pairs(tag_package.tag_tables) do
        table.insert(buttons, gui_util.icon_button_from_table(tag_table, player_table, on_click_callback))
    end
    return buttons
end

---Generates a tag button tooltip from a LuaCustomChartTag. Used by GUIs related to deleting tags.
---@param lua_tag LuaCustomChartTag
---@param can_toggle boolean Whether the player is allowed to toggle the associated button.
---@return LocalisedString
gui_util.tag_button_tooltip_from_lua_tag = function(lua_tag, can_toggle)
    local tooltip = {""}
    local should_add_line = false

    -- tag text
    if lua_tag.text ~= "" then
        table.insert(tooltip, {"map-tag-generator-delete-tags-gui.tag_text", lua_tag.text})
        table.insert(tooltip, "\n")
        should_add_line = true
    end

    -- last user
    if lua_tag.last_user and lua_tag.last_user.name then
        table.insert(tooltip, { "gui-tag-edit.last-user", lua_tag.last_user.name })
        should_add_line = true
    end

    -- divider line (only if there is text present at this point)
    if should_add_line then
        table.insert(tooltip, "\n---\n")
    end

    -- instructions
    if can_toggle then
        table.insert(tooltip, {"map-tag-generator-delete-tags-gui.icon_button_instructions"})
    else
        table.insert(tooltip, {"map-tag-generator-delete-tags-gui.cannot_delete"})
    end

    return tooltip
end

---Generates a tag button from a LuaCustomChartTag. Used by GUIs related to deleting tags.
---@param lua_tag LuaCustomChartTag
---@param player_table PlayerData
---@param on_click_callback function
---@return GuiElemDef? # Will be `nil` if `lua_tag` is not valid.
gui_util.tag_button_from_lua_tag = function(lua_tag, player_table, on_click_callback)
    if not lua_tag.valid then return nil end

    local style
    local can_toggle
    local selected
    if storage.restrict_deletion_for_all then
        -- generated tags start on; all others start off and can't be turned on
        if tag_util.table_contains_tag(player_table.generated_tags, lua_tag) then
            player_table.tags_to_delete_count = player_table.tags_to_delete_count + 1
            style = "flib_selected_slot_button_green"
            can_toggle = true
            selected = true
        else
            style = "map_tag_generator_no_toggle_button"
            can_toggle = false
            selected = false
        end

    elseif player_table.restrict_deletion then
        -- generated tags start on; all others start off but can be turned on
        if tag_util.table_contains_tag(player_table.generated_tags, lua_tag) then
            player_table.tags_to_delete_count = player_table.tags_to_delete_count + 1
            style = "flib_selected_slot_button_green"
            selected = true
        else
            style = "flib_slot_button_default"
            selected = false
        end
        can_toggle = true
    else
        -- all tags start on
        player_table.tags_to_delete_count = player_table.tags_to_delete_count + 1
        style = "flib_selected_slot_button_green"
        can_toggle = true
        selected = true
    end

    return {
        type = "sprite-button",
        elem_mods = {mouse_button_filter = {"left"}},
        style = style,
        sprite = signals.get_sprite_from_signal(lua_tag.icon, nil),
        quality = signals.get_quality_from_signal(lua_tag.icon, "normal"),
        tooltip = gui_util.tag_button_tooltip_from_lua_tag(lua_tag, can_toggle),
        handler = { [defines.events.on_gui_click] = on_click_callback },
        tags = {type = "map_tag_generator_delete_tag_icon_button", can_toggle = can_toggle, selected = selected},
    }
end

---Generates an array of tag buttons from an array of LuaCustomChartTag objects. Used by GUIs related to deleting tags.
---@param lua_tag_array LuaCustomChartTag[]
---@param player_table PlayerData
---@param on_click_callback function
---@return GuiElemDef[]
gui_util.tag_buttons_from_array = function(lua_tag_array, player_table, on_click_callback)
    local buttons = {}
    for index, lua_tag in pairs(lua_tag_array) do
        local t = gui_util.tag_button_from_lua_tag(lua_tag, player_table, on_click_callback)
        if t then
            t.tags.index = index -- so the button knows which tag in the tag array it is linked to
            table.insert(buttons, t)
        end
    end
    return buttons
end

return gui_util
