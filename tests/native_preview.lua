-- These scenes run through FactorioTest's normal assertions, hooks and async scheduler.
local model = require("location_location_location.planner")
local gui = require("location_location_location.gui.planner")
local sources = require("location_location_location.sources")
local underground_appearance = require("location_location_location.gui.appearance").underground
local phases =
    { "list", "editor", "pinned", "picker", "no-results", "delete-confirm", "retired", "error", "sourcefree" }
---@type integer
local saved_id
---@type LuaPlayer
local player
---@param p LuaPlayer
local function state(p)
    return assert(storage.location_location_location.sessions[p.index], "Planner session missing")
end
---@param p LuaPlayer
---@param element LuaGuiElement
local function click(p, element)
    assert(element and element.valid)
    assert(script.get_event_handler(defines.events.on_gui_click))({
        name = defines.events.on_gui_click,
        tick = game.tick,
        player_index = p.index,
        element = element,
        button = defines.mouse_button_type.left,
    })
end
---@param p LuaPlayer
---@param name string
local function scene(p, name)
    gui.close(p)
    gui.open(p)
    if name == "list" then
        return
    end
    click(p, state(p).gui["plan_" .. saved_id])
    if name == "editor" then
        state(p).draft.title = "Private edit"
        gui.render(p)
    elseif name == "pinned" then
        click(p, state(p).gui.pin)
    elseif name == "picker" or name == "no-results" then
        click(p, state(p).gui.recipe)
        if name == "no-results" then
            state(p).gui.search.text = "zzzz-nonexistent-product"
            assert(script.get_event_handler(defines.events.on_gui_text_changed))({
                name = defines.events.on_gui_text_changed,
                tick = game.tick,
                player_index = p.index,
                element = state(p).gui.search,
            })
        end
    elseif name == "delete-confirm" then
        click(p, state(p).gui.delete)
    elseif name == "retired" then
        click(p, state(p).gui.retire)
        click(p, state(p).gui.show_retired)
    elseif name == "error" then
        gui.report(p, { "location-location-location.conflict" }, "error")
    elseif name == "sourcefree" then
        state(p).draft = model.new(p)
        model.set_recipes(state(p).draft, { "advanced-circuit" })
        gui.render(p)
    end
    local s = state(p)
    s.gui.frame.location = { x = math.max(0, (p.display_resolution.width / p.display_scale - 920) / 2), y = 100 }
    if s.gui.picker_frame then
        s.gui.picker_frame.auto_center = true
    end
    assert(s.gui.frame.valid)
end

tags("native-ui")
describe("native UI gallery", function()
    ticks_between_tests(30)
    before_all(function()
        player =
            assert(game.connected_players[1], "Use mise run test-ui; this suite requires a native connected player")
        assert(player.force.research_all_technologies)()
        player.set_controller({ type = defines.controllers.god })
        local surface = game.create_surface("Release UI studio", { width = 96, height = 96, water = 0 })
        surface.request_to_generate_chunks({ 0, 0 }, 2)
        surface.force_generate_chunk_requests()
        local tiles = {}
        for x = -32, 32 do
            for y = -32, 32 do
                tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } }
            end
        end
        surface.set_tiles(tiles)
        player.teleport({ 0, 0 }, surface)
        surface.daytime, surface.freeze_daytime = 0, true
        assert(player.force.chart)(surface, { { -32, -32 }, { 32, 32 } })
        local draft = model.new(player)
        assert(model.set_recipes(draft, { "electronic-circuit" }))
        draft.hide_label = false
        for _, spec in ipairs({ { "item/iron-plate", { -10, 5 } }, { "item/copper-cable", { 10, 5 } } }) do
            local chest =
                assert(surface.create_entity({ name = "steel-chest", position = spec[2], force = player.force }))
            assert(model.select(draft, "input", spec[1], { chest }, "add", surface.index))
        end
        saved_id = assert(assert(model.apply(player, draft)).id)
        sources.toggle(player)
    end)
    before_each(function()
        gui.close(player)
        model.preferences(player).show_retired = false
        local draft = assert(model.load(player, saved_id))
        if draft.retired then
            assert(model.retire(player, draft, false))
        end
    end)
    after_all(function()
        -- Completion requests only process cleanup; the CLI's actual result decides success.
        helpers.write_file("native-preview-complete.txt", "FactorioTest native suite finished", false)
    end)
    for index, name in ipairs(phases) do
        test(string.format("%02d %s", index, name), function()
            scene(player, name)
            local current = state(player)
            assert(current.gui.frame.valid and current.gui.frame.visible)
            if name == "list" then
                assert(not current.draft)
            elseif name == "picker" then
                assert(current.picker and current.gui.picker_frame.valid)
            elseif name == "no-results" then
                assert(current.picker and current.gui.search.text == "zzzz-nonexistent-product")
            elseif name == "delete-confirm" then
                assert(model.load(player, saved_id), "Confirmation must not delete")
            elseif name == "retired" then
                assert(assert(model.load(player, saved_id)).retired)
            elseif name == "sourcefree" then
                assert(current.draft.recipes[1] == "advanced-circuit" and not model.position(current.draft))
            else
                assert(current.draft and current.draft.id == saved_id)
            end
            after_ticks(20, function()
                assert(current.gui.frame.valid)
                game.take_screenshot({
                    player = player,
                    resolution = { player.display_resolution.width, player.display_resolution.height },
                    zoom = 0.8,
                    show_gui = true,
                    show_entity_info = true,
                    path = "release-ui/" .. string.format("%02d-", index) .. name .. ".png",
                })
                local refs = {}
                for key, elem in pairs(current.gui) do
                    if elem.valid then
                        refs[key] = {
                            caption = elem.caption,
                            tooltip = elem.tooltip,
                            width = elem.style.minimal_width,
                            height = elem.style.minimal_height,
                        }
                    end
                end
                helpers.write_file("native-preview.jsonl", helpers.table_to_json({
                    scene = name,
                    locale = player.locale,
                    resolution = { player.display_resolution.width, player.display_resolution.height },
                    scale = player.display_scale,
                    controls = refs,
                }) .. "\n", true)
            end)
        end)
    end
    test("10 reversed-underground", function()
        async(underground_appearance.pulse_period * 2 + 120)
        gui.close(player)
        player.gui.screen["factorio-test-test-gui"].visible = false
        model.preferences(player).highlight_sources = false
        sources.refresh(player)
        local surface = player.surface
        local endpoints = {}
        for row, reversed in ipairs({ true, false }) do
            local y = row == 1 and -4.5 or 4.5
            for x = -7, 7 do
                local underground = x == -2 or x == 2
                if underground or x < -2 or x > 2 then
                    local entity = assert(surface.create_entity({
                        name = underground and "underground-belt" or "transport-belt",
                        position = { x + 0.5, y },
                        force = player.force,
                        direction = underground and reversed and defines.direction.west or defines.direction.east,
                        type = underground and ((x == -2) ~= reversed and "input" or "output") or nil,
                        raise_built = true,
                    }))
                    if underground then
                        endpoints[#endpoints + 1] = entity
                    end
                end
            end
            rendering.draw_text({
                text = reversed and "Reversed underground: actual flow" or "Correct underground: no overlay",
                surface = surface,
                target = { -7, y - 2 },
                color = { 1, 1, 1 },
                scale = 1.5,
            })
        end
        ---@type LuaEntity[]
        local second_endpoints = {}
        for part, x in ipairs({ -2.5, -1.5, 2.5, 3.5 }) do
            local mouth = part == 2 or part == 3
            local entity = assert(surface.create_entity({
                name = mouth and "underground-belt" or "transport-belt",
                position = { x, -13.5 },
                force = player.force,
                direction = mouth and defines.direction.west or defines.direction.east,
                type = mouth and (part == 2 and "output" or "input") or nil,
                raise_built = true,
            }))
            if mouth then
                second_endpoints[#second_endpoints + 1] = entity
            end
        end
        player.teleport({ 0, 0 }, surface)
        after_ticks(61, function()
            ---@type LLLUndergroundWarning?
            local input_warning
            for index, entity in ipairs(endpoints) do
                local warnings = assert(storage.location_location_location.undergrounds).warnings
                if index <= 2 then
                    local warning = assert(warnings[entity.unit_number])
                    assert(warning.sprite.valid and warning.sprite.orientation == 0.75)
                    if entity.belt_to_ground_type == "input" then
                        input_warning = warning
                        local span = assert(warning.span)
                        assert(#span == 3)
                        for _, sprite in ipairs(span) do
                            assert(sprite.valid and sprite.orientation == 0.75)
                            assert(sprite.color.a < warning.sprite.color.a)
                        end
                    end
                    local alerts = player.get_alerts({ type = defines.alert_type.custom })
                    for _, alert in pairs((alerts[surface.index] or {})[defines.alert_type.custom] or {}) do
                        assert(alert.target ~= entity, "World arrows must not generate alerts by default")
                    end
                else
                    assert(not warnings[entity.unit_number])
                end
            end
            local warning = assert(input_warning)
            local span = assert(warning.span)
            local interior = assert(span[1])
            local second_input = assert(second_endpoints[2])
            local second_id = assert(second_input.unit_number)
            local second_warning = assert(storage.location_location_location.undergrounds).warnings[second_id]
            local second_span = assert(assert(second_warning).span)
            local second_interior = assert(second_span[1])
            local samples = {}
            local frame_count = underground_appearance.pulse_period / underground_appearance.pulse_interval
            local function capture(frame)
                samples[#samples + 1] = {
                    tick = game.tick,
                    mouth = warning.sprite.color,
                    span = interior.color,
                }
                game.take_screenshot({
                    player = player,
                    position = { 0.5, -4.5 },
                    resolution = { 710, 200 },
                    zoom = 4,
                    anti_alias = true,
                    force_render = true,
                    show_gui = false,
                    show_entity_info = false,
                    path = string.format("underground-pulse/frame-%02d.png", frame),
                })
                if frame == 0 then
                    game.take_screenshot({
                        player = player,
                        resolution = { player.display_resolution.width, player.display_resolution.height },
                        zoom = 1.5,
                        show_gui = true,
                        show_entity_info = true,
                        path = "release-ui/10-reversed-underground.png",
                    })
                end
                if frame + 1 < frame_count then
                    after_ticks(underground_appearance.pulse_interval, function()
                        capture(frame + 1)
                    end)
                else
                    -- A blue probe distinguishes a neutral stock mask from a
                    -- yellow texture that still multiplies away the blue channel.
                    rendering.draw_sprite({
                        sprite = underground_appearance.sprite,
                        surface = surface,
                        target = { 20, -4.5 },
                        tint = { 0, 0.4, 1, 1 },
                        x_scale = 3,
                        y_scale = 3,
                        orientation = 0.75,
                    })
                    game.take_screenshot({
                        player = player,
                        position = { 20, -4.5 },
                        resolution = { 400, 240 },
                        zoom = 4,
                        show_gui = false,
                        show_entity_info = false,
                        path = "underground-pulse/tint-probe.png",
                    })
                    helpers.write_file("underground-pulse/samples.json", helpers.table_to_json(samples), false)
                    after_ticks(2, function()
                        player.selected = endpoints[1]
                        assert(warning.sprite.visible and not interior.visible)
                        assert(second_interior.visible, "Hover must leave the other pair's span visible")
                        game.take_screenshot({
                            player = player,
                            position = { 0.5, -9 },
                            resolution = { 710, 560 },
                            zoom = 1.5,
                            anti_alias = true,
                            force_render = true,
                            show_gui = false,
                            show_entity_info = true,
                            path = "underground-hover/pair-specific.png",
                        })
                        game.take_screenshot({
                            player = player,
                            position = { 0.5, -4.5 },
                            resolution = { 710, 200 },
                            zoom = 4,
                            anti_alias = true,
                            force_render = true,
                            show_gui = true,
                            show_entity_info = true,
                            path = "underground-hover/hovering.png",
                        })
                        after_ticks(2, function()
                            player.clear_selected_entity()
                            local restored_interior = assert(rendering.get_object_by_id(interior.id))
                            assert(warning.sprite.visible and restored_interior.visible)
                            local overlay_setting = "location_location_location_underground_overlay"
                            settings.get_player_settings(player)[overlay_setting] = { value = "steady" }
                            local steady = assert(warning.steady)
                            local steady_span = assert(steady.span)
                            local steady_interior = assert(steady_span[1])
                            local pulsing_mouth = assert(rendering.get_object_by_id(warning.sprite.id))
                            assert(not pulsing_mouth.visible and steady.sprite.visible and steady_interior.visible)
                            game.take_screenshot({
                                player = player,
                                position = { 0.5, -4.5 },
                                resolution = { 710, 200 },
                                zoom = 4,
                                anti_alias = true,
                                force_render = true,
                                show_gui = false,
                                show_entity_info = false,
                                path = "underground-hover/steady.png",
                            })
                            after_ticks(2, function()
                                settings.get_player_settings(player)[overlay_setting] = { value = "pulsing" }
                                done()
                            end)
                        end)
                    end)
                end
            end
            local until_peak = underground_appearance.pulse_period - game.tick % underground_appearance.pulse_period
            after_ticks(until_peak, function()
                capture(0)
            end)
        end)
    end)
end)
