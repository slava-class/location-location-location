-- These scenes run through FactorioTest's normal assertions, hooks and async scheduler.
local model = require("location_location_location.planner")
local gui = require("location_location_location.gui.planner")
local sources = require("location_location_location.sources")
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
        model.set_recipe(state(p).draft, "advanced-circuit")
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
        assert(model.set_recipe(draft, "electronic-circuit"))
        draft.hide_label = false
        for _, spec in ipairs({ { "item/iron-plate", { -10, 5 } }, { "item/copper-cable", { 10, 5 } } }) do
            local chest =
                assert(surface.create_entity({ name = "steel-chest", position = spec[2], force = player.force }))
            assert(model.select(draft, spec[1], { chest }, "add", surface.index))
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
                assert(current.draft.recipe == "advanced-circuit" and not model.position(current.draft))
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
end)
