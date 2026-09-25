local mod_gui = require("map_tag_generator.gui.mod_gui")
local mtg = require("map_tag_generator.constants")

local init = {}

---@class PlayerData
---@field gui GuiData
---@field translations TranslationData
---@field generated_tags LuaCustomChartTag[] A list of tags this player generated with the MTG tool.
---@field included_categories table<EntityCategory, boolean> Entity categories that the player has selected for tag generation.
---@field position_style PositionStyle
---@field layout_style LayoutStyle
---@field add_tags_dialog boolean If the player wants to use the add-tags GUI.
---@field always_add_tags_dialog boolean If the player wants to ALWAYS use the add-tags GUI. 
---@field restrict_deletion boolean If the player wants to restrict the delete-tags tool to default to tags they created with the MTG tool.
---@field delete_tags_dialog boolean If the player wants to use the delete-tags GUI.
---@field show_spawn_tool_button boolean If the player wants to show the mod-gui button.
---@field toggle_all_mode ToggleAllMode
---@field is_reordering_tags boolean
---@field generate_tag_names boolean
-- not the best way to store the temp data but I don't really want to mess with it at this point
---@field position_style_temp? PositionStyle
---@field layout_style_temp? LayoutStyle
---@field selected_icon_count? number
---@field selected_icon_count_ex_train? number
---@field current_tag_package? TagPackage
---@field selection_event? EventData.on_player_selected_area | EventData.on_player_alt_selected_area | EventData.on_player_reverse_selected_area
---@field icon_button_to_edit? LuaGuiElement
---@field matching_entities? table<EntityCategory, LuaEntity[]>
---@field tags_selected_for_deletion? LuaCustomChartTag[]
---@field tags_to_delete_count? number
---@field index_of_tag_to_reorder? int

---@alias GuiData { [string] : LuaGuiElement | GuiData }

---@param player LuaPlayer
local function create_player_table(player)
    if storage.player_table[player.index] == nil then
        ---@type PlayerData
        local new_table = {
            gui = {},
            translations = {},
            generated_tags = {},
            included_categories = {},
            position_style = mtg.position_styles.middle_of_entities,
            layout_style = mtg.layout_styles.horizontal,
            add_tags_dialog = true,
            always_add_tags_dialog = false,
            restrict_deletion = false,
            delete_tags_dialog = true,
            show_spawn_tool_button = true,
            toggle_all_mode = mtg.toggle_all_modes.select,
            is_reordering_tags = false,
            generate_tag_names = false,
        }
        storage.player_table[player.index] = new_table
    end
end

init.initialize_globals = function()
    ---@type table<number, PlayerData>
    storage.player_table = {}
    ---@type boolean
    storage.restrict_deletion_for_all = false
end

---@param player LuaPlayer
init.initialize_mod_for_player = function(player)
    create_player_table(player)
    init.get_settings(player)
    mod_gui.init(player)
end

---Handles updates that need to happen any time any configuration settings are changed.
init.update_compatibility = function()
end

init.update_globals = function()
end

---@param player LuaPlayer
init.update_mod_for_player = function(player)
    local player_table = storage.player_table[player.index]

    -- 1.1.0
    -- add gui reference table
    if not player_table.gui then
        player_table.gui = {}
    end
    -- add layout style setting
    if not player_table.layout_style then
        player_table.layout_style = mtg.layout_styles.horizontal
    end
    -- add add_tags_dialog setting
    if player_table.add_tags_dialog == nil then
        player_table.add_tags_dialog = true
    end

    -- 1.2.0
    -- add always_add_tags_dialog setting
    if player_table.always_add_tags_dialog == nil then
        player_table.always_add_tags_dialog = false
    end
    -- add delete_tags_dialog setting
    if player_table.delete_tags_dialog == nil then
        player_table.delete_tags_dialog = true
    end

    -- 1.2.2
    -- add mod_gui interface
    mod_gui.init(player)

    -- 1.2.7
    -- add toggle_all_mode
    if player_table.toggle_all_mode == nil then
        player_table.toggle_all_mode = mtg.toggle_all_modes.select
    end

    -- 1.2.9
    -- add translation fields
    if not player_table.translations then
        player_table.translations = {}
    end
    if player_table.generate_tag_names == nil then
        player_table.generate_tag_names = false
    end

    -- 2.0.3
    -- add is_reordering_tags
    if player_table.is_reordering_tags == nil then
        player_table.is_reordering_tags = false
    end

    -- 2.1.2
    -- remove soil_harvests
    if storage.soil_harvests then
        storage.soil_harvests = nil
    end

    init.get_settings(player)
end

init.get_settings = function(player)
    local player_table = storage.player_table[player.index]

    -- per-map settings
    storage.restrict_deletion_for_all = settings.global["map_tag_generator_restrict_deletion_map"].value --[[@as boolean]]

    -- per-player settings
    local player_settings = settings.get_player_settings(player)

    for _, category in pairs(mtg.entity_categories) do
        if player_settings["map_tag_generator_include_"..category].value then
            player_table.included_categories[category] = true
        else
            player_table.included_categories[category] = nil
        end
    end
    player_table.position_style = player_settings["map_tag_generator_position_style"].value --[[@as PositionStyle]]
    player_table.layout_style = player_settings["map_tag_generator_layout_style"].value --[[@as LayoutStyle]]
    player_table.add_tags_dialog = player_settings["map_tag_generator_add_tags_dialog"].value --[[@as boolean]]
    player_table.always_add_tags_dialog = player_settings["map_tag_generator_always_add_tags_dialog"].value --[[@as boolean]]
    player_table.restrict_deletion = player_settings["map_tag_generator_restrict_deletion_player"].value --[[@as boolean]]
    player_table.delete_tags_dialog = player_settings["map_tag_generator_delete_tags_dialog"].value --[[@as boolean]]
    player_table.show_spawn_tool_button = player_settings["map_tag_generator_show_spawn_tool_button"].value --[[@as boolean]]
    player_table.generate_tag_names = player_settings["map_tag_generator_generate_tag_names"].value --[[@as boolean]]

    -- handle any changed settings as needed
    mod_gui.set_visibility(player)
end

return init