local tags = {}

---Checks if a table contains a given map tag.
---@param t LuaCustomChartTag[]
---@param tag LuaCustomChartTag
---@return boolean # If `tag` is valid and `t` contains `tag`.
tags.table_contains_tag = function(t, tag)
    if tag.valid then
        for _, v in pairs(t) do
            -- within a force, every tag that is ever created has a unique tag_number
            -- these numbers are not reused even if a tag is destroyed
            -- so a tag can be uniquely identified by the (force + tag_number) combination

            -- check that the table's element is a tag
            if v.valid and v.force and v.tag_number then
                if tag.force == v.force and tag.tag_number == v.tag_number then
                    return true
                end
            end
        end
    end
    return false
end

---Removes invalid map tag references from a table, inplace.
---*(Technically removes any invalid references, but for now we only need to remove invalid tag references.)*
---@param t LuaCustomChartTag[]
tags.remove_invalid_tags = function(t)
    local indices_to_remove = {}
    for k, v in pairs(t) do
        if v.valid ~= nil and v.valid == false then
            table.insert(indices_to_remove, k)
        end
    end
    for _, index in pairs(indices_to_remove) do
        table.remove(t, index)
    end
end

return tags