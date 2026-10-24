---@meta
-- Type-only projection of the public API consumed by this product, not a runtime implementation.
-- https://github.com/JanSharp/inserter-throughput-lib/blob/2.1.0/readme.md
---@alias NoAltNeededCapacityTarget "inventory"|"ground"|"belt"|"linked-belt"|"underground"|"splitter"|"loader"

---@class NoAltNeededCapacityDefinition
---@field inserter {pickup_vector:{x:number,y:number},drop_vector:{x:number,y:number}}
---@field pickup {target_type:NoAltNeededCapacityTarget}
---@field drop {target_type:NoAltNeededCapacityTarget}

---@class NoAltNeededCapacityLibrary
---@field make_full_definition_for_inserter fun(entity:LuaEntity,reuse?:NoAltNeededCapacityDefinition):NoAltNeededCapacityDefinition
---@field is_belt_connectable_target_type fun(target:NoAltNeededCapacityTarget):boolean
---@field is_unreasonable_definition fun(definition:NoAltNeededCapacityDefinition):boolean
---@field estimate_inserter_speed fun(definition:NoAltNeededCapacityDefinition):number
---@field is_estimate fun(definition:NoAltNeededCapacityDefinition):boolean

return {} --[[@as NoAltNeededCapacityLibrary]]
