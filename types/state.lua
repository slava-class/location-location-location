---@meta

---Private UI sessions deliberately carry heterogeneous flib references and picker state.
---@class LLLState
---@field schema_version integer
---@field next_id integer
---@field plans table<integer, RecipePlan?>
---@field sessions table<integer, table?>
---@field preferences table<integer, LLLPreferences?>
---@field highlights table<integer, LLLHighlights?>
---@field undergrounds LLLUndergrounds? Initialized by the underground warning event library.
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

---@class LLLUndergrounds
---@field pending table<integer, LuaEntity>
---@field warnings table<integer, LLLUndergroundWarning?>
---@field alerts_dirty boolean
---@field hovering table<integer, integer?> Selected underground-mouth IDs; persistent for multiplayer load/join.
---@field validation_first integer?
---@field validation_last integer?
---@field validation_count integer
---@field validation_credit integer
---@field validation_peak integer
---@field validation_previous_peak integer
---@field validation_window_end integer

---@alias LLLUndergroundStyle "pulsing" | "steady"
---@alias LLLUndergroundOverlayMode LLLUndergroundStyle | "off"

---@class LLLUndergroundAudience
---@field mouths LuaPlayer[]
---@field hovering table<integer, integer?> Selected underground-mouth IDs for these viewers.

---@class LLLUndergroundRender
---@field entity LuaEntity
---@field sprite LuaRenderObject
---@field span LuaRenderObject[]? Only the input mouth owns the between-mouth arrows.
---@field neighbour LuaEntity?
---@field span_direction defines.direction?
---@field span_distance number?

---@class LLLUndergroundExterior
---@field entity LuaEntity Transport-belt position/surface are immutable while valid.
---@field x number Proven lookup point, not necessarily the entity's center.
---@field y number
---@field surface LuaSurface

---@class LLLUndergroundWarning:LLLUndergroundRender
---@field partner_id integer Both mouths retain the previous connection for relinking/removal events.
---@field force_index integer
---@field direction defines.direction
---@field belt_type "input"|"output"
---@field distance number
---@field exterior LLLUndergroundExterior Cached opposing-belt lookup, revalidated before reuse.
---@field steady LLLUndergroundRender? Created only while someone requests the steady overlay.
---@field validation_previous integer?
---@field validation_next integer?

---@class LLLStorage
---@field location_location_location LLLState
