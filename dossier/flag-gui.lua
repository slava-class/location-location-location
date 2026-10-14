local flags = require("dossier.flags")
local recipes = require("dossier.recipes")
local dictionary = require("__flib__.dictionary")
local window_name = "py-research-dossier-flag-window"
local export = { events = {} }

local function caption(key, ...)
    return { "py-research-dossier.flag-" .. key, ... }
end

local function selected(window)
    local target = window.tags.target
    if target then
        return flags.resolve(target.base_type, target.name)
    end
end

local function refresh(window)
    local target, prototype = selected(window)
    window.body.target.caption = target and { "", prototype.localised_name, "\n", target.id } or caption("no-target")
    for _, reason in ipairs(flags.reasons) do
        window.body.actions[reason].enabled = target ~= nil
    end
end

local function select_target(window, target)
    window.tags = { target = target and { base_type = target.base_type, name = target.name } }
    refresh(window)
end

local function show_recipes(player, window, page)
    local browser = window.body.recipes
    local matches, translated = recipes.search(player, browser.query.text)
    page = math.max(1, math.min(page, math.ceil(#matches / recipes.page_size)))
    browser.tags = { page = page }
    browser.results.clear()
    local first = (page - 1) * recipes.page_size + 1
    local last = math.min(#matches, first + recipes.page_size - 1)
    for i = first, last do
        local recipe = matches[i]
        local button = browser.results.add({
            type = "button",
            name = "recipe-" .. i,
            caption = { "", "[recipe=" .. recipe.name .. "] ", recipe.localised_name, "  (", recipe.name, ")" },
            elem_tooltip = { type = "recipe", name = recipe.name },
            tags = { recipe = recipe.name },
        })
        button.style.width, button.style.height = 480, 28
        button.style.horizontal_align = "left"
    end
    browser.status.caption = #matches == 0 and caption("no-recipes") or caption("results", first, last, #matches)
    browser.translating.visible = not translated
    browser.pages.previous.enabled = page > 1
    browser.pages.next.enabled = last < #matches
    browser.visible = true
end

local function make_picker(player, window, kind, target)
    local row = window.body.selection
    if row.picker then
        row.picker.destroy()
    end
    window.body.recipes.visible = false
    if kind == "recipe" then
        row.add({ type = "button", name = "picker", caption = caption("choose-recipe") })
        if not target then
            show_recipes(player, window, 1)
        end
    else
        local picker = row.add({ type = "choose-elem-button", name = "picker", elem_type = kind })
        picker.elem_value = target and target.name or nil
    end
end

local function close(player, window)
    if player.opened == window then
        player.opened = nil
    end
    if window.valid then
        window.destroy()
    end
end

local function open(player, selection)
    local existing = player.gui.screen[window_name]
    if existing then
        existing.bring_to_front()
        player.opened = existing
        return -- Repeated shortcuts must not discard an unfinished note.
    end
    local target = selection and flags.resolve(selection.base_type, selection.name)
    local items, index = {}, 1
    for i, kind in ipairs(flags.kinds) do
        items[i] = caption("kind-" .. kind)
        if (target and kind == target.base_type) or (not target and kind == "recipe") then
            index = i
        end
    end
    local window = player.gui.screen.add({
        type = "frame",
        name = window_name,
        caption = caption("title"),
        direction = "vertical",
    })
    local body = window.add({ type = "flow", name = "body", direction = "vertical" })
    body.style.width = 480
    local help = body.add({ type = "label", caption = caption("help") })
    help.style.single_line, help.style.maximal_width = false, 480
    local row = body.add({ type = "flow", name = "selection", direction = "horizontal" })
    row.add({ type = "drop-down", name = "kind", items = items, selected_index = index })
    local browser = body.add({ type = "flow", name = "recipes", direction = "vertical" })
    browser.add({ type = "label", caption = caption("search") })
    browser.add({ type = "textfield", name = "query", text = "" }).style.width = 480
    browser.add({ type = "label", name = "translating", caption = caption("translating") })
    browser.add({ type = "flow", name = "results", direction = "vertical" })
    browser.add({ type = "label", name = "status" })
    local pages = browser.add({ type = "flow", name = "pages", direction = "horizontal" })
    pages.add({ type = "button", name = "previous", caption = caption("previous") })
    pages.add({ type = "button", name = "next", caption = caption("next") })
    local label = body.add({ type = "label", name = "target" })
    label.style.single_line, label.style.maximal_width = false, 480
    body.add({ type = "label", caption = caption("note") })
    local note = body.add({ type = "text-box", name = "note", text = "" })
    note.style.width, note.style.height = 480, 80
    local actions = body.add({ type = "flow", name = "actions", direction = "horizontal" })
    for _, reason in ipairs(flags.reasons) do
        local button = actions.add({
            type = "button",
            name = reason,
            caption = caption(reason),
            tooltip = caption("file", flags.path),
        })
        button.style.width = 156
    end
    local privacy = body.add({ type = "label", caption = caption("local-only") })
    privacy.style.single_line, privacy.style.maximal_width = false, 480
    body.add({ type = "button", name = "cancel", caption = caption("cancel") })
    make_picker(player, window, flags.kinds[index], target)
    select_target(window, target)
    window.auto_center = true
    window.force_auto_center()
    player.opened = window
end

local function owned_event(event)
    local player = game.get_player(event.player_index)
    local window = player and player.gui.screen[window_name]
    local element = event.element
    while window and element and element.valid do
        if element == window then
            return player, window
        end
        element = element.parent
    end
end

export.events[flags.action] = function(event)
    local player = game.get_player(event.player_index)
    if player then
        open(player, event.selected_prototype)
    end
end

export.events[defines.events.on_lua_shortcut] = function(event)
    if event.prototype_name == flags.action then
        local player = game.get_player(event.player_index)
        if player then
            open(player)
        end
    end
end

export.events[defines.events.on_gui_selection_state_changed] = function(event)
    local player, window = owned_event(event)
    if window and event.element == window.body.selection.kind then
        select_target(window, nil)
        make_picker(player, window, flags.kinds[event.element.selected_index])
    end
end

export.events[defines.events.on_gui_elem_changed] = function(event)
    local _, window = owned_event(event)
    if window and event.element == window.body.selection.picker then
        local kind = flags.kinds[window.body.selection.kind.selected_index]
        select_target(window, flags.resolve(kind, event.element.elem_value))
    end
end

export.events[defines.events.on_gui_text_changed] = function(event)
    local player, window = owned_event(event)
    if window and event.element == window.body.recipes.query then
        show_recipes(player, window, 1)
    end
end

export.events[dictionary.on_player_dictionaries_ready] = function(event)
    local player = game.get_player(event.player_index)
    local window = player and player.gui.screen[window_name]
    if window and window.body.recipes.visible then
        show_recipes(player, window, window.body.recipes.tags.page)
    end
end

export.events[defines.events.on_gui_click] = function(event)
    local player, window = owned_event(event)
    if not window then
        return
    end
    if event.element == window.body.cancel then
        close(player, window)
        return
    end
    local browser = window.body.recipes
    if
        event.element == window.body.selection.picker
        and flags.kinds[window.body.selection.kind.selected_index] == "recipe"
    then
        show_recipes(player, window, 1)
        return
    elseif event.element == browser.pages.previous or event.element == browser.pages.next then
        show_recipes(player, window, browser.tags.page + (event.element == browser.pages.next and 1 or -1))
        return
    elseif event.element.tags.recipe then
        local name = event.element.tags.recipe
        if recipes.visible(player.force.recipes[name]) then
            select_target(window, flags.resolve("recipe", name))
            browser.visible = false
        else
            show_recipes(player, window, browser.tags.page)
        end
        return
    end
    for _, reason in ipairs(flags.reasons) do
        if event.element == window.body.actions[reason] then
            local target = selected(window)
            local record = target and flags.write(player, target.base_type, target.name, reason, window.body.note.text)
            if record then
                player.print(caption("logged", record.target.id, caption(reason)))
                close(player, window)
            else
                refresh(window)
                player.print(caption("invalid"))
            end
            return
        end
    end
end

export.events[defines.events.on_gui_closed] = function(event)
    local player = game.get_player(event.player_index)
    local window = player and player.gui.screen[window_name]
    if window and event.element == window then
        close(player, window)
    end
end

export.on_init = recipes.build_dictionary
export.on_configuration_changed = function(event)
    recipes.build_dictionary()
    for _, player in pairs(game.players) do
        local window = player.gui.screen[window_name]
        if window then
            local target
            local change = event.mod_changes["py-research-dossier"]
            if change and change.old_version == "0.3.0" then
                -- Migrate the released widget-owned draft once into canonical typed selection.
                local row = window.body.selection
                target = flags.resolve(flags.kinds[row.kind.selected_index], row.picker.elem_value)
            else
                target = selected(window)
            end
            local note = window.body.note.text
            close(player, window)
            open(player, target)
            player.gui.screen[window_name].body.note.text = note
        end
    end
end

return export
