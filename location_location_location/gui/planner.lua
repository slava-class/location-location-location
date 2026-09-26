local flib_gui = require("__flib__.gui")
local mod_gui = require("__core__.lualib.mod-gui")
local model = require("location_location_location.planner")
local recipes = require("location_location_location.recipes")
local sources = require("location_location_location.sources")
local picker = require("location_location_location.gui.recipe_picker")
local ui = require("location_location_location.gui.components")
local appearance = require("location_location_location.gui.appearance")
local gui = {}
local tool = "location_location_location_planner_tool"
local on_action, on_title, on_search, on_surface
local compact_content_width = 416
local message_styles = {info = "neutral_message_frame", error = "negative_message_frame"}

local function session(player) return storage.location_location_location.sessions[player.index] end
local function panel(children, width)
    return {type = "frame", style = "inside_shallow_frame", direction = "vertical",
        style_mods = {width = width, height = 480, padding = 0}, children = {
            {type = "flow", direction = "vertical", style_mods = {width = width, height = 480, vertical_spacing = 4}, children = children},
        }}
end
local function stop_selecting(player, s)
    s.selecting, s.selection_mode = nil, nil
    local cursor = player.cursor_stack
    if cursor and cursor.valid_for_read and cursor.name == tool then player.clear_cursor() end
end

local function set_compact(player, s, compact)
    if (s.compact == true) == compact then return end
    s.confirm_delete = nil
    s.compact = compact
    if compact and player.opened == s.gui.frame then player.opened = nil end
end

function gui.surface_name(surface)
    if not surface then return ui.caption("missing-surface") end
    if surface.platform then return surface.platform.name end
    if surface.planet then return surface.planet.prototype.localised_name end
    if surface.localised_name then return surface.localised_name end
    return surface.name
end

function gui.report(player, err, severity)
    local s = session(player)
    if s and s.gui.notice and s.gui.notice.valid then
        local width = s.gui.notice_panel.style.minimal_width
        s.gui.notice_panel.style = message_styles[severity]
        s.gui.notice_panel.style.width = width
        s.gui.notice_panel.style.height = 32
        s.gui.notice_panel.style.padding = {0, 4}
        s.gui.notice.caption, s.gui.notice_panel.visible = err, true
        s.gui.notice.tooltip = err
    end
end

local function view_draft_surface(player, s, position)
    local surface = game.surfaces[s.draft.surface_index]
    if not surface then gui.report(player, ui.caption("missing-surface"), "error"); return false end
    stop_selecting(player, s)
    set_compact(player, s, true)
    sources.clear(player.index)
    s.surface_index = surface.index
    player.set_controller({type = defines.controllers.remote, position = position, surface = surface})
    player.zoom = 1
    return true
end

local function notice(width)
    local dismiss = ui.icon(on_action, "dismiss_notice", "dismiss_notice", appearance.close_sprite, {"gui.close"})
    dismiss.style_mods = {size = 24, padding = 4}
    return {type = "frame", name = "notice_panel", style = "neutral_message_frame", visible = false,
        style_mods = {width = width, height = 32, padding = {0, 4}}, children = {
            {type = "flow", style_mods = {width = width - 16, height = 24, horizontal_spacing = 8, vertical_align = "center"}, children = {
                {type = "label", name = "notice", caption = "",
                    style_mods = {single_line = true, width = width - 48}},
                dismiss,
            }},
        }}
end

function gui.close(player)
    local s = session(player)
    if not s then return end
    storage.location_location_location.sessions[player.index] = nil
    if player.opened == s.gui.frame or player.opened == s.gui.picker_frame then player.opened = nil end
    if s.gui.picker_frame and s.gui.picker_frame.valid then s.gui.picker_frame.destroy() end
    if s.gui.frame.valid then s.gui.frame.destroy() end
    stop_selecting(player, s)
    sources.refresh(player)
end

function gui.toggle(player)
    if session(player) then gui.close(player) else gui.open(player) end
end

function gui.toolbar(player)
    local flow = mod_gui.get_button_flow(player)
    if flow.location_location_location_planner_button then return end
    flib_gui.add(flow, ui.icon(on_action, "location_location_location_planner_button", "toggle", "utility/map",
        ui.caption("open-tooltip"), nil, mod_gui.button_style))
end


local function ingredient_rows(s, compact)
    local draft = s.draft
    local recipe = draft.recipe and prototypes.recipe[draft.recipe]
    local rows = {}
    for index, ingredient in ipairs(draft.ingredients) do
        local prototype = prototypes[ingredient.type][ingredient.name]
        local count = table_size(ingredient.anchors)
        local active = s.selecting and s.selection_mode == "ingredient" and s.active_key == ingredient.key
        local select = ui.button(on_action, "select_"..index, "ingredient", ui.caption(active and "selected" or "select"), {key = ingredient.key})
        select.style_mods, select.toggled = {width = 96, height = 28, padding = {0, 8}}, active == true
        select.tooltip = ui.caption("instructions")
        local closest = ui.button(on_action, "closest_"..index, "closest", ui.caption("add-closest"), {key = ingredient.key})
        local find = ui.button(on_action, "find_"..index, "find", ui.caption("find-closest"), {key = ingredient.key})
        closest.style_mods, find.style_mods = {width = 96, height = 28}, {width = 96, height = 28}
        closest.enabled, find.enabled = recipe ~= nil and prototype ~= nil, recipe ~= nil and prototype ~= nil
        if compact then
            closest = ui.icon(on_action, "closest_"..index, "closest", "utility/add", nil, {key = ingredient.key})
            closest.style_mods, closest.enabled = {size = 28, padding = 2}, recipe ~= nil and prototype ~= nil
            find = ui.icon(on_action, "find_"..index, "find", "utility/search_icon", nil, {key = ingredient.key})
            find.style_mods, find.enabled = {size = 28, padding = 2}, recipe ~= nil and prototype ~= nil
        end
        closest.tooltip = ui.caption("add-closest-tooltip", ui.caption("add-closest"))
        find.tooltip = ui.caption("find-closest-tooltip", ui.caption("find-closest"))
        local clear = ui.icon(on_action, "clear_"..index, "clear", "utility/trash", ui.caption("clear"), {key = ingredient.key})
        clear.style_mods = {size = 28, padding = 2}
        rows[#rows + 1] = {type = "flow", style_mods = {minimal_width = compact and compact_content_width - 16 or 628,
            maximal_width = compact and compact_content_width or 644,
            horizontally_stretchable = true, height = 32, horizontal_spacing = 4, vertical_align = "center"}, children = {
            {type = "sprite-button", name = "ingredient_"..index, sprite = prototype and ingredient.type.."/"..ingredient.name or nil,
                style = appearance.slot_style(count > 0, false),
                style_mods = {size = 28},
                elem_tooltip = prototype and {type = ingredient.type, name = ingredient.name} or nil},
            {type = "label", caption = prototype and prototype.localised_name or ui.caption("missing-ingredient", ingredient.name),
                tooltip = prototype and prototype.localised_name or ingredient.name,
                style_mods = {width = compact and 100 or 164, single_line = true}},
            {type = "label", name = "source_count_"..index,
                caption = count == 0 and ui.caption("no-source") or ui.caption("source-count", count),
                style_mods = {width = compact and 60 or 80, single_line = true, horizontal_align = "right",
                    font_color = count == 0 and appearance.colors.warning or nil}},
            {type = "empty-widget", style_mods = {horizontally_stretchable = true}},
            select, closest, find, clear,
        }}
    end
    if #rows == 0 then rows[1] = {type = "label", caption = ui.caption("choose-recipe-hint"),
        style_mods = {font_color = appearance.colors.muted, top_margin = 4, single_line = false, maximal_width = compact and compact_content_width - 16 or 628}} end
    return rows
end

local function placement_controls(s, width)
    local move = ui.button(on_action, "move_marker", "move_marker", ui.caption("move-marker"))
    move.style_mods = {width = width - 32, height = 28}
    move.toggled = s.selecting and s.selection_mode == "marker" or false
    local reset = ui.button(on_action, "reset_marker", "reset_marker", ui.caption("reset-marker"))
    reset.style_mods = {width = width, height = 28}
    reset.enabled = s.draft.marker_position ~= nil
    local position = model.position(s.draft)
    local tooltip = position and {"", ui.caption("view-location"), "\n",
        ui.caption("position", string.format("%.1f", position.x), string.format("%.1f", position.y))} or ui.caption("view-location")
    local view = ui.icon(on_action, "view_location", "view_location", "utility/center", tooltip)
    view.style_mods = {size = 28, padding = 2}
    view.enabled = position ~= nil and game.surfaces[s.draft.surface_index] ~= nil
    return {type = "flow", direction = "vertical",
        style_mods = {vertical_spacing = 4, top_margin = s.compact and 8 or 0}, children = {
            {type = "flow", style_mods = {horizontal_spacing = 4}, children = {move, view}},
            reset,
        }}
end

local function draft_actions(player, draft, recipe)
    local changes = model.change_count(player, draft)
    local discard = ui.button(on_action, "discard", "discard", ui.caption("discard"), nil, "back_button")
    discard.enabled = changes > 0 or not draft.id
    local apply = ui.button(on_action, "apply", "apply", ui.caption("apply"), nil, "confirm_button")
    appearance.apply(apply, changes)
    apply.enabled = recipe ~= nil and game.surfaces[draft.surface_index] ~= nil
    return discard, apply
end


local function compact_body(player, s)
    local draft = s.draft
    local recipe = draft.recipe and prototypes.recipe[draft.recipe]
    local _, assigned, total = model.center(draft)
    local discard, apply = draft_actions(player, draft, recipe)
    local content = {
        {type = "flow", style_mods = {vertical_align = "center", horizontal_spacing = 4}, children = {
            {type = "sprite", name = "recipe", sprite = recipe and "recipe/"..recipe.name or nil, style_mods = {size = 28},
                elem_tooltip = recipe and {type = "recipe", name = recipe.name} or nil},
            {type = "label", name = "recipe_name", caption = draft.title == draft.recipe and recipe and recipe.localised_name or draft.title,
                tooltip = draft.title, elem_tooltip = recipe and {type = "recipe", name = recipe.name} or nil,
                style = "heading_2_label", style_mods = {left_margin = 4, width = compact_content_width - 160, single_line = true}},
            {type = "label", name = "status", caption = ui.caption("assigned", assigned, total),
                style_mods = {width = 120, single_line = true, horizontal_align = "right",
                    font_color = assigned == 0 and appearance.colors.warning or appearance.colors.muted}},
        }},
        {type = "scroll-pane", name = "ingredients", direction = "vertical", style = "naked_scroll_pane",
            horizontal_scroll_policy = "never", style_mods = {width = compact_content_width, height = math.min(6, math.max(1, #draft.ingredients)) * 32, padding = 0},
            children = {{type = "flow", direction = "vertical", style_mods = {vertical_spacing = 0, horizontally_stretchable = true},
                children = ingredient_rows(s, true)}}},
        notice(compact_content_width),
        placement_controls(s, compact_content_width),
        {type = "label", name = "selection_hint", caption = ui.caption("pick-machine"),
            visible = s.selecting == true and s.selection_mode == "machine",
            style_mods = {width = compact_content_width, single_line = false}},
    }
    return {
        {type = "frame", style = "inside_shallow_frame", direction = "vertical",
            style_mods = {width = compact_content_width + 16, padding = 8}, children = content},
        ui.footer("frame", {discard}, apply),
    }
end

local function minimap_view(draft, marker)
    local left, right, top, bottom = marker.x, marker.x, marker.y, marker.y
    for _, ingredient in ipairs(draft.ingredients) do
        for _, anchor in pairs(ingredient.anchors) do
            left, right = math.min(left, anchor.x), math.max(right, anchor.x)
            top, bottom = math.min(top, anchor.y), math.max(bottom, anchor.y)
        end
    end
    -- Minimap zoom is pixels per tile; include source-ring room and a 16-pixel edge inset.
    local span = math.max(right - left, bottom - top)
    return {x = (left + right) / 2, y = (top + bottom) / 2}, math.min(4, (212 - 32) / (span + 8))
end

local function editor_body(player, s)
    local draft = s.draft
    local recipe = draft.recipe and prototypes.recipe[draft.recipe]
    local position, assigned, total = model.position(draft)
    local recipe_button = ui.icon(on_action, "recipe", "recipes", recipe and "recipe/"..draft.recipe or "utility/add",
        ui.caption("choose-recipe"), nil, recipe and "slot_button" or "item_and_count_select_confirm")
    recipe_button.style_mods = {size = recipe and 40 or 32, padding = recipe and 1 or 4, top_margin = 0}
    if recipe then recipe_button.elem_tooltip = {type = "recipe", name = recipe.name} end
    local rows = ingredient_rows(s, false)
    local machine = ui.button(on_action, "machine", "machine", ui.caption("from-machine"))
    machine.style_mods = {width = 152}
    local left = {
        ui.subheader(ui.caption("recipe")),
        {type = "flow", style_mods = {width = 644, height = 40, left_margin = 8, right_margin = 8, vertical_align = "center", horizontal_spacing = 8}, children = {
            recipe_button,
            {type = "label", name = "recipe_name", caption = recipe and recipe.localised_name or ui.caption(draft.recipe and "missing-recipe" or "choose-recipe"),
                tooltip = recipe and recipe.localised_name or nil,
                elem_tooltip = recipe and {type = "recipe", name = recipe.name} or nil,
                style_mods = {maximal_width = 424, single_line = true}},
            {type = "empty-widget", style_mods = {horizontally_stretchable = true}},
            machine,
        }},
        {type = "flow", style_mods = {width = 644, left_margin = 8, right_margin = 8, bottom_margin = 4, vertical_align = "center", horizontal_spacing = 4}, children = {
            {type = "label", caption = ui.caption("name"), style_mods = {width = 40}},
            {type = "textfield", name = "title", text = draft.title, enabled = not draft.hide_label,
                style_mods = {minimal_width = 200, maximal_width = 0, horizontally_stretchable = true},
                handler = {[defines.events.on_gui_text_changed] = on_title}},
            {type = "checkbox", name = "hide_label", caption = ui.caption("no-label"), state = draft.hide_label == true,
                tooltip = ui.caption("no-label-tooltip"), tags = {action = "hide_label"},
                style_mods = {left_margin = 8, right_margin = 4},
                handler = {[defines.events.on_gui_checked_state_changed] = on_action}},
        }},
        ui.subheader(ui.caption("ingredients"), {
            {type = "label", name = "status", caption = ui.caption("assigned", assigned, total),
                style_mods = {right_margin = 8, font_color = assigned == 0 and appearance.colors.warning or appearance.colors.muted}},
        }),
        {type = "frame", style = "inside_deep_frame", style_mods = {width = 660, height = 320, padding = 0}, children = {
            {type = "flow", direction = "vertical", style_mods = {width = 660, height = 320, vertical_spacing = 0}, children = {
                {type = "scroll-pane", name = "ingredients", direction = "vertical", style = "naked_scroll_pane",
                    horizontal_scroll_policy = "never",
                    style_mods = {minimal_height = 32, vertically_stretchable = true, width = 660, padding = {4, 8}},
                    children = {{type = "flow", direction = "vertical",
                        style_mods = {vertical_spacing = 0, horizontally_stretchable = true}, children = rows}}},
                notice(660),
            }},
        }},
    }
    local preview = {
        {type = "label", name = "surface", caption = gui.surface_name(game.surfaces[draft.surface_index]),
            style = "heading_2_label", style_mods = {single_line = true, width = 212}},
    }
    if position and game.surfaces[draft.surface_index] then
        local center, zoom = minimap_view(draft, position)
        preview[#preview + 1] = {type = "minimap", name = "preview", position = center,
            surface_index = draft.surface_index, chart_player_index = player.index, zoom = zoom,
            tooltip = draft.title, style_mods = {width = 212, height = 212}}
    else
        preview[#preview + 1] = {type = "label", caption = ui.caption("no-anchors"),
            style_mods = {single_line = false, width = 212}}
    end
    preview[#preview + 1] = placement_controls(s, 212)
    preview[#preview + 1] = {type = "label", name = "selection_hint",
        caption = ui.caption("pick-machine"),
        style_mods = {single_line = false, width = 212}, visible = s.selecting == true and s.selection_mode == "machine"}
    if draft.retired then preview[#preview + 1] = {type = "label", caption = ui.caption("retired")} end
    local right = {ui.subheader(ui.caption("tag-location")),
        {type = "flow", direction = "vertical", style_mods = {margin = {0, 8, 8, 8}, vertical_spacing = 4}, children = preview}}
    local discard, apply = draft_actions(player, draft, recipe)
    return {
        {type = "flow", direction = "horizontal", style_mods = {horizontal_spacing = 12}, children = {panel(left, 660), panel(right, 228)}},
        ui.footer("frame", {discard}, apply),
    }
end

local function navigation(player, s)
    local preferences = model.preferences(player)
    local plans = model.list(player, true)
    local indices = {[player.surface_index] = true, [s.view_surface_index] = true}
    for _, plan in ipairs(plans) do indices[plan.surface_index] = true end
    s.surface_choices = {}
    for index in pairs(indices) do s.surface_choices[#s.surface_choices + 1] = index end
    table.sort(s.surface_choices)
    local items, selected = {}, 1
    for index, surface_index in ipairs(s.surface_choices) do
        local surface = game.surfaces[surface_index]
        items[index] = surface and gui.surface_name(surface) or {"", ui.caption("missing-surface"), " (", surface_index, ")"}
        if surface_index == s.view_surface_index then selected = index end
    end
    local layout = appearance.navigation
    local visible_plans = {}
    for _, plan in ipairs(plans) do
        if plan.surface_index == s.view_surface_index and (preferences.show_retired or not plan.retired) then
            visible_plans[#visible_plans + 1] = plan
        end
    end
    local scrolling = #visible_plans * appearance.row.height > layout.list_height - 2 * layout.padding
    local row_width = layout.width - 2 * layout.padding - (scrolling and layout.scrollbar_width or 0)
    local rows = {}
    for _, plan in ipairs(visible_plans) do
        local _, assigned, total = model.center(plan)
        local recipe = prototypes.recipe[plan.recipe]
        local title = recipe and plan.title == plan.recipe and recipe.localised_name or plan.title
        local selected_plan = s.draft ~= nil and s.draft.id == plan.id
        local text = {"", recipe and "[img=recipe/"..plan.recipe.."] " or "",
            plan.retired and {"", ui.caption("retired"), ": "} or "", title}
        local open = ui.recipe_tag_row(on_action, plan.id, text, {"", assigned, "/", total}, selected_plan, plan.retired, row_width)
        open.tooltip = {"", title, "\n", ui.caption("status", assigned, total)}
        rows[#rows + 1] = open
    end
    if #rows == 0 then rows[1] = {type = "label", caption = ui.caption("empty"), style_mods = {margin = 8}} end
    local new = ui.icon(on_action, "new", "new", "utility/add", ui.caption("new"), nil, "item_and_count_select_confirm")
    new.style_mods = {padding = 2, top_margin = 0}
    new.enabled = s.view_surface_index == player.surface_index
    if not new.enabled then new.tooltip = ui.caption("new-on-current-surface") end
    local draft = s.draft
    local retire = ui.icon(on_action, "retire", "retire",
        draft and draft.retired and "utility/export_slot" or "utility/import_slot",
        ui.caption(draft and draft.retired and "reactivate" or "retire"),
        draft and {id = draft.id, revision = draft.revision, retired = not draft.retired} or {})
    retire.enabled = draft ~= nil and draft.id ~= nil
    local show_retired = ui.icon(on_action, "show_retired", "show_retired", "location_location_location_show_retired",
        ui.caption("show-retired"))
    show_retired.toggled = preferences.show_retired
    local delete = ui.button(on_action, "delete", "delete", nil)
    appearance.delete(delete, s.confirm_delete == true)
    delete.enabled = draft ~= nil and draft.id ~= nil
    local back = ui.icon(on_action, "back", "list", "utility/list_view", ui.caption("back-to-plans"))
    back.enabled = draft ~= nil
    local cancel_delete = ui.icon(on_action, "cancel_delete", "cancel_delete", appearance.close_sprite, ui.caption("cancel-delete"))
    cancel_delete.style_mods = {width = 24, height = 28, padding = 4}
    cancel_delete.visible = s.confirm_delete == true
    return {type = "frame", style = "inside_deep_frame", direction = "vertical",
        style_mods = {width = layout.width, height = layout.height, padding = 0}, children = {
            ui.subheader(ui.caption("surface"), {
                {type = "drop-down", name = "surface_selector", items = items, selected_index = selected,
                    style_mods = {width = 164}, handler = {[defines.events.on_gui_selection_state_changed] = on_surface}},
            }),
            {type = "frame", style = "subheader_frame", style_mods = {width = layout.width, height = 36}, children = {
                new, {type = "flow", style_mods = {horizontal_spacing = 0}, children = {delete, cancel_delete}},
                {type = "empty-widget", style_mods = {horizontally_stretchable = true}},
                retire, show_retired, back,
            }},
            {type = "scroll-pane", name = "plans", direction = "vertical", style = "naked_scroll_pane", horizontal_scroll_policy = "never",
                vertical_scroll_policy = scrolling and "always" or "never",
                style_mods = {height = layout.list_height, width = layout.width, padding = layout.padding},
                children = {{type = "flow", direction = "vertical", style_mods = {vertical_spacing = 0}, children = rows}}},
        }}
end

local function workspace(player, s)
    if s.compact and s.draft then return compact_body(player, s) end
    local content
    if s.draft then content = editor_body(player, s)
    else
        content = {{type = "frame", style = "inside_deep_frame", direction = "vertical",
            style_mods = {width = 900, height = 524, padding = 12}, children = {
                {type = "label", style = "heading_2_label", caption = ui.caption("plans")},
                {type = "label", caption = ui.caption("choose-plan"), style_mods = {single_line = false, maximal_width = 700}},
                {type = "empty-widget", style_mods = {vertically_stretchable = true}},
                notice(876),
            }}}
    end
    return {{type = "flow", style_mods = {horizontal_spacing = 12}, children = {
        navigation(player, s),
        {type = "flow", direction = "vertical", style_mods = {vertical_spacing = 8}, children = content},
    }}}
end

function gui.render(player)
    local s = session(player)
    if not s then return end
    local old = s.gui
    local picker_location
    if old.picker_frame and old.picker_frame.valid then
        picker_location = old.picker_frame.location
        old.picker_frame.destroy()
    end
    old.body.clear()
    old.frame.enabled = true
    s.gui = {frame = old.frame, body = old.body, close = old.close, highlights = old.highlights, pin = old.pin}
    flib_gui.add(s.gui.body, workspace(player, s), s.gui)
    if s.gui.plans and s.draft and s.draft.id and s.gui["plan_"..s.draft.id] then
        s.gui.plans.scroll_to_element(s.gui["plan_"..s.draft.id])
    end
    local opened = s.gui.frame
    if s.picker then
        local body, actions = picker.body(player, s, on_action, on_search)
        body[1].children[#body[1].children + 1] = notice(426)
        actions[#actions + 1] = ui.icon(on_action, "picker_highlights", "highlights", "location_location_location_highlight_sources_white",
            ui.caption("highlight-sources"), nil, "frame_action_button")
        actions[#actions + 1] = ui.icon(on_action, "picker_close", "close", "utility/close", {"gui.close-instruction"}, nil, "frame_action_button")
        flib_gui.add(player.gui.screen, ui.window("location_location_location_picker_frame",
            ui.caption(s.picker.product and "choose-recipe" or "choose-product"), actions,
            {type = "flow", direction = "vertical", style_mods = {vertical_spacing = 8}, children = body}), s.gui)
        s.gui.picker_frame = s.gui.location_location_location_picker_frame
        s.gui.location_location_location_picker_frame = nil
        if picker_location then s.gui.picker_frame.location = picker_location else s.gui.picker_frame.force_auto_center() end
        s.gui.frame.enabled = false
        appearance.toggle(s.gui.picker_highlights, model.preferences(player).highlight_sources)
        picker.refresh(player, s)
        opened = s.gui.picker_frame
    end
    appearance.toggle(s.gui.highlights, model.preferences(player).highlight_sources)
    s.gui.pin.enabled = s.compact == true or (s.draft ~= nil and s.draft.recipe ~= nil and prototypes.recipe[s.draft.recipe] ~= nil)
    appearance.toggle(s.gui.pin, s.compact == true)
    s.gui.pin.tooltip = ui.caption(not s.gui.pin.enabled and "pin-unavailable" or s.compact and "expand" or "pin")
    s.gui.close.tooltip = {(s.compact or s.selecting) and "gui.close" or "gui.close-instruction"}
    sources.refresh(player)
    if not s.selecting and not s.compact and player.opened ~= opened then player.opened = opened end
end

function gui.open(player)
    if session(player) then gui.close(player) end
    local refs = flib_gui.add(player.gui.screen, ui.window("location_location_location_frame", ui.caption("window"), {
        ui.icon(on_action, "highlights", "highlights", "location_location_location_highlight_sources_white", ui.caption("highlight-sources"), nil, "frame_action_button"),
        ui.icon(on_action, "close", "close", "utility/close", {"gui.close-instruction"}, nil, "frame_action_button"),
    }, {type = "flow", name = "body", direction = "vertical", style_mods = {vertical_spacing = 12}},
        ui.icon(on_action, "pin", "compact", "utility/track_button_white", ui.caption("pin"), nil, "frame_action_button")))
    storage.location_location_location.sessions[player.index] = {gui = {frame = refs.location_location_location_frame, body = refs.body,
        close = refs.close, highlights = refs.highlights, pin = refs.pin},
        force_index = player.force.index, surface_index = player.surface_index, view_surface_index = player.surface_index}
    gui.render(player)
    refs.location_location_location_frame.force_auto_center()
end

function gui.toggle_highlights(player)
    sources.toggle(player)
    local s = session(player)
    if not s then return end
    local enabled = model.preferences(player).highlight_sources
    appearance.toggle(s.gui.highlights, enabled)
    if s.gui.picker_highlights then appearance.toggle(s.gui.picker_highlights, enabled) end
end

function gui.activate(player, mode, key)
    local s = session(player)
    if not s or not s.draft then return end
    if s.selecting and s.selection_mode == mode and s.active_key == key then
        stop_selecting(player, s)
        gui.render(player)
        return
    end
    if not player.cursor_stack or not player.clear_cursor() then gui.report(player, ui.caption("cursor-full"), "error"); return end
    if player.surface_index ~= s.draft.surface_index and not view_draft_surface(player, s, model.position(s.draft)) then return end
    player.cursor_stack.set_stack({name = tool})
    s.selection_mode, s.selecting, s.active_key, s.picker = mode, true, key, nil
    if player.opened == s.gui.frame or player.opened == s.gui.picker_frame then player.opened = nil end
    gui.render(player)
end

function gui.choose_recipe(player, name)
    local s = session(player)
    if not s or not s.draft then return end
    local ok, err = model.set_recipe(s.draft, name)
    if not ok then gui.report(player, err, "error"); return end
    stop_selecting(player, s)
    s.active_key, s.confirm_delete, s.picker = nil, nil, nil
    gui.render(player)
end

function gui.refresh_picker(player)
    local s = session(player)
    if s and s.picker then s.picker.catalog = recipes.catalog(player); gui.render(player) end
end

on_title = function(e)
    local s = storage.location_location_location.sessions[e.player_index]
    if not s or not s.draft then return end
    s.draft.title = e.element.text
    local changes = model.change_count(game.get_player(e.player_index), s.draft)
    appearance.apply(s.gui.apply, changes)
    s.gui.discard.enabled = changes > 0 or not s.draft.id
    if s.confirm_delete then
        s.confirm_delete = nil
        appearance.delete(s.gui.delete, false)
        s.gui.cancel_delete.visible = false
    end
end
on_search = function(e)
    local player = game.get_player(e.player_index)
    local s = session(player)
    if not s or not s.picker then return end
    s.picker.query = e.element.text
    picker.refresh(player, s)
end

function gui.focus_search(player)
    local s = session(player)
    if not s or not s.picker then return end
    s.gui.search.focus()
    s.gui.search.select_all()
end

on_surface = function(e)
    local player = game.get_player(e.player_index)
    local s = session(player)
    if not s then return end
    local index = s.surface_choices[e.element.selected_index]
    if not index then return end
    stop_selecting(player, s)
    s.view_surface_index = index
    s.draft, s.active_key, s.confirm_delete, s.picker = nil, nil, nil, nil
    gui.render(player)
end

on_action = function(e)
    local player = game.get_player(e.player_index)
    local tags = e.element.tags
    local action = tags.action
    if action == "toggle" then gui.toggle(player); return end
    local s = session(player)
    if not s then return end
    s.gui.notice_panel.visible = false
    if action == "dismiss_notice" then return end
    if action == "close" then gui.close(player); return end
    if action == "discard" then
        local restored, err
        if s.draft and s.draft.id then restored, err = model.load(player, s.draft.id) end
        stop_selecting(player, s)
        s.draft, s.picker, s.active_key, s.confirm_delete = restored, nil, nil, nil
        if restored then s.view_surface_index = restored.surface_index
        else set_compact(player, s, false) end
        gui.render(player)
        if err then gui.report(player, err, "error") end
        return
    end
    if action == "highlights" then gui.toggle_highlights(player); return end
    if action == "compact" then
        stop_selecting(player, s)
        set_compact(player, s, not s.compact)
        gui.render(player)
        return
    end
    if action == "view_location" then
        local position = model.position(s.draft)
        if not position then gui.report(player, ui.caption("no-anchors"), "info"); return end
        if not view_draft_surface(player, s, position) then return end
        gui.render(player)
        return
    end
    if action == "new" then
        if s.view_surface_index ~= player.surface_index then gui.report(player, ui.caption("new-on-current-surface"), "error"); return end
        stop_selecting(player, s)
        s.draft, s.active_key, s.confirm_delete, s.picker = model.new(player), nil, nil, nil
    end
    if action == "new" or action == "recipes" then
        stop_selecting(player, s)
        s.picker = picker.open(player)
        gui.render(player); s.gui.search.focus(); return
    end
    if action == "show_retired" then
        local preferences = model.preferences(player)
        preferences.show_retired = not preferences.show_retired
    elseif action == "list" then
        stop_selecting(player, s)
        s.draft, s.active_key, s.confirm_delete, s.picker = nil, nil, nil, nil
    elseif action == "open" then
        local draft, err = model.load(player, tags.id)
        if not draft then gui.report(player, err, "error"); return end
        stop_selecting(player, s)
        s.draft, s.active_key, s.confirm_delete, s.picker = draft, nil, nil, nil
        s.view_surface_index = draft.surface_index
    elseif action == "editor" then s.picker = nil
    elseif action == "choose_recipe" then
        if model.preferences(player).researched_only and not recipes.unlocked(player.force)[tags.recipe] then
            gui.refresh_picker(player); gui.report(player, ui.caption("unresearched"), "error"); return
        end
        gui.choose_recipe(player, tags.recipe); return
    elseif action == "picker_search" then gui.focus_search(player); return
    elseif action == "picker_group" then
        s.picker.group, model.preferences(player).picker_group = tags.group, tags.group
        picker.refresh(player, s); return
    elseif action == "picker_unresearched" then
        local preferences = model.preferences(player)
        preferences.researched_only = not preferences.researched_only
        picker.refresh(player, s); return
    elseif action == "picker_product" then
        s.picker.catalog = recipes.catalog(player)
        local choices = recipes.choices(s.picker.catalog, tags.product, model.preferences(player).researched_only)
        if #choices == 1 then gui.choose_recipe(player, choices[1].name); return end
        s.picker.product, s.picker.product_query = tags.product, s.picker.query
        s.picker.query = ""
    elseif action == "picker_products" then
        s.picker.product, s.picker.query = nil, s.picker.product_query
        s.picker.product_query = nil
    elseif action == "machine" then gui.activate(player, "machine"); return
    elseif action == "ingredient" then gui.activate(player, "ingredient", tags.key); return
    elseif action == "move_marker" then gui.activate(player, "marker"); return
    elseif action == "reset_marker" then
        stop_selecting(player, s)
        s.draft.marker_position = nil
    elseif action == "closest" or action == "find" then
        if player.surface_index ~= s.draft.surface_index then
            if not view_draft_surface(player, s, model.position(s.draft)) then return end
            gui.render(player)
        end
        local entity, err, severity = sources.closest(player, s.draft, tags.key)
        if not entity then gui.report(player, err, severity); return end
        if action == "find" then sources.find(player, entity); return end
        model.select(s.draft, tags.key, {entity}, "add", s.draft.surface_index)
        s.confirm_delete = nil
    elseif action == "clear" then
        local ingredient = model.ingredient(s.draft, tags.key)
        if ingredient then ingredient.anchors = {} end
        s.confirm_delete = nil
    elseif action == "hide_label" then
        s.draft.hide_label, s.confirm_delete = e.element.state, nil
    elseif action == "cancel_delete" then
        s.confirm_delete = nil
    elseif action == "apply" then
        local saved, err = model.apply(player, s.draft)
        if not saved then gui.report(player, err, "error"); return end
        s.draft, s.confirm_delete = saved, nil
        stop_selecting(player, s)
        sources.refresh_force(saved.force_index)
    elseif action == "retire" then
        local draft, err = model.load(player, tags.id)
        if not draft then gui.report(player, err, "error"); return end
        draft.revision = tags.revision
        local revision
        revision, err = model.retire(player, draft, tags.retired)
        if not revision then gui.report(player, err, "error"); return end
        if s.draft and s.draft.id == draft.id then s.draft.revision, s.draft.retired = revision, tags.retired end
        sources.refresh_force(player.force.index)
    elseif action == "delete" then
        if not s.draft or not s.draft.id then return end
        if not s.confirm_delete then s.confirm_delete = true
        else
            local ok, err = model.delete(player, s.draft)
            if not ok then gui.report(player, err, "error"); return end
            stop_selecting(player, s)
            s.draft, s.active_key, s.confirm_delete = nil, nil, nil
            sources.refresh_force(player.force.index)
        end
    end
    gui.render(player)
end

flib_gui.add_handlers({planner_action = on_action, planner_title = on_title, planner_search = on_search,
    planner_surface = on_surface})
return gui
