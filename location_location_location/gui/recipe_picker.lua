local appearance = require("location_location_location.gui.appearance")
-- Adapted from Factory Planner 2.1.15's picker_dialog.lua and recipe_dialog.lua.
-- Copyright (c) 2026 Claude Metz. MIT license; see license.txt.
local model = require("location_location_location.planner")
local recipes = require("location_location_location.recipes")
local ui = require("location_location_location.gui.components")
local picker = {}
local groups_per_row, items_per_row, recipes_per_row = 6, 10, 6

function picker.open(player)
    return {catalog = recipes.catalog(player), query = "", group = model.preferences(player).picker_group,
        height = math.max(300, math.min(548, player.display_resolution.height / player.display_scale - 160))}
end

local function product_body(player, state, handler)
    local tabs, panes = {}, {}
    local groups, subgroups = {}, {}
    state.groups = {}
    for _, product in ipairs(state.catalog.products) do
        local group = groups[product.group]
        if not group then
            local index = #state.groups + 1
            group = {name = product.group, button = "group_"..index, pane = "group_pane_"..index, subgroups = {}}
            groups[product.group] = group
            state.groups[index] = group
            local tab = ui.icon(handler, group.button, "picker_group", nil, nil, {group = product.group})
            tab.sprite, tab.style = "item-group/"..product.group, appearance.styles.picker_group
            tab.tooltip = prototypes.item_group[product.group].localised_name
            tab.style_mods = {width = appearance.picker.group_widths[(#tabs % groups_per_row) + 1]}
            tabs[#tabs + 1] = tab
            group.flow = {type = "flow", direction = "vertical", style_mods = {vertical_spacing = 0}, children = {}}
            panes[#panes + 1] = {type = "scroll-pane", name = group.pane, style = "deep_slots_scroll_pane",
                horizontal_scroll_policy = "never",
                style_mods = {width = appearance.picker.width, padding = 0, margin = 4, vertically_stretchable = true},
                children = {group.flow}}
        end
        local subgroup = subgroups[product.subgroup]
        if not subgroup then
            local name = "subgroup_"..product.subgroup
            subgroup = {name = name, items = {}, definition = {type = "table", name = name,
                column_count = items_per_row, style = "filter_slot_table", children = {}}}
            subgroups[product.subgroup] = subgroup
            group.subgroups[#group.subgroups + 1] = subgroup
            group.flow.children[#group.flow.children + 1] = subgroup.definition
        end
        local name = "product_"..product.key
        local button = ui.icon(handler, name, "picker_product", nil, nil, {product = product.key})
        button.sprite = product.key
        button.style = appearance.slot_style(product.unlocked, false)
        button.elem_tooltip = {type = product.type, name = product.name}
        subgroup.definition.children[#subgroup.definition.children + 1] = button
        subgroup.items[#subgroup.items + 1] = {entry = product, button = name}
    end
    for _, group in ipairs(state.groups) do
        for _, subgroup in ipairs(group.subgroups) do
            subgroup.definition = nil
        end
        group.flow = nil
    end
    local tabs_height = math.min(3, math.ceil(#tabs / groups_per_row)) * 76
    table.insert(panes, 1, {type = "label", name = "recipe_empty", caption = ui.caption("no-products"),
        style = "heading_2_label", visible = false})
    return {
        {type = "scroll-pane", name = "product_groups", horizontal_scroll_policy = "never",
            style = appearance.styles.picker_tabs,
            style_mods = {width = appearance.picker.width, height = tabs_height, margin = 4}, children = {
                {type = "table", column_count = groups_per_row,
                    style_mods = {width = appearance.picker.width, horizontal_spacing = 0, vertical_spacing = 0}, children = tabs},
            }},
        {type = "flow", direction = "vertical",
            style_mods = {minimal_height = 80, vertically_stretchable = true, width = 426, vertical_spacing = 0}, children = panes},
    }
end

local function recipe_body(state, handler)
    local children, groups = {}, {}
    state.groups = {}
    local kind, name = state.product:match("^([^/]+)/(.+)$")
    children[1] = {type = "flow", style_mods = {vertical_align = "center"}, children = {
        {type = "sprite", sprite = state.product, style_mods = {size = 32, stretch_image_to_widget_size = true}},
        {type = "label", caption = prototypes[kind][name].localised_name},
    }}
    local frames = {}
    for _, recipe in ipairs(state.catalog.by_product[state.product] or {}) do
        local group = groups[recipe.group]
        if not group then
            local index = #state.groups + 1
            group = {name = recipe.group, pane = "recipe_group_"..index, items = {}}
            groups[recipe.group] = group
            state.groups[index] = group
            group.slots = {type = "table", column_count = recipes_per_row, style = "slot_table", children = {}}
            frames[#frames + 1] = {type = "frame", name = group.pane, style = "bordered_frame", direction = "vertical",
                style_mods = {padding = 8, horizontally_stretchable = true}, children = {
                    {type = "flow", style_mods = {vertical_align = "center", horizontal_spacing = 8}, children = {
                        {type = "sprite", sprite = "item-group/"..recipe.group,
                            style_mods = {size = 32, stretch_image_to_widget_size = true}},
                        {type = "label", caption = prototypes.item_group[recipe.group].localised_name,
                            style = "heading_2_label", style_mods = {single_line = true, maximal_width = 350}},
                    }},
                    group.slots,
                }}
        end
        local button_name = "recipe_"..recipe.name
        local button = ui.icon(handler, button_name, "choose_recipe", nil, nil, {recipe = recipe.name})
        button.sprite, button.elem_tooltip = "recipe/"..recipe.name, {type = "recipe", name = recipe.name}
        button.style = appearance.slot_style(recipe.unlocked, true)
        group.slots.children[#group.slots.children + 1] = button
        group.items[#group.items + 1] = {entry = recipe, button = button_name}
    end
    for _, group in ipairs(state.groups) do group.slots = nil end
    table.insert(frames, 1, {type = "label", name = "recipe_empty", caption = ui.caption("no-recipes"),
        style = "heading_2_label", visible = false})
    children[#children + 1] = {type = "scroll-pane", direction = "vertical", horizontal_scroll_policy = "never",
        style_mods = {minimal_height = 80, vertically_stretchable = true, width = 426}, children = frames}
    return children
end

function picker.body(player, session, click, search)
    local state = session.picker
    local toggle = ui.icon(click, "show_unresearched", "picker_unresearched", nil, nil)
    toggle.tooltip = {"factoriopedia.show-unresearched"}
    appearance.toggle(toggle, not model.preferences(player).researched_only)
    local title_actions = {
        {type = "textfield", name = "search", text = state.query, tooltip = ui.caption("search"), style = "search_popup_textfield",
            handler = {[defines.events.on_gui_text_changed] = search}},
        ui.icon(click, "focus_search", "picker_search", "utility/search", ui.caption("search-tooltip"), nil, "frame_action_button"),
        toggle,
    }
    local body = state.product and recipe_body(state, click) or product_body(player, state, click)
    local back_to_editor = ui.button(click, "back_to_plan", "editor", ui.caption("back-to-plan"), nil,
        state.product and "dialog_button" or "back_button")
    local footer = {back_to_editor}
    if state.product then
        footer = {ui.button(click, "back_to_products", "picker_products", ui.caption("back-to-products"), nil, "back_button"),
            back_to_editor}
    else
        footer[#footer + 1] = ui.button(click, "picker_machine", "machine", ui.caption("from-machine"), nil, "dialog_button")
    end
    return {{type = "frame", style = "inside_deep_frame", direction = "vertical",
        style_mods = {padding = 12, width = 450, height = state.height}, children = body},
        ui.footer("location_location_location_picker_frame", footer)}, title_actions
end

function picker.refresh(player, session)
    local state, refs = session.picker, session.gui
    local query = helpers.multilingual_to_lower(state.query)
    refs.focus_search.toggled = query ~= ""
    local researched_only = model.preferences(player).researched_only
    local first_visible, selected_visible
    for _, group in ipairs(state.groups) do
        local any_visible = false
        if state.product then
            for _, item in ipairs(group.items) do
                local visible = recipes.matches(item.entry, query, researched_only)
                refs[item.button].visible = visible
                any_visible = any_visible or visible
            end
            refs[group.pane].visible = any_visible
        else
            for _, subgroup in ipairs(group.subgroups) do
                local subgroup_visible = false
                for _, item in ipairs(subgroup.items) do
                    local visible = recipes.matches(item.entry, query, researched_only)
                    refs[item.button].visible = visible
                    subgroup_visible = subgroup_visible or visible
                end
                refs[subgroup.name].visible = subgroup_visible
                any_visible = any_visible or subgroup_visible
            end
            refs[group.button].enabled = any_visible
        end
        if any_visible then
            first_visible = first_visible or group.name
            selected_visible = selected_visible or (group.name == state.group)
        end
    end
    refs.recipe_empty.visible = first_visible == nil
    appearance.toggle(refs.show_unresearched, not researched_only)
    if not state.product then
        state.group = selected_visible and state.group or first_visible
        for _, group in ipairs(state.groups) do
            local selected = group.name == state.group
            refs[group.button].toggled, refs[group.pane].visible = selected, selected
            if selected then refs.product_groups.scroll_to_element(refs[group.button]) end
        end
    end
end

return picker
