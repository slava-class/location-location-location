local entity_detection = {}

---Sorts entities according to their `LuaEntity.type` field. An example output might look like this:
---```lua
---{
---    ["lab"] = {lab_entity_1, lab_entity_2},
---    ["furnace"] = {furnace_entity_1, furnace_entity_2},
---    ["assembling-machine"] = {assembling_machine_entity_1, assembling_machine_entity_2}
---}
---```
---@param entities LuaEntity[]
---@return { [string]: LuaEntity[] }
entity_detection.sort_entities = function(entities)
    local result = {}
    for _, e in pairs(entities) do
        local entity_type
        local type = e.type
        if type == "entity-ghost" then
            entity_type = e.ghost_type
        else
            entity_type = type
        end

        if result[entity_type] == nil then result[entity_type] = {} end
        table.insert(result[entity_type], e)
    end
    return result
end

return entity_detection