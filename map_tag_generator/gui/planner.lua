local flib_gui = require("__flib__.gui")
local mod_gui = require("__core__.lualib.mod-gui")
local model = require("map_tag_generator.planner")
local recipes = require("map_tag_generator.recipes")
local sources = require("map_tag_generator.sources")
local picker = require("map_tag_generator.gui.recipe_picker")
local ui = require("map_tag_generator.gui.components")
local gui = {}
local tool = "map_tag_generator_planner_tool"
local on_action, on_title, on_search, on_surface

local function session(player) return storage.recipe_planner.sessions[player.index] end
local function panel(children, width)
    return {type = "frame", style = "inside_shallow_frame", direction = "vertical",
        style_mods = {width = width, height = 480, padding = 0}, children = {
            {type = "flow", direction = "vertical", style_mods = {width = width, height = 480, vertical_spacing = 4}, children = children},
        }}
end
local function stop_selecting(player, s)
    s.selecting, s.pick_machine = nil, nil
    local cursor = player.cursor_stack
    if cursor and cursor.valid_for_read and cursor.name == tool then player.clear_cursor() end
end

function gui.surface_name(surface)
    if not surface then return ui.caption("missing-surface") end
    if surface.platform then return surface.platform.name end
    if surface.planet then return surface.planet.prototype.localised_name end
    if surface.localised_name then return surface.localised_name end
    return surface.name
end

function gui.report(player, err)
    local s = session(player)
    if s and s.gui.notice and s.gui.notice.valid then
        s.gui.notice.caption, s.gui.notice_panel.visible = err, true
        s.gui.notice.tooltip = err
    end
end

local function notice(width)
    local dismiss = ui.icon(on_action, "dismiss_notice", "dismiss_notice", "utility/close", {"gui.close"})
    dismiss.style_mods = {size = 24, padding = 2}
    return {type = "frame", name = "notice_panel", style = "inside_shallow_frame", visible = false,
        style_mods = {width = width, height = 32, padding = {4, 8}}, children = {
            {type = "flow", style_mods = {width = width - 16, height = 24, horizontal_spacing = 8, vertical_align = "center"}, children = {
                {type = "label", name = "notice", caption = "",
                    style_mods = {single_line = true, width = width - 48, font_color = {1, 0.6, 0.3}}},
                dismiss,
            }},
        }}
end

function gui.close(player)
    local s = session(player)
    if not s then return end
    storage.recipe_planner.sessions[player.index] = nil
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
    if flow.map_tag_generator_planner_button then return end
    flib_gui.add(flow, ui.icon(on_action, "map_tag_generator_planner_button", "toggle", "map_tag_generator_planner_icon",
        ui.caption("open-tooltip"), nil, mod_gui.button_style))
end


local function editor_body(player, s)
    local draft = s.draft
    local recipe = draft.recipe and prototypes.recipe[draft.recipe]
    local position, assigned, total = model.center(draft)
    local recipe_button = ui.icon(on_action, "recipe", "recipes", recipe and "recipe/"..draft.recipe or "utility/add",
        ui.caption("choose-recipe"), nil, recipe and "slot_button" or "item_and_count_select_confirm")
    recipe_button.style_mods = {size = recipe and 40 or 32, padding = recipe and 1 or 6, top_margin = 0}
    if recipe then recipe_button.elem_tooltip = {type = "recipe", name = recipe.name} end
    local rows = {}
    for index, ingredient in ipairs(draft.ingredients) do
        local prototype = prototypes[ingredient.type][ingredient.name]
        local count = table_size(ingredient.anchors)
        local active = s.selecting and s.active_key == ingredient.key
        local select = ui.button(on_action, "select_"..index, "ingredient", ui.caption(active and "selected" or "select"), {key = ingredient.key})
        select.style_mods, select.toggled = {width = 96, height = 28, padding = {0, 8}}, active == true
        local closest = ui.button(on_action, "closest_"..index, "closest", ui.caption("add-closest"), {key = ingredient.key})
        local find = ui.button(on_action, "find_"..index, "find", ui.caption("find-closest"), {key = ingredient.key})
        closest.style_mods, find.style_mods = {width = 96, height = 28}, {width = 96, height = 28}
        closest.enabled, find.enabled = recipe ~= nil and prototype ~= nil, recipe ~= nil and prototype ~= nil
        rows[#rows + 1] = {type = "flow", style_mods = {minimal_width = 628, maximal_width = 644,
            horizontally_stretchable = true, height = 32, horizontal_spacing = 4, vertical_align = "center"}, children = {
            {type = "sprite-button", sprite = prototype and ingredient.type.."/"..ingredient.name or nil,
                style = count == 0 and "flib_slot_button_yellow" or "slot_button",
                style_mods = {size = 28}, ignored_by_interaction = true},
            {type = "label", caption = prototype and prototype.localised_name or ui.caption("missing-ingredient", ingredient.name),
                tooltip = prototype and prototype.localised_name or ingredient.name,
                style_mods = {width = 164, single_line = true}},
            {type = "label", name = "source_count_"..index,
                caption = count == 0 and ui.caption("no-source") or ui.caption("source-count", count),
                style_mods = {width = 80, single_line = true, font_color = count == 0 and {1, 0.75, 0.35} or nil}},
            {type = "empty-widget", style_mods = {horizontally_stretchable = true}},
            select, closest, find,
            ui.icon(on_action, "clear_"..index, "clear", "utility/trash", ui.caption("clear"), {key = ingredient.key}),
        }}
    end
    if #rows == 0 then rows[1] = {type = "label", caption = ui.caption("choose-recipe-hint"),
        style_mods = {font_color = {0.65, 0.65, 0.65}, top_margin = 4, single_line = false, maximal_width = 628}} end
    local machine = ui.button(on_action, "machine", "machine", ui.caption("from-machine"))
    machine.style_mods = {width = 152}
    local left = {
        ui.subheader(ui.caption("recipe")),
        {type = "flow", style_mods = {width = 644, height = 40, left_margin = 8, right_margin = 8, vertical_align = "center", horizontal_spacing = 8}, children = {
            recipe_button,
            {type = "label", caption = recipe and recipe.localised_name or ui.caption(draft.recipe and "missing-recipe" or "choose-recipe"),
                tooltip = recipe and recipe.localised_name or nil,
                style_mods = {maximal_width = 424, single_line = true}},
            {type = "empty-widget", style_mods = {horizontally_stretchable = true}},
            machine,
        }},
        {type = "flow", style_mods = {width = 644, left_margin = 8, right_margin = 8, bottom_margin = 4, vertical_align = "center", horizontal_spacing = 4}, children = {
            {type = "label", caption = ui.caption("name"), style_mods = {width = 40}},
            {type = "textfield", name = "title", text = draft.title, style_mods = {width = 600},
                handler = {[defines.events.on_gui_text_changed] = on_title}},
        }},
        ui.subheader(ui.caption("ingredients")),
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
        preview[#preview + 1] = {type = "minimap", name = "preview", position = position,
            surface_index = draft.surface_index, chart_player_index = player.index,
            tooltip = draft.title, style_mods = {width = 212, height = 212}}
        preview[#preview + 1] = {type = "label", caption = ui.caption("position", string.format("%.1f", position.x), string.format("%.1f", position.y)),
            style_mods = {single_line = false, width = 212, top_margin = 4}}
    else
        preview[#preview + 1] = {type = "label", caption = ui.caption("no-anchors"),
            style_mods = {single_line = false, width = 212}}
    end
    preview[#preview + 1] = {type = "line", style_mods = {horizontally_stretchable = true, top_margin = 4}}
    preview[#preview + 1] = {type = "label", name = "status", caption = ui.caption("status", assigned, total),
        style_mods = {single_line = false, width = 212}}
    preview[#preview + 1] = {type = "label", name = "selection_hint",
        caption = ui.caption(s.pick_machine and "pick-machine" or "instructions"),
        style_mods = {single_line = false, width = 212}, visible = s.selecting == true}
    if draft.retired then preview[#preview + 1] = {type = "label", caption = ui.caption("retired")} end
    local right = {ui.subheader(ui.caption("preview")),
        {type = "flow", direction = "vertical", style_mods = {margin = {0, 8, 8, 8}, vertical_spacing = 4}, children = preview}}
    local apply = ui.button(on_action, "apply", "apply", ui.caption("apply"), nil, "confirm_button")
    apply.enabled = position ~= nil and recipe ~= nil and game.surfaces[draft.surface_index] ~= nil
    return {
        {type = "flow", direction = "horizontal", style_mods = {horizontal_spacing = 12}, children = {panel(left, 660), panel(right, 228)}},
        ui.footer("frame", {ui.button(on_action, "cancel", "close", {"gui-mod-settings.cancel"}, nil, "back_button")}, apply,
            {type = "label", name = "draft_status", caption = ui.caption("unapplied-changes"),
                visible = model.is_dirty(player, draft), style_mods = {font_color = {1, 0.75, 0.35}, right_margin = 12}}),
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
    local rows = {}
    for _, plan in ipairs(plans) do
        if plan.surface_index == s.view_surface_index and (preferences.show_retired or not plan.retired) then
            local _, assigned, total = model.center(plan)
            local recipe = prototypes.recipe[plan.recipe]
            local title = recipe and plan.title == plan.recipe and recipe.localised_name or plan.title
            local selected_plan = s.draft ~= nil and s.draft.id == plan.id
            local open = ui.button(on_action, "plan_"..plan.id, "open",
                {"", recipe and "[img=recipe/"..plan.recipe.."] " or "", plan.retired and {"", ui.caption("retired"), ": "} or "", title},
                {id = plan.id}, "list_box_item")
            open.style_mods = {width = 232, height = 28, horizontal_align = "left", right_padding = 52,
                font_color = plan.retired and {0.65, 0.65, 0.65} or nil}
            open.toggled, open.tooltip = selected_plan, {"", title, "\n", ui.caption("status", assigned, total)}
            local count = {type = "label", caption = {"", assigned, "/", total}, ignored_by_interaction = true,
                style_mods = {width = 44, height = 28, left_margin = -48, right_margin = 4,
                    horizontal_align = "right", vertical_align = "center",
                    font_color = selected_plan and {0, 0, 0} or plan.retired and {0.65, 0.65, 0.65} or nil}}
            rows[#rows + 1] = {type = "flow", style_mods = {horizontal_spacing = 0}, children = {open, count}}
        end
    end
    if #rows == 0 then rows[1] = {type = "label", caption = ui.caption("empty"), style_mods = {margin = 8}} end
    local new = ui.icon(on_action, "new", "new", "utility/add", ui.caption("new"), nil, "item_and_count_select_confirm")
    new.style_mods = {padding = 1, top_margin = 0}
    new.enabled = s.view_surface_index == player.surface_index
    if not new.enabled then new.tooltip = ui.caption("new-on-current-surface") end
    local draft = s.draft
    local retire = ui.icon(on_action, "retire", "retire",
        draft and draft.retired and "utility/export_slot" or "utility/import_slot",
        ui.caption(draft and draft.retired and "reactivate" or "retire"),
        draft and {id = draft.id, revision = draft.revision, retired = not draft.retired} or {})
    retire.enabled = draft ~= nil and draft.id ~= nil
    local show_retired = ui.icon(on_action, "show_retired", "show_retired", "map_tag_generator_archive",
        ui.caption("show-retired"))
    show_retired.toggled = preferences.show_retired
    local delete = ui.icon(on_action, "delete", "delete", "utility/trash",
        ui.caption(s.confirm_delete and "confirm-delete" or "delete"), nil, "tool_button_red")
    delete.enabled, delete.toggled = draft ~= nil and draft.id ~= nil, s.confirm_delete == true
    return {type = "frame", style = "inside_shallow_frame", direction = "vertical",
        style_mods = {width = 240, height = 524, padding = 0}, children = {
            ui.subheader(ui.caption("surface"), {
                {type = "drop-down", name = "surface_selector", items = items, selected_index = selected,
                    style_mods = {width = 164}, handler = {[defines.events.on_gui_selection_state_changed] = on_surface}},
            }),
            {type = "frame", style = "subheader_frame", style_mods = {width = 240, height = 36}, children = {
                new, retire, delete,
                {type = "empty-widget", style_mods = {horizontally_stretchable = true}},
                show_retired,
                ui.icon(on_action, "back", "list", "utility/list_view", ui.caption("back-to-plans")),
            }},
            {type = "scroll-pane", direction = "vertical", style = "deep_scroll_pane", horizontal_scroll_policy = "never",
                style_mods = {vertically_stretchable = true, width = 240, padding = 4},
                children = {{type = "flow", direction = "vertical", style_mods = {vertical_spacing = 0}, children = rows}}},
        }}
end

local function workspace(player, s)
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
    s.gui = {frame = old.frame, body = old.body, close = old.close, highlights = old.highlights}
    flib_gui.add(s.gui.body, workspace(player, s), s.gui)
    local opened = s.gui.frame
    if s.picker then
        local body, actions = picker.body(player, s, on_action, on_search)
        body[1].children[#body[1].children + 1] = notice(426)
        actions[#actions + 1] = ui.icon(on_action, "picker_highlights", "highlights", "map_tag_generator_highlight_icon_white",
            ui.caption("highlight-sources"), nil, "frame_action_button")
        actions[#actions + 1] = ui.icon(on_action, "picker_close", "close", "utility/close", {"gui.close-instruction"}, nil, "frame_action_button")
        flib_gui.add(player.gui.screen, ui.window("recipe_picker_frame",
            ui.caption(s.picker.product and "choose-recipe" or "choose-product"), actions,
            {type = "flow", direction = "vertical", style_mods = {vertical_spacing = 8}, children = body}), s.gui)
        s.gui.picker_frame = s.gui.recipe_picker_frame
        s.gui.recipe_picker_frame = nil
        if picker_location then s.gui.picker_frame.location = picker_location else s.gui.picker_frame.force_auto_center() end
        s.gui.frame.enabled = false
        s.gui.picker_highlights.toggled = model.preferences(player).highlight_sources
        picker.refresh(player, s)
        opened = s.gui.picker_frame
    end
    s.gui.highlights.toggled = model.preferences(player).highlight_sources
    sources.refresh(player)
    if s.confirm_delete then gui.report(player, ui.caption("confirm-delete-message")) end
    if not s.selecting and player.opened ~= opened then player.opened = opened end
end

function gui.open(player)
    if session(player) then gui.close(player) end
    local refs = flib_gui.add(player.gui.screen, ui.window("recipe_planner_frame", ui.caption("window"), {
        ui.icon(on_action, "highlights", "highlights", "map_tag_generator_highlight_icon_white", ui.caption("highlight-sources"), nil, "frame_action_button"),
        ui.icon(on_action, "close", "close", "utility/close", {"gui.close-instruction"}, nil, "frame_action_button"),
    }, {type = "flow", name = "body", direction = "vertical", style_mods = {vertical_spacing = 12}}))
    storage.recipe_planner.sessions[player.index] = {gui = {frame = refs.recipe_planner_frame, body = refs.body,
        close = refs.close, highlights = refs.highlights},
        force_index = player.force.index, surface_index = player.surface_index, view_surface_index = player.surface_index}
    gui.render(player)
    refs.recipe_planner_frame.force_auto_center()
end

function gui.toggle_highlights(player)
    sources.toggle(player)
    local s = session(player)
    if not s then return end
    local enabled = model.preferences(player).highlight_sources
    s.gui.highlights.toggled = enabled
    if s.gui.picker_highlights then s.gui.picker_highlights.toggled = enabled end
end

function gui.activate(player, machine, key)
    local s = session(player)
    if not s or not s.draft then return end
    if player.surface_index ~= s.draft.surface_index then gui.report(player, ui.caption("wrong-surface")); return end
    if not player.cursor_stack or not player.clear_cursor() then gui.report(player, ui.caption("cursor-full")); return end
    player.cursor_stack.set_stack({name = tool})
    s.pick_machine, s.selecting, s.active_key = machine, true, key
    if player.opened == s.gui.frame then player.opened = nil end
    gui.render(player)
end

function gui.choose_recipe(player, name)
    local s = session(player)
    if not s or not s.draft then return end
    local ok, err = model.set_recipe(s.draft, name)
    if not ok then gui.report(player, err); return end
    stop_selecting(player, s)
    s.active_key, s.confirm_delete, s.picker = nil, nil, nil
    gui.render(player)
end

function gui.refresh_picker(player)
    local s = session(player)
    if s and s.picker then s.picker.catalog = recipes.catalog(player); gui.render(player) end
end

on_title = function(e)
    local s = storage.recipe_planner.sessions[e.player_index]
    if not s or not s.draft then return end
    s.draft.title = e.element.text
    s.gui.draft_status.visible = model.is_dirty(game.get_player(e.player_index), s.draft)
    if s.confirm_delete then
        s.confirm_delete = nil
        s.gui.delete.toggled, s.gui.delete.tooltip = false, ui.caption("delete")
        s.gui.notice_panel.visible = false
    end
end
on_search = function(e)
    local player = game.get_player(e.player_index)
    local s = session(player)
    if not s or not s.picker then return end
    s.picker.query = e.element.text
    picker.refresh(player, s)
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
    if action == "highlights" then gui.toggle_highlights(player); return end
    if action == "new" then
        if s.view_surface_index ~= player.surface_index then gui.report(player, ui.caption("new-on-current-surface")); return end
        stop_selecting(player, s)
        s.draft, s.active_key, s.confirm_delete, s.picker = model.new(player), nil, nil, nil
    elseif action == "show_retired" then
        local preferences = model.preferences(player)
        preferences.show_retired = not preferences.show_retired
    elseif action == "list" then
        stop_selecting(player, s)
        s.draft, s.active_key, s.confirm_delete, s.picker = nil, nil, nil, nil
    elseif action == "open" then
        local draft, err = model.load(player, tags.id)
        if not draft then gui.report(player, err); return end
        stop_selecting(player, s)
        s.draft, s.active_key, s.confirm_delete, s.picker = draft, nil, nil, nil
        s.view_surface_index = draft.surface_index
    elseif action == "recipes" then
        stop_selecting(player, s)
        s.picker = picker.open(player)
        gui.render(player); s.gui.search.focus(); return
    elseif action == "editor" then s.picker = nil
    elseif action == "choose_recipe" then
        if model.preferences(player).researched_only and not recipes.unlocked(player.force)[tags.recipe] then
            gui.refresh_picker(player); gui.report(player, ui.caption("unresearched")); return
        end
        gui.choose_recipe(player, tags.recipe); return
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
    elseif action == "machine" then gui.activate(player, true); return
    elseif action == "ingredient" then gui.activate(player, false, tags.key); return
    elseif action == "closest" or action == "find" then
        local entity, err = sources.closest(player, s.draft, tags.key)
        if not entity then gui.report(player, err); return end
        if action == "find" then sources.find(player, entity); return end
        model.select(s.draft, tags.key, {entity}, "add", s.draft.surface_index)
        s.confirm_delete = nil
    elseif action == "clear" then
        local ingredient = model.ingredient(s.draft, tags.key)
        if ingredient then ingredient.anchors = {} end
        s.confirm_delete = nil
    elseif action == "apply" then
        local saved, err = model.apply(player, s.draft)
        if not saved then gui.report(player, err); return end
        s.draft, s.confirm_delete = saved, nil
        stop_selecting(player, s)
        sources.refresh_force(saved.force_index)
    elseif action == "retire" then
        local draft, err = model.load(player, tags.id)
        if not draft then gui.report(player, err); return end
        draft.revision = tags.revision
        local revision
        revision, err = model.retire(player, draft, tags.retired)
        if not revision then gui.report(player, err); return end
        if s.draft and s.draft.id == draft.id then s.draft.revision, s.draft.retired = revision, tags.retired end
        sources.refresh_force(player.force.index)
    elseif action == "delete" then
        if not s.draft or not s.draft.id then return end
        if not s.confirm_delete then s.confirm_delete = true
        else
            local ok, err = model.delete(player, s.draft)
            if not ok then gui.report(player, err); return end
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
