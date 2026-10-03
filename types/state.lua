---@meta

---Private UI sessions deliberately carry heterogeneous flib references and picker state.
---@class LLLState
---@field next_id integer
---@field plans table<integer, RecipePlan?>
---@field sessions table<integer, table?>
---@field preferences table<integer, LLLPreferences?>
---@field highlights table<integer, LLLHighlights?>
---@field release_fixture table? Test-only reload fixture.

---@class LLLPreferences
---@field researched_only boolean
---@field show_retired boolean
---@field highlight_sources boolean
---@field picker_group string?

---@class LLLHighlights
---@field plans LuaRenderObject[]
---@field guide LLLGuide?

---@class LLLGuide
---@field entity LuaEntity
---@field pin LuaPin
---@field expires integer

---@class LLLStorage
---@field location_location_location LLLState
