-- Retire the original generator UI without destroying any chart tags it created.
local function destroy_gui(value)
    if type(value) ~= "table" and type(value) ~= "userdata" then return end
    if value.object_name == "LuaGuiElement" then
        if value.valid then value.destroy() end
        return
    end
    for _, child in pairs(value) do destroy_gui(child) end
end
if storage.player_table then
    for _, state in pairs(storage.player_table) do destroy_gui(state.gui) end
end
storage.player_table = nil
storage.restrict_deletion_for_all = nil

if storage.recipe_planner then
    storage.recipe_planner.preferences = {}
    storage.recipe_planner.highlights = {}
    for _, plan in pairs(storage.recipe_planner.plans) do plan.retired = false end
end
