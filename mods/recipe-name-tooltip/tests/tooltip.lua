local tooltip = require("recipe_name_tooltip.tooltip")

---@param entity LuaEntity
---@return RuntimeTooltipField[]
local function fields(entity)
    local result = {}
    for _, field in pairs(entity.get_tooltip_fields()) do
        if
            type(field.name) == "table"
            and (
                field.name[1] == "recipe-name-tooltip.recipe"
                or field.name[1] == "recipe-name-tooltip.filter"
                or field.name[1] == "recipe-name-tooltip.excludes"
            )
        then
            result[#result + 1] = field
        end
    end
    return result
end

---@param entity LuaEntity
local function expect_recipe(entity)
    local recipe = assert(entity.get_recipe())
    local own = fields(entity)
    assert(#own == 1, "An inspected recipe needs exactly one tooltip field")
    assert(
        helpers.table_to_json({ own[1].value }) == helpers.table_to_json({ recipe.localised_name }),
        "The tooltip must name the current recipe, not an ingredient or product"
    )
    return own[1]
end

---@param entity LuaEntity
---@param name string
---@param excluded boolean?
---@param quality string?
---@param comparator ComparatorString?
local function expect_filter(entity, name, excluded, quality, comparator)
    local own = fields(entity)
    assert(#own == 1, "Exactly one configured item filter needs one tooltip line")
    assert(own[1].name[1] == (excluded and "recipe-name-tooltip.excludes" or "recipe-name-tooltip.filter"))
    local value = prototypes.item[name].localised_name
    if quality and script.feature_flags.quality then
        value = {
            "recipe-name-tooltip.quality-filter",
            value,
            comparator or "=",
            prototypes.quality[quality].localised_name,
        }
    end
    assert(
        helpers.table_to_json({ own[1].value }) == helpers.table_to_json({ value }),
        "The filter name must retain its quality constraint: " .. helpers.table_to_json({ own[1].value })
    )
    return own[1]
end

describe("recipe tooltip behavior", function()
    ---@type LuaSurface
    local surface
    ---@type LuaPlayer
    local player
    ticks_between_tests(1)

    before_all(function()
        surface = game.create_surface("recipe-tooltip-tests", { width = 64, height = 64, water = 0 })
        surface.request_to_generate_chunks({ 0, 0 }, 1)
        surface.force_generate_chunk_requests()
        local tiles = {}
        for x = -24, 24 do
            for y = -24, 24 do
                tiles[#tiles + 1] = { name = "lab-dark-1", position = { x, y } }
            end
        end
        surface.set_tiles(tiles)
        for _, entity in pairs(surface.find_entities()) do
            entity.destroy()
        end
        game.forces.player.research_all_technologies()
    end)

    before_each(function()
        player = assert(game.get_player(1))
        player.set_controller({ type = defines.controllers.god })
        assert(player.teleport({ 0, 10 }, surface))
        player.clear_selected_entity()
    end)

    after_each(function()
        player.clear_selected_entity()
        tooltip.select(9001, nil)
        for _, entity in pairs(surface.find_entities()) do
            entity.destroy()
        end
    end)

    ---@param name string?
    ---@param x number?
    local function machine(name, x)
        return assert(surface.create_entity({
            name = name or "assembling-machine-2",
            position = { x or 0, 0 },
            force = player.force,
        }))
    end

    test("shows recipe identity and follows changes without replacing unrelated fields", function()
        local entity = machine()
        local foreign = entity.set_tooltip_field({ name = "Other mod", value = "Keep this annotation" })
        entity.set_recipe("copper-cable")
        player.selected = entity
        local original = expect_recipe(entity).id
        entity.set_recipe("electronic-circuit")
        after_ticks(16, function()
            assert(expect_recipe(entity).id == original, "Recipe changes must update, not accumulate tooltip fields")
            assert(assert(entity.get_tooltip_field(foreign)).value == "Keep this annotation")
            player.clear_selected_entity()
            assert(#fields(entity) == 0)
            assert(assert(entity.get_tooltip_field(foreign)).value == "Keep this annotation")
        end)
    end)

    test("adds a recipe assigned after selection and removes it when cleared", function()
        local entity = machine()
        player.selected = entity
        assert(#fields(entity) == 0)
        entity.set_recipe("copper-cable")
        after_ticks(16, function()
            expect_recipe(entity)
            entity.set_recipe(nil)
            after_ticks(16, function()
                assert(#fields(entity) == 0, "Clearing a recipe must remove its stale name")
            end)
        end)
    end)

    test("ignores unsupported entities and ghosts and clears on deselection", function()
        local chest = machine("steel-chest")
        player.selected = chest
        assert(#fields(chest) == 0)
        local entity = machine(nil, 8)
        entity.set_recipe("copper-cable")
        player.selected = entity
        expect_recipe(entity)
        local ghost = assert(surface.create_entity({
            name = "entity-ghost",
            inner_name = "assembling-machine-2",
            position = { -8, 0 },
            force = player.force,
        }))
        player.selected = ghost
        assert(#fields(entity) == 0 and #fields(ghost) == 0)
        player.clear_selected_entity()
        assert(not next(storage.recipe_name_tooltip.targets), "No inspected machine means no retained work")
    end)

    test("shares one field between viewers until the last viewer leaves", function()
        local entity = machine()
        entity.set_recipe("copper-cable")
        player.selected = entity
        -- A second selection exercises ownership against real engine fields, not a connected-client claim.
        tooltip.select(9001, entity)
        expect_recipe(entity)
        player.clear_selected_entity()
        expect_recipe(entity)
        tooltip.events[defines.events.on_player_left_game]({
            name = defines.events.on_player_left_game,
            tick = game.tick,
            player_index = 9001,
        })
        assert(#fields(entity) == 0)
        assert(not next(storage.recipe_name_tooltip.targets))
    end)

    test("does not overwrite or remove an unrelated replacement field", function()
        local entity = machine()
        entity.set_recipe("copper-cable")
        player.selected = entity
        local previous = assert(expect_recipe(entity).id)
        entity.set_tooltip_field({ id = previous, name = "External annotation", value = "Keep me" })
        after_ticks(16, function()
            assert(expect_recipe(entity).id ~= previous)
            player.clear_selected_entity()
            assert(#fields(entity) == 0)
            assert(assert(entity.get_tooltip_field(previous)).value == "Keep me")
        end)
    end)

    test("cleans destroyed targets without disturbing another inspected machine", function()
        local first, second = machine(), machine(nil, 8)
        first.set_recipe("copper-cable")
        second.set_recipe("electronic-circuit")
        player.selected = first
        tooltip.select(9001, second)
        first.destroy()
        after_ticks(16, function()
            assert(not storage.recipe_name_tooltip.viewers[player.index])
            expect_recipe(second)
            tooltip.select(9001, nil)
            assert(#fields(second) == 0)
            assert(not next(storage.recipe_name_tooltip.targets))
        end)
    end)

    test("does not duplicate recipe fields when an inspected machine is cloned", function()
        local entity = machine()
        entity.set_recipe("copper-cable")
        player.selected = entity
        expect_recipe(entity)
        local clone = assert(entity.clone({ position = { 8, 0 } }))
        player.selected = clone
        expect_recipe(clone)
        assert(#fields(entity) == 0)
        player.clear_selected_entity()
        assert(#fields(clone) == 0)
    end)

    test("reconciles retained fields after reinstallation", function()
        local entity = machine()
        entity.set_recipe("electronic-circuit")
        entity.set_tooltip_field({ name = { "recipe-name-tooltip.recipe" }, value = "Old recipe" })
        entity.set_tooltip_field({ name = { "recipe-name-tooltip.recipe" }, value = "Duplicate recipe" })
        entity.set_tooltip_field({ name = "Other mod", value = "Preserved" })
        player.selected = entity
        expect_recipe(entity)
        assert(#entity.get_tooltip_fields() == 2)
        player.clear_selected_entity()
        local remaining = entity.get_tooltip_fields()
        assert(#remaining == 1 and remaining[1].value == "Preserved")
    end)

    test("tracks an automatically selected furnace recipe", function()
        local entity = machine("stone-furnace")
        player.selected = entity
        assert(#fields(entity) == 0)
        assert(assert(entity.get_fuel_inventory()).insert({ name = "coal", count = 1 }) == 1)
        assert(entity.insert({ name = "iron-ore", count = 2 }) == 2)
        after_ticks(16, function()
            assert(assert(entity.get_recipe()).name == "iron-plate")
            expect_recipe(entity)
        end)
    end)

    test("shows the fixed recipe of a rocket silo", function()
        local entity = machine("rocket-silo")
        player.selected = entity
        assert(assert(entity.get_recipe()).name == "rocket-part")
        expect_recipe(entity)
    end)

    test("names a single inserter filter in any slot and follows edits", function()
        local entity = machine("inserter")
        entity.use_filters = true
        entity.set_filter(entity.filter_slot_count, { name = "iron-plate", quality = "normal", comparator = "=" })
        player.selected = entity
        local original = expect_filter(entity, "iron-plate", false, "normal", "=").id
        entity.set_filter(entity.filter_slot_count, { name = "copper-plate", quality = "normal", comparator = "=" })
        after_ticks(16, function()
            assert(expect_filter(entity, "copper-plate", false, "normal", "=").id == original)
            player.clear_selected_entity()
            assert(#fields(entity) == 0)
            assert(not next(storage.recipe_name_tooltip.targets))
        end)
    end)

    test("does not misrepresent multiple disabled or cleared filters as a single item", function()
        local entity = machine("inserter")
        entity.use_filters = true
        entity.set_filter(1, "iron-plate")
        player.selected = entity
        expect_filter(entity, "iron-plate", false, "normal", "=")
        entity.set_filter(2, "copper-plate")
        after_ticks(16, function()
            assert(#fields(entity) == 0, "Multiple filters must not show only the first item")
            entity.set_filter(2, nil)
            after_ticks(16, function()
                expect_filter(entity, "iron-plate", false, "normal", "=")
                entity.use_filters = false
                after_ticks(16, function()
                    assert(#fields(entity) == 0, "Disabled filters must not look active")
                    entity.use_filters = true
                    entity.set_filter(1, nil)
                    after_ticks(16, function()
                        assert(#fields(entity) == 0, "Cleared filters must not retain a stale name")
                    end)
                end)
            end)
        end)
    end)

    test("distinguishes blacklist filters and preserves shared and foreign fields", function()
        local entity = machine("inserter")
        entity.use_filters = true
        entity.set_filter(1, "iron-plate")
        local foreign = entity.set_tooltip_field({ name = "Other mod", value = "Keep me" })
        player.selected = entity
        tooltip.select(9001, entity)
        local original = expect_filter(entity, "iron-plate", false, "normal", "=").id
        entity.inserter_filter_mode = "blacklist"
        after_ticks(16, function()
            assert(expect_filter(entity, "iron-plate", true, "normal", "=").id == original)
            player.clear_selected_entity()
            expect_filter(entity, "iron-plate", true, "normal", "=")
            tooltip.select(9001, nil)
            assert(#fields(entity) == 0)
            assert(assert(entity.get_tooltip_field(foreign)).value == "Keep me")
        end)
    end)

    test("shows splitter loader and storage chest filters", function()
        local splitter = machine("splitter", -8)
        splitter.splitter_output_priority = "right"
        splitter.splitter_filter = "iron-plate"
        player.selected = splitter
        expect_filter(splitter, "iron-plate", false, "normal", "=")
        local loader = machine("loader", 0)
        loader.loader_type = "output"
        loader.set_filter(1, "copper-plate")
        player.selected = loader
        expect_filter(loader, "copper-plate", false, "normal", "=")
        local chest = machine("storage-chest", 8)
        chest.set_filter(1, "iron-plate")
        player.selected = chest
        expect_filter(chest, "iron-plate", false, "normal", "=")
        assert(#fields(splitter) == 0 and #fields(loader) == 0)
    end)

    if script.feature_flags.quality then
        test("preserves quality comparisons and omits quality-only filters", function()
            local entity = machine("inserter")
            entity.use_filters = true
            entity.set_filter(1, { name = "iron-plate", quality = "uncommon", comparator = ">=" })
            player.selected = entity
            local original = expect_filter(entity, "iron-plate", false, "uncommon", "≥").id
            entity.set_filter(1, { name = "iron-plate", quality = "rare", comparator = ">" })
            after_ticks(16, function()
                assert(expect_filter(entity, "iron-plate", false, "rare", ">").id == original)
                entity.set_filter(1, { name = "iron-plate", quality = "normal", comparator = ">=" })
                after_ticks(16, function()
                    expect_filter(entity, "iron-plate", false, "normal", "≥")
                    entity.set_filter(1, { quality = "uncommon", comparator = ">=" })
                    after_ticks(16, function()
                        assert(#fields(entity) == 0, "A quality-only filter must not be assigned an item name")
                    end)
                end)
            end)
        end)
    end

    test("reconciles retained filter labels and reloads active filters", function()
        local entity = machine("inserter")
        entity.use_filters = true
        entity.set_filter(1, "iron-plate")
        entity.set_tooltip_field({ name = { "recipe-name-tooltip.filter" }, value = "Stale item" })
        entity.set_tooltip_field({ name = { "recipe-name-tooltip.excludes" }, value = "Stale exclusion" })
        player.selected = entity
        expect_filter(entity, "iron-plate", false, "normal", "=")
    end).after_reload_mods(function()
        surface = game.surfaces["recipe-tooltip-tests"]
        player = assert(game.get_player(1))
        local entity = assert(surface.find_entities_filtered({ name = "inserter" })[1])
        expect_filter(entity, "iron-plate", false, "normal", "=")
        entity.set_filter(1, "copper-plate")
        after_ticks(16, function()
            expect_filter(entity, "copper-plate", false, "normal", "=")
            player.clear_selected_entity()
            assert(#fields(entity) == 0)
        end)
    end)

    test("restores polling and ownership after native mod reload", function()
        local entity = machine()
        entity.set_recipe("copper-cable")
        entity.set_tooltip_field({ name = "Other mod", value = "Survives reload" })
        player.selected = entity
        expect_recipe(entity)
    end).after_reload_mods(function()
        surface = game.surfaces["recipe-tooltip-tests"]
        player = assert(game.get_player(1))
        local entity = assert(surface.find_entity("assembling-machine-2", { 0, 0 }))
        expect_recipe(entity)
        entity.set_recipe("electronic-circuit")
        after_ticks(16, function()
            expect_recipe(entity)
            player.clear_selected_entity()
            assert(#fields(entity) == 0)
            local remaining = entity.get_tooltip_fields()
            assert(#remaining == 1 and remaining[1].value == "Survives reload")
            assert(not next(storage.recipe_name_tooltip.targets))
        end)
    end)
end)
