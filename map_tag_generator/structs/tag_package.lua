local positions = require("map_tag_generator.positions")

local tag_package = {}

---A structure for holding multiple TagTables. The `player` and `surface` fields are optional, 
---but *must* be included in order to call `tag_package.create_map_tags()`.
---@class TagPackage
---@field player? LuaPlayer The player creating the tags.
---@field surface? LuaSurface The surface where the tags will go.
---@field tag_tables TagTable[] The tags to create. Note that the keys of this table may be changed by methods for organizational purposes--when using, **only ever get information from the values**.

---TagPackage constructor.
---@param args? { player: LuaPlayer?, surface: LuaSurface?, tag_tables: TagTable[]? }
---@return TagPackage
tag_package.new = function(args)
    args = args or {}
    ---@type TagPackage
    local self = {
        player = args.player,
        surface = args.surface,
        tag_tables = {},
    }

    if args.tag_tables then
        for _, tag_table in pairs(args.tag_tables) do
            tag_package.add(self, tag_table)
        end
    end
    return self
end

---Adds a TagTable to a TagPackage. Note that this adds **by reference**.
---@param self TagPackage
---@param tag_table TagTable
tag_package.add = function(self, tag_table)
    table.insert(self.tag_tables, tag_table)
end

---Adds all TagTables from another TagPackage into this TagPackage. Note that this adds **by reference**.
---@param self TagPackage
---@param other TagPackage
tag_package.concat = function(self, other)
    for _, tag_table in pairs(other.tag_tables) do
        tag_package.add(self, tag_table)
    end
end

---Gets the number of TagTables stored in a TagPackage.
---@param self TagPackage
---@return integer
tag_package.size = function(self)
    return table_size(self.tag_tables)
end

---Remove all TagTables from a TagPackage.
---@param self TagPackage
tag_package.clear_tag_tables = function(self)
    self.tag_tables = {}
end

---Removes any duplicate TagTables from a TagPackage.
---In the case that there are identical TagTables with differing `enabled` states, the kept TagTable will have `enabled` set to `true`.
---`resource_mode` exists for compatibility with Angel's Infinite Ores, and will remove infinite ore TagTables if `true`.
---@param self TagPackage
---@param resource_mode? boolean
tag_package.remove_duplicates = function(self, resource_mode)
    local function tag_table_to_key(tag_table --[[@as TagTable]])
        local str = ""
        if tag_table.train_stop then str = str .. "ts_" .. tag_table.train_stop .. "_" end
        str = str .. tag_table.signal.type .. tag_table.signal.name
        if tag_table.signal.quality then
            if tag_table.signal.quality.name then str = str .. tag_table.signal.quality.name
            else str = str .. tag_table.signal.quality end
        end
        str = str .. tag_table.position.x .. tag_table.position.y
        if not resource_mode then
            str = str .. tag_table.text
        end

        return str
    end

    ---@type TagTable[]
    local result = {}
    for _, tag_table in pairs(self.tag_tables) do
        local key = tag_table_to_key(tag_table)

        -- add tag_table if it's not already there
        if result[key] == nil then
            result[key] = tag_table
        -- if it's already there, enable it if any of the duplicate signals are enabled
        elseif tag_table.enabled then
            result[key].enabled = true
            if resource_mode then
                -- favor the longer text string. for resource_mode, we're just trying to choose between something like
                -- "Stone" (from Angel's Infinite Ores) and "Stone 103k" (from regular stone) in "generate_tag_names" mode
                -- or "" vs "103k" in "normal" mode, so we'll always want to use whichever tag name is longer
                if result[key].text:len() < tag_table.text:len() then
                    result[key].text = tag_table.text
                end
            end
        end
    end
    self.tag_tables = result
end

---Creates a map tag for each enabled TagTable in a TagPackage.
---@param self TagPackage
---@param center MapPosition.0 This is only relevant for non-train-stop tags.
---@param layout_style LayoutStyle This is only relevant for non-train-stop tags.
tag_package.create_map_tags = function(self, center, layout_style)
    -- set tag positions
    local enabled_count = 0
    for _, tag_table in pairs(self.tag_tables) do
        if tag_table.enabled and not tag_table.train_stop then
            enabled_count = enabled_count + 1
        end
    end
    local position_list = positions.multi_tag_positions(center, enabled_count, layout_style)

    local i = 1
    for _, tag_table in pairs(self.tag_tables) do
        if tag_table.enabled and not tag_table.train_stop then
            tag_table.position = position_list[i]
            i = i + 1
        end
    end

    -- create tags
    for _, tag_table in pairs(self.tag_tables) do
        if tag_table.enabled then
            local tag = self.player.force.add_chart_tag(self.surface, {
                position = tag_table.position,
                icon = tag_table.signal,
                text = tag_table.text,
                last_user = self.player,
            })

            table.insert(storage.player_table[self.player.index].generated_tags, tag)
        end
    end
end

return tag_package