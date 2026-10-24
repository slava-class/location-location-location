local export = { name = "reversed-underground-belt-detector-warning-planner" }

---@param player LuaPlayer
---@return boolean
function export.held(player)
    local stack = player.cursor_stack
    return stack ~= nil and stack.valid_for_read and stack.name == export.name
end

---@param player LuaPlayer
function export.refresh_hint(player)
    local hint = player.gui.top[export.name]
    if export.held(player) then
        if not hint then
            hint = player.gui.top.add({ type = "frame", name = export.name, direction = "vertical" })
            hint.add({ type = "label", caption = { "item-name." .. export.name }, style = "caption_label" })
            local instructions =
                hint.add({ type = "label", caption = { "reversed-underground-belt-detector.planner-instructions" } })
            instructions.style.single_line = false
        end
    elseif hint then
        hint.destroy()
    end
end

function export.register()
    local utility = data.raw["utility-sprites"].default
    local belt = data.raw.item["underground-belt"]
    local function selection(color, cursor)
        return {
            border_color = color,
            cursor_box_type = cursor,
            mode = { "any-entity", "same-force" },
            entity_type_filters = { "underground-belt" },
        }
    end
    data:extend({
        {
            type = "selection-tool",
            name = export.name,
            hidden = true,
            flags = { "not-stackable", "only-in-cursor", "spawnable" },
            stack_size = 1,
            icon = belt.icon,
            icon_size = belt.icon_size,
            select = selection({ 0.3, 0.9, 0.7 }, "copy"),
            alt_select = selection({ 1, 0.65, 0.2 }, "not-allowed"),
            custom_tooltip_fields = {
                { order = 1, name = "", value = { "reversed-underground-belt-detector.planner-instructions" } },
            },
        },
        {
            type = "shortcut",
            name = export.name,
            action = "spawn-item",
            item_to_spawn = export.name,
            order = "b[underground-warnings]",
            icons = { { icon = utility.check_mark_white.filename, icon_size = 32, tint = { 0, 0, 0 } } },
            small_icons = {
                { icon = utility.check_mark_white.filename, icon_size = 32, scale = 0.5, tint = { 0, 0, 0 } },
            },
            localised_name = { "item-name." .. export.name },
            localised_description = { "item-description." .. export.name },
        },
    })
end

return export
