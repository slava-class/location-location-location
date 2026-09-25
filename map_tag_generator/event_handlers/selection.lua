local gui_add_tags = require("map_tag_generator.gui.add_tags")
local gui_delete_tags = require("map_tag_generator.gui.delete_tags")
local tag_packages = require("map_tag_generator.structs.tag_package")
local mtg = require("map_tag_generator.constants")
local detection = require("map_tag_generator.entity_detection")
local positions = require("map_tag_generator.positions")
local tag_util = require("map_tag_generator.tags")
local util = require("__core__.lualib.util")
local selection = require("map_tag_generator.selection")

local export = { events = {} }

---@type table<EntityCategory, SelectionHandler>
local selection_handlers = {}
for _, category in pairs(mtg.entity_categories) do
    selection_handlers[category] = require("map_tag_generator.selection_handlers."..category)
end

---Handle selection for the tag-generation case (as opposed to tag-deletion case).
---@param e EventData.on_player_selected_area | EventData.on_player_alt_selected_area
---@param force_open_gui boolean
local function main_selection(e, force_open_gui, mode)
    if e.item ~= "map_tag_generator_selection_tool" then return end
    local player = game.get_player(e.player_index)
    if not player then return end
    local player_table = storage.player_table[player.index]
    if player_table.gui.edit_icon then return end
    mode = mode or "replace"
    local previous = player_table.gui.add_tags and player_table.selection_event
    local editing = mode ~= "replace" and previous and previous.surface.valid and previous.surface.index == e.surface.index
    e = selection.update(previous, e, mode)
    if mode ~= "replace" then force_open_gui = true end

    -- Keep the current dialog and its choices while refining the selection.
    if player_table.gui.add_tags and not editing then
        gui_add_tags.close_window(player)
    end
    if player_table.gui.delete_tags then
        gui_delete_tags.close_window(player)
    end

    player_table.selection_event = util.copy(e)

    if e.item == "map_tag_generator_selection_tool" then
        -- determine which entity types are present in the selection
        local selected_entities = detection.sort_entities(e.entities)

        player_table.matching_entities = {}

        -- pass to the appropriate handler(s) to get the icons
        for _, category in pairs(mtg.entity_categories) do
            if player_table.included_categories[category] then -- if the player wants map tags from this category
                for _, type in pairs(mtg.entity_types[category]) do
                    -- selected_entity_type is the ingame type; selected_entity_table is a table with references to each selected entity matching the type
                    for selected_entity_type, selected_entity_table in pairs(selected_entities) do
                        if selected_entity_type == type then -- if the selected entity currently being considered matches the category (by matching a type contained in that category)
                            for _, entity in pairs(selected_entity_table) do -- "entity" is now a direct reference to the entity
                                if player_table.matching_entities[category] == nil then
                                    player_table.matching_entities[category] = {}
                                end
                                table.insert(player_table.matching_entities[category], entity)
                            end
                        end
                    end
                end
            end
        end

        if next(player_table.matching_entities) ~= nil then
            local tag_package = tag_packages.new({player = player, surface = e.surface})

            for category, entities in pairs(player_table.matching_entities) do
                local package = selection_handlers[category].get_tag_package(entities, player_table)
                for _, tag in pairs(package.tag_tables) do tag.source_category = category end
                tag_packages.concat(tag_package, package)
            end

            tag_packages.remove_duplicates(tag_package)

            if tag_packages.size(tag_package) > 0 then
                if player_table.add_tags_dialog or force_open_gui then
                    -- store the tag_package in global so it can be accessed later
                    player_table.current_tag_package = tag_package

                    -- open add_tags dialog window
                    gui_add_tags.build_window(player)
                else
                    -- create tags with default settings
                    -- get central position
                    local tag_position
                    if player_table.position_style == mtg.position_styles.average_of_entities
                    or player_table.position_style == mtg.position_styles.middle_of_entities then
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
                            area = e.area, -- may be needed if position style changes to center-of-selection
                            entities = entities,
                            position_style = player_table.position_style,
                        })
                    elseif player_table.position_style == mtg.position_styles.center_of_selection then
                        tag_position = positions.determine_tag_position({
                            player = player,
                            area = e.area,
                            position_style = player_table.position_style,
                        })
                    end

                    -- create tags
                    tag_packages.create_map_tags(tag_package, tag_position, player_table.layout_style)

                    -- remove temp storage
                    player_table.matching_entities = nil
                    player_table.selection_event = nil
                end

            else -- matching entities found, no tags would be generated
                if force_open_gui then
                    -- store the tag_package in global so it can be accessed later
                    player_table.current_tag_package = tag_package

                    -- open add_tags dialog window
                    gui_add_tags.build_window(player)
                else
                    player_table.matching_entities = nil
                    player_table.selection_event = nil
                end
            end

        else -- no matching entities found
            if force_open_gui then
                -- create and store a tag_package in global so it can be accessed later
                player_table.current_tag_package = tag_packages.new({player = player, surface = e.surface})

                -- open add_tags dialog window
                gui_add_tags.build_window(player)
            else
                player_table.matching_entities = nil
                player_table.selection_event = nil
            end
        end
    end
end

export.events[defines.events.on_player_selected_area] = function(e)
    -- force open GUI only if specified in settings
    local player = game.get_player(e.player_index)
    if not player then return end
    local player_table = storage.player_table[player.index]
    main_selection(e, (player_table.add_tags_dialog and player_table.always_add_tags_dialog))
end
export.events[defines.events.on_player_alt_selected_area] = function(e)
    main_selection(e, true, "add")
end

export.events[defines.events.on_player_super_forced_selected_area] = function(e)
    -- force open GUI
    local player = game.get_player(e.player_index)
    if not player then return end
    local player_table = storage.player_table[player.index]
    main_selection(e, true)
end

export.events[defines.events.on_player_reverse_selected_area] = function(e)
    if e.item ~= "map_tag_generator_selection_tool" then return end
    local player = game.get_player(e.player_index)
    if not player then return end
    local player_table = storage.player_table[player.index]

    -- if a GUI is already open, close it first (to give the effect of "refreshing" with the new selection)
    if player_table.gui.add_tags then
        gui_add_tags.close_window(player)
    end
    if player_table.gui.delete_tags then
        gui_delete_tags.close_window(player)
    end

    player_table.selection_event = util.copy(e)

    if e.item == "map_tag_generator_selection_tool" then
        -- only works if the player is viewing the minimap, not zoomed in, so the map tags are actually visible
        if player.render_mode == defines.render_mode.chart then
            local tags = player.force.find_chart_tags(e.surface, e.area)

            if player_table.delete_tags_dialog then
                -- store the tags in global so they can be accessed later
                player_table.tags_selected_for_deletion = tags

                -- open add_tags dialog window if at least 1 tag was found
                if tags[1] then
                    if player.cursor_stack and player.cursor_stack.name == "map_tag_generator_selection_tool" then
                        player.clear_cursor()
                    end
                    gui_delete_tags.build_window(player)
                end
            else
                for _, tag in pairs(tags) do
                    -- if deletion is being restricted, only delete the tag if the player created it through the mod
                    if storage.restrict_deletion_for_all or player_table.restrict_deletion then
                        if tag_util.table_contains_tag(player_table.generated_tags, tag) then
                            tag.destroy()
                        end
                    else -- deletion is not restricted for this player
                        tag.destroy()
                    end
                end
            end
        end
    end
end
export.events[defines.events.on_player_alt_reverse_selected_area] = function(e)
    main_selection(e, true, "remove")
end

return export
