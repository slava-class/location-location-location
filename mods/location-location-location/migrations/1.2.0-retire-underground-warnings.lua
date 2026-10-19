-- Persistent one-time retirement for saves that used the embedded detector.
-- Keep this migration when later releases remove all other detector references.
---@class LLLRetiredUndergroundRender
---@field sprite LuaRenderObject
---@field span LuaRenderObject[]?
---@class LLLRetiredUndergroundWarning:LLLRetiredUndergroundRender
---@field steady LLLRetiredUndergroundRender?

---@param view LLLRetiredUndergroundRender
local function retire_render(view)
    if view.sprite.valid then
        view.sprite.destroy()
    end
    if view.span then
        for _, sprite in ipairs(view.span) do
            if sprite.valid then
                sprite.destroy()
            end
        end
    end
end

local legacy = storage.location_location_location
---@cast legacy {undergrounds: {warnings: table<integer, LLLRetiredUndergroundWarning>}?}?
if legacy and legacy.undergrounds then
    for _, warning in pairs(legacy.undergrounds.warnings) do
        retire_render(warning)
        if warning.steady then
            retire_render(warning.steady)
        end
    end
    legacy.undergrounds = nil
end

-- Actual installed 1.1.1–1.1.4 archives used the generic form; 1.1.5 onward
-- used the nested entrance/exit forms. Alert filters are alternatives: do not
-- add a broad type/position filter that would also remove unrelated alerts.
local messages = {
    { "location-location-location.reversed-underground" },
    { "location-location-location.reversed-underground", { "location-location-location.reversed-underground-input" } },
    { "location-location-location.reversed-underground", { "location-location-location.reversed-underground-output" } },
}
for _, player in pairs(game.players) do
    for _, message in ipairs(messages) do
        player.remove_alert({ message = message })
    end
end
