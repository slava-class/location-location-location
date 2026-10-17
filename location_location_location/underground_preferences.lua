local export = {
    alert_setting = "location_location_location_generate_underground_alerts",
    overlay_setting = "location_location_location_underground_overlay",
    default_mode = "pulsing",
    modes = { "pulsing", "steady", "off" },
}
---@param player LuaPlayer
---@return integer?
function export.hovered_mouth(player)
    local selected = player.selected
    if selected and selected.valid and selected.type == "underground-belt" then
        local id = selected.unit_number
        ---@cast id integer
        return id
    end
end

---@param force LuaForce
---@return table<LLLUndergroundStyle, LLLUndergroundAudience>
function export.audiences(force)
    ---@type table<LLLUndergroundStyle, LLLUndergroundAudience>
    local result = {
        pulsing = { mouths = {}, hovering = {} },
        steady = { mouths = {}, hovering = {} },
    }
    for _, player in pairs(force.players) do
        local mode = player.mod_settings[export.overlay_setting].value
        ---@cast mode LLLUndergroundOverlayMode
        if mode ~= "off" then
            local audience = result[mode]
            audience.mouths[#audience.mouths + 1] = player
            audience.hovering[player.index] = export.hovered_mouth(player)
        end
    end
    return result
end
---@param audience LLLUndergroundAudience
---@param first LuaEntity
---@param second LuaEntity
---@return LuaPlayer[]
function export.span_players(audience, first, second)
    if not next(audience.hovering) then
        return audience.mouths
    end
    local first_id, second_id = first.unit_number, second.unit_number
    for _, selected in pairs(audience.hovering) do
        if selected == first_id or selected == second_id then
            local players = {}
            for _, player in ipairs(audience.mouths) do
                local hovered = audience.hovering[player.index]
                if hovered ~= first_id and hovered ~= second_id then
                    players[#players + 1] = player
                end
            end
            return players
        end
    end
    return audience.mouths
end

return export
