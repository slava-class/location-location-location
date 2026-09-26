-- Remove 3.2.0's temporary rings and custom alerts before using native GUI arrows.
local root = storage.recipe_planner
if not root then return end
for index, state in pairs(root.highlights) do
    for _, object in ipairs(state.found) do if object.valid then object.destroy() end end
    local player = game.get_player(index)
    if player and state.find_message then
        player.remove_alert({type = defines.alert_type.custom, message = state.find_message})
    end
    state.found, state.find_message = nil, nil
end
