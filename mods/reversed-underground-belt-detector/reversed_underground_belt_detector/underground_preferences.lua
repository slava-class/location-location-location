local planner = require("reversed_underground_belt_detector.warning_planner")
local export = {
    alert_setting = "reversed_underground_belt_detector_alerts",
    overlay_setting = "reversed_underground_belt_detector_overlay",
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
---@return RUBDAudiences
function export.audiences(force)
    ---@type RUBDAudiences
    local result = {
        pulsing = { mouths = {}, hovering = {} },
        steady = { mouths = {}, hovering = {} },
        managers = {},
    }
    for _, player in pairs(force.players) do
        local managing = player.connected and planner.held(player)
        local mode = player.mod_settings[export.overlay_setting].value
        ---@cast mode RUBDOverlayMode
        if managing then
            result.managers[#result.managers + 1] = player
            mode = "steady"
        end
        if mode ~= "off" then
            local audience = result[mode]
            audience.mouths[#audience.mouths + 1] = player
            audience.hovering[player.index] = export.hovered_mouth(player)
        end
    end
    return result
end
---@param audience RUBDAudience
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
