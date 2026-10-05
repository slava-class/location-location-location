-- Mod Portal photography, rendered from the real planner in an isolated native profile.
local model = require("location_location_location.planner")
local gui = require("location_location_location.gui.planner")
local sources = require("location_location_location.sources")
local phases = { "source-survey", "planner", "recipe-picker", "marker-placement", "recipe-alternatives" }
---@type LuaPlayer
local player
---@type integer
local saved_id

local function state()
    return assert(storage.location_location_location.sessions[player.index], "Planner session missing")
end

---@param element LuaGuiElement
local function click(element)
    assert(element.valid)
    assert(script.get_event_handler(defines.events.on_gui_click))({
        name = defines.events.on_gui_click,
        tick = game.tick,
        player_index = player.index,
        element = element,
        button = defines.mouse_button_type.left,
    })
end

---@param name string
local function select_group(name)
    for _, group in ipairs(state().picker.groups) do
        if group.name == name then
            click(state().gui[group.button])
            return
        end
    end
    error("Gallery product group missing: " .. name)
end

---@param name string
local function scene(name)
    gui.close(player)
    gui.open(player)
    click(state().gui["plan_" .. saved_id])
    state().gui.frame.force_auto_center()
    if name == "source-survey" then
        click(state().gui.pin)
    elseif name == "recipe-picker" then
        click(state().gui.recipe)
        select_group("intermediate-products")
        state().gui.picker_frame.force_auto_center()
    elseif name == "marker-placement" then
        state().draft.marker_position = { x = 3, y = 4 }
        gui.render(player)
        state().gui.frame.force_auto_center()
    elseif name == "recipe-alternatives" then
        click(state().gui.recipe)
        select_group("fluids")
        click(state().gui["product_fluid/heavy-oil"])
        state().gui.picker_frame.force_auto_center()
    end
end

tags("native-ui", "portal-gallery")
describe("Mod Portal gallery", function()
    ticks_between_tests(30)
    before_all(function()
        player = assert(game.connected_players[1], "Use mise run gallery; a native player is required")
        assert(
            player.display_resolution.width == 1920 and player.display_resolution.height == 1080,
            "Gallery requires a 1920x1080 game window"
        )
        assert(math.abs(player.display_scale - 1.25) < 0.001, "Gallery requires 125% UI scale")
        assert(player.force.research_all_technologies)()
        player.set_controller({ type = defines.controllers.god })
        local surface = assert(game.get_surface("nauvis"))
        surface.request_to_generate_chunks({ 0, 0 }, 2)
        surface.force_generate_chunk_requests()
        for _, entity in pairs(surface.find_entities_filtered({ area = { { -40, -40 }, { 40, 40 } } })) do
            entity.destroy()
        end
        surface.destroy_decoratives({ area = { { -40, -40 }, { 40, 40 } } })
        local tiles = {}
        for x = -40, 40 do
            for y = -40, 40 do
                tiles[#tiles + 1] = {
                    name = x >= -23 and x <= 23 and y >= -18 and y <= 18 and "refined-concrete" or "grass-1",
                    position = { x, y },
                }
            end
        end
        surface.set_tiles(tiles)
        surface.daytime, surface.freeze_daytime = 0, true
        player.teleport({ 3, 0 }, surface)
        assert(player.force.chart)(surface, { { -40, -40 }, { 40, 40 } })
        local draft = model.new(player)
        assert(model.set_recipe(draft, "advanced-circuit"))
        draft.title = "Advanced circuits"
        for _, spec in ipairs({
            {
                key = "item/electronic-circuit",
                name = "assembling-machine-2",
                recipe = "electronic-circuit",
                position = { -9, -5 },
            },
            { key = "item/copper-cable", name = "assembling-machine-2", recipe = "copper-cable", position = { 1, -5 } },
            { key = "item/plastic-bar", name = "chemical-plant", recipe = "plastic-bar", position = { -4, 6 } },
        }) do
            local machine =
                assert(surface.create_entity({ name = spec.name, position = spec.position, force = player.force }))
            machine.set_recipe(spec.recipe)
            machine.disabled_by_script = true
            assert(model.select(draft, spec.key, { machine }, "add", surface.index))
        end
        local pole =
            assert(surface.create_entity({ name = "big-electric-pole", position = { -4, -6 }, force = player.force }))
        pole.destructible = false
        saved_id = assert(assert(model.apply(player, draft)).id)
        for _, recipe in ipairs({ "processing-unit", "battery", "engine-unit", "chemical-science-pack" }) do
            local next_plan = model.new(player)
            assert(model.set_recipe(next_plan, recipe))
            assert(model.apply(player, next_plan))
        end
        sources.toggle(player)
        player.set_controller({ type = defines.controllers.remote, surface = surface, position = { 3, 0 } })
        player.zoom = 1.65
        player.game_view_settings = {
            hide_tall_entities = false,
            show_crafting_queue = false,
            show_rail_block_visualisation = false,
            show_tool_bar = false,
            show_controller_gui = false,
            show_minimap = false,
            show_research_info = false,
            show_entity_info = true,
            show_alert_gui = false,
            show_side_menu = false,
            show_map_view_options = false,
            show_pins_gui = false,
            show_entity_tooltip = false,
            show_quickbar = false,
            show_shortcut_bar = false,
            show_hotkey_suggestions = false,
            show_surface_list = false,
            update_entity_selection = false,
        }
        for _, element in pairs(player.gui.top.children) do
            element.visible = false
        end
        player.gui.screen["factorio-test-test-gui"].visible = false
    end)
    after_all(function()
        helpers.write_file("native-preview-complete.txt", "Mod Portal gallery finished", false)
    end)
    for index, name in ipairs(phases) do
        test(string.format("%02d %s", index, name), function()
            scene(name)
            after_ticks(10, function()
                local current = state()
                if current.compact then
                    -- Wait for native auto-centering and sizing before composing the side panel.
                    current.gui.frame.auto_center = false
                    current.gui.frame.location = { x = 1300, y = 310 }
                end
            end)
            after_ticks(30, function()
                local current = state()
                assert(current.draft.recipe == "advanced-circuit")
                assert(current.gui.frame.visible and current.gui.frame.valid)
                assert(player.surface.name == "nauvis")
                if name == "recipe-picker" then
                    assert(current.picker.group == "intermediate-products")
                    assert(current.gui.picker_frame.visible)
                elseif name == "marker-placement" then
                    assert(current.draft.marker_position.x == 3 and model.change_count(player, current.draft) == 1)
                elseif name == "recipe-alternatives" then
                    assert(current.picker.product == "fluid/heavy-oil")
                    assert(current.gui.picker_frame.visible)
                end
                local path = "gallery/" .. string.format("%02d-", index) .. name .. ".png"
                game.take_screenshot({
                    player = player,
                    position = { 3, 0 },
                    resolution = { 1920, 1080 },
                    zoom = 1.65,
                    show_gui = true,
                    show_entity_info = true,
                    hide_clouds = true,
                    hide_fog = true,
                    force_render = true,
                    path = path,
                })
                helpers.write_file("gallery-scenes.jsonl", helpers.table_to_json({
                    scene = name,
                    file = path,
                    surface = player.surface.name,
                    resolution = { player.display_resolution.width, player.display_resolution.height },
                    ui_scale = player.display_scale,
                    world_zoom = 1.65,
                    frame_location = current.gui.frame.location,
                }) .. "\n", index ~= 1)
            end)
        end)
    end
end)
