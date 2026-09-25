local lualib = {}

---Checks if a table contains a given element.
---@generic T
---@param t T[]
---@param v T
---@return boolean
lualib.table_contains = function(t, v)
    for _, element in pairs(t) do
        if element == v then return true end
    end
    return false
end

---A utility function to make sure that only valid sprite paths are used.
---@param path SpritePath
---@return SpritePath? # `path` if `path` is a valid sprite path, otherwise `nil`.
lualib.get_sprite = function(path)
    local spr = nil

    if helpers.is_valid_sprite_path(path) then
        spr = path
    end

    return spr
end

---Determines if one quality has level lower than another, given two quality names.
---@param quality_name_1 string The name of a quality prototype.
---@param quality_name_2 string The name of a quality prototype.
---@return boolean # If the quality referenced by `quality_name_1` has level strictly less than the quality referenced by `quality_name_2`.
lualib.quality_is_less_than = function(quality_name_1, quality_name_2)
    return prototypes.quality[quality_name_1].level < prototypes.quality[quality_name_2].level
end

return lualib