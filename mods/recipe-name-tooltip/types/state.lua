---@meta

---@class RecipeNameTooltipTarget
---@field entity LuaEntity
---@field viewers table<integer, true?>
---@field field_id uint32?
---@field content_name string?
---@field label string?
---@field quality_name string?
---@field comparator ComparatorString?

---@class RecipeNameTooltipState
---@field targets table<integer, RecipeNameTooltipTarget?>
---@field viewers table<integer, integer?>

---@class RecipeNameTooltipStorage
---@field recipe_name_tooltip RecipeNameTooltipState
