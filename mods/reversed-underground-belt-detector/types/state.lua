---@meta

---@class RUBDState
---@field pending table<integer, LuaEntity>
---@field warnings table<integer, RUBDWarning?>
---@field alerts_dirty boolean
---@field hovering table<integer, integer?> Selected underground-mouth IDs; persistent for multiplayer load/join.
---@field managing table<integer, boolean> Cursor-tool state; ordinary cursor changes do not refresh the factory.
---@field validation_first integer?
---@field validation_last integer?
---@field validation_count integer
---@field validation_credit integer
---@field validation_peak integer
---@field validation_previous_peak integer
---@field validation_window_end integer

---@alias RUBDStyle "pulsing" | "steady"
---@alias RUBDOverlayMode RUBDStyle | "off"

---@class RUBDAudiences
---@field pulsing RUBDAudience
---@field steady RUBDAudience
---@field managers LuaPlayer[] Connected players holding the warning planner.

---@class RUBDAudience
---@field mouths LuaPlayer[]
---@field hovering table<integer, integer?> Selected underground-mouth IDs for these viewers.

---@class RUBDRender
---@field entity LuaEntity
---@field sprite LuaRenderObject
---@field span LuaRenderObject[]? Only the input mouth owns the between-mouth arrows.
---@field neighbour LuaEntity?
---@field span_direction defines.direction?
---@field span_distance number?

---@class RUBDExterior
---@field entity LuaEntity Transport-belt position/surface are immutable while valid.
---@field x number Proven lookup point, not necessarily the entity's center.
---@field y number
---@field surface LuaSurface

---@class RUBDWarning:RUBDRender
---@field partner_id integer Both mouths retain the previous connection for relinking/removal events.
---@field force_index integer
---@field direction defines.direction
---@field belt_type "input"|"output"
---@field distance number
---@field exterior RUBDExterior? Cached attached surface-belt lookup, revalidated before reuse.
---@field exterior_direction defines.direction? Snapshot of the relevant surface flow, not its mutable entity property.
---@field acknowledged boolean? Intentionally retained in validation until the arrangement changes.
---@field intentional_marker LuaRenderObject? Exists only while a force member holds the planner.
---@field steady RUBDRender? Created only while someone requests the steady overlay.
---@field validation_previous integer?
---@field validation_next integer?

---@class RUBDStorage
---@field reversed_underground_belt_detector RUBDState?
