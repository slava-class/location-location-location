local Inspect = {}

local crafting = { ["assembling-machine"] = true, furnace = true, ["rocket-silo"] = true }
local storage_types = {
    container = true,
    ["logistic-container"] = true,
    ["linked-container"] = true,
    ["infinity-container"] = true,
    ["proxy-container"] = true,
    ["cargo-wagon"] = true,
    ["infinity-cargo-wagon"] = true,
}
local fluid_types = {
    ["storage-tank"] = true,
    pipe = true,
    ["pipe-to-ground"] = true,
    pump = true,
    ["fluid-wagon"] = true,
    ["infinity-pipe"] = true,
    ["fluid-turret"] = true,
}
-- Inventory IDs are meaningful only for their native owner type; probing every
-- ID can alias an unrelated inventory (the LuaControl contract explicitly warns of this).
local inventories_by_type = {
    container = { "chest" },
    ["logistic-container"] = { "chest" },
    ["infinity-container"] = { "chest" },
    ["linked-container"] = { "linked_container_main" },
    ["proxy-container"] = { "proxy_main" },
    ["cargo-wagon"] = { "cargo_wagon" },
    ["infinity-cargo-wagon"] = { "cargo_wagon" },
    lab = { "lab_input" },
    ["ammo-turret"] = { "turret_ammo" },
    ["artillery-turret"] = { "artillery_turret_ammo" },
    ["artillery-wagon"] = { "artillery_wagon_ammo" },
    car = { "car_ammo", "car_trunk" },
    ["spider-vehicle"] = { "spider_ammo", "spider_trunk" },
    ["logistic-robot"] = { "robot_cargo" },
    ["construction-robot"] = { "robot_cargo", "robot_repair" },
    roboport = { "roboport_robot", "roboport_material" },
    ["rocket-silo"] = { "rocket_silo_rocket", "rocket_silo_attached_cargo_unit" },
    ["cargo-pod"] = { "cargo_unit" },
    ["cargo-landing-pad"] = { "cargo_landing_pad_main" },
    ["space-platform-hub"] = { "hub_main" },
    ["asteroid-collector"] = { "asteroid_collector_output" },
}
local modules_by_type = {
    ["assembling-machine"] = defines.inventory.crafter_modules,
    furnace = defines.inventory.crafter_modules,
    ["rocket-silo"] = defines.inventory.crafter_modules,
    beacon = defines.inventory.beacon_modules,
    lab = defines.inventory.lab_modules,
    ["mining-drill"] = defines.inventory.mining_drill_modules,
    ["agricultural-tower"] = defines.inventory.agricultural_tower_modules,
}
local ammo_inventories = {
    turret_ammo = true,
    artillery_turret_ammo = true,
    artillery_wagon_ammo = true,
    car_ammo = true,
    spider_ammo = true,
}

---@param entity LuaEntity
---@return LuaEntityPrototype
function Inspect.prototype(entity)
    return entity.type == "entity-ghost" and entity.ghost_prototype --[[@as LuaEntityPrototype]]
        or entity.prototype
end

---@param entity LuaEntity
function Inspect.kind(entity)
    return entity.type == "entity-ghost" and entity.ghost_type or entity.type
end

---@param quality string|LuaQualityPrototype|nil
function Inspect.quality_name(quality)
    if type(quality) == "string" then
        return quality
    end
    return quality and quality.name or "normal"
end

function Inspect.permitted(entity)
    return entity and entity.valid and not Inspect.prototype(entity).has_flag("hide-alt-info")
end

---@param entity LuaEntity
---@return NoAltNeededRecipe?
function Inspect.recipe(entity)
    if not Inspect.permitted(entity) or not crafting[Inspect.kind(entity)] then
        return nil
    end
    local policy = prototypes.mod_data["no-alt-needed-presentation"]
    if policy and policy.data.hidden_recipes[Inspect.prototype(entity).name] then
        return nil
    end
    local recipe, quality = entity.get_recipe()
    if not recipe then
        return nil
    end
    return {
        name = recipe.name,
        quality = Inspect.quality_name(quality),
        unavailable = entity.type == "entity-ghost" and not recipe.enabled
            or entity.type ~= "entity-ghost" and entity.disabled_by_recipe,
    }
end

local function item_entry(stack, slot, counts)
    if not stack.valid_for_read then
        return nil
    end
    local entry = { name = stack.name, type = "item", quality = stack.quality.name, slot = slot }
    if counts then
        entry.count = stack.count
    end
    return entry
end

local function filter_entry(filter, slot, namespace)
    if not filter then
        return nil
    end
    if type(filter) == "string" then
        return { name = filter, type = namespace or "item", slot = slot, filter = true }
    end
    if namespace == "entity" or namespace == "asteroid-chunk" then
        return { name = filter.name, type = namespace, slot = slot, filter = true }
    end
    return {
        name = filter.name,
        type = namespace or "item",
        quality = filter.quality and Inspect.quality_name(filter.quality) or nil,
        comparator = filter.comparator,
        slot = slot,
        filter = true,
    }
end

local function add_group(snapshot, group)
    if #group.entries > 0 then
        snapshot.groups[#snapshot.groups + 1] = group
    end
end

local function read_inventory(snapshot, entity, index, id, options)
    local inventory = entity.get_inventory(index)
    local ghost = entity.type == "entity-ghost"
    local slots = inventory and #inventory
        or ghost and Inspect.prototype(entity).get_inventory_size(index, entity.quality)
        or 0
    if slots == 0 then
        return
    end
    local group = {
        id = id,
        inventory = index,
        slots = slots,
        entries = {},
        bounded = options.bounded,
        preserve_slots = options.preserve_slots,
    }
    if inventory then
        if options.preserve_slots then
            for slot = 1, slots do
                local entry = item_entry(inventory[slot], slot, options.counts)
                if entry then
                    group.entries[#group.entries + 1] = entry
                end
            end
        else
            for slot, content in ipairs(inventory.get_contents()) do
                group.entries[#group.entries + 1] = {
                    name = content.name,
                    type = "item",
                    quality = Inspect.quality_name(content.quality),
                    count = options.counts and content.count or nil,
                    slot = slot,
                }
            end
            table.sort(group.entries, function(a, b)
                if a.name ~= b.name then
                    return a.name < b.name
                end
                return (a.quality or "normal") < (b.quality or "normal")
            end)
            for slot, entry in ipairs(group.entries) do
                entry.slot = slot
            end
        end
    end
    if entity.inventory_supports_filters(index) then
        local filters = {
            id = id .. "-filters",
            inventory = index,
            slots = slots,
            entries = {},
            bounded = options.bounded,
            preserve_slots = true,
        }
        for slot = 1, slots do
            local entry = filter_entry(entity.get_inventory_filter(index, slot), slot)
            if entry then
                filters.entries[#filters.entries + 1] = entry
            end
        end
        add_group(snapshot, filters)
    end
    add_group(snapshot, group)
end

local function modules(snapshot, entity)
    local index = modules_by_type[Inspect.kind(entity)]
    if not index then
        return
    end
    local inventory = entity.get_module_inventory()
    if inventory then
        read_inventory(
            snapshot,
            entity,
            inventory.index,
            "modules",
            { bounded = true, preserve_slots = true, counts = false }
        )
    end
    local proxy = entity.type == "entity-ghost" and entity or entity.item_request_proxy
    if not proxy or not proxy.valid then
        return
    end
    local requested = {
        id = "module-requests",
        slots = inventory and #inventory or Inspect.prototype(entity).get_inventory_size(index, entity.quality),
        entries = {},
        bounded = true,
        preserve_slots = true,
    }
    for _, plan in ipairs(proxy.insert_plan) do
        local prototype = prototypes.item[plan.id.name]
        if prototype and prototype.type == "module" then
            for _, destination in ipairs(plan.items.in_inventory or {}) do
                if destination.inventory == index then
                    local slot = destination.stack + 1 -- Blueprint inventory positions are zero-based.
                    requested.slots = math.max(requested.slots, slot)
                    requested.entries[#requested.entries + 1] = {
                        name = plan.id.name,
                        type = "item",
                        quality = plan.id.quality or "normal",
                        slot = slot,
                        count = destination.count or 1,
                        request = true,
                        inventory = destination.inventory,
                    }
                end
            end
        end
    end
    add_group(snapshot, requested)
end

local function filters(snapshot, entity, kind)
    if kind == "splitter" then
        local entry = filter_entry(entity.splitter_filter, 1)
        if entry and entity.splitter_output_priority ~= "none" then
            add_group(snapshot, {
                id = "filters",
                slots = 1,
                entries = { entry },
                splitter_lane = entity.splitter_output_priority,
                splitter_direction = entity.direction,
            })
        end
        snapshot.details[#snapshot.details + 1] = {
            "no-alt-needed.splitter-priorities",
            { "no-alt-needed." .. entity.splitter_input_priority },
            { "no-alt-needed." .. entity.splitter_output_priority },
        }
        return
    end
    local group = { id = "filters", slots = entity.filter_slot_count, entries = {}, bounded = true }
    if kind == "inserter" then
        snapshot.filter_mode = entity.inserter_filter_mode
        if not entity.use_filters then
            return
        end
    elseif kind == "loader" or kind == "loader-1x1" then
        snapshot.filter_mode = entity.loader_filter_mode
    elseif kind == "mining-drill" then
        snapshot.filter_mode = entity.mining_drill_filter_mode
    end
    for slot = 1, entity.filter_slot_count do
        local namespace = kind == "asteroid-collector" and "asteroid-chunk"
            or kind == "mining-drill" and "entity"
            or "item"
        local entry = filter_entry(entity.get_filter(slot), slot, namespace)
        if entry then
            group.entries[#group.entries + 1] = entry
        end
    end
    add_group(snapshot, group)
end

local function signal_text(signal)
    if not signal or not signal.name then
        return "—"
    end
    local namespace = signal.type == "virtual" and "virtual-signal" or signal.type or "item"
    local text = "[img=" .. namespace .. "/" .. signal.name .. "]"
    if signal.quality then
        text = text .. "[img=quality/" .. Inspect.quality_name(signal.quality) .. "]"
    end
    if signal.comparator then
        text = text .. " " .. signal.comparator
    end
    return text
end
Inspect.signal_text = signal_text

-- Native combinator parameter tables contain only public values. Preserve every
-- setting, including network selectors and additional decider outputs, in the
-- read-only context card rather than squeezing an unreadable equation on a 1-tile machine.
local function parameter_lines(lines, value, depth)
    local keys = {}
    for key in pairs(value) do
        keys[#keys + 1] = key
    end
    table.sort(keys, function(a, b)
        return tostring(a) < tostring(b)
    end)
    for _, key in ipairs(keys) do
        local member = value[key]
        local label = type(key) == "number" and tostring(key) or { "no-alt-needed.field-" .. key }
        if type(member) == "table" and member.name then
            lines[#lines + 1] = { "no-alt-needed.parameter", string.rep("  ", depth), label, signal_text(member) }
        elseif type(member) == "table" then
            lines[#lines + 1] = { "no-alt-needed.parameter-group", string.rep("  ", depth), label }
            parameter_lines(lines, member, depth + 1)
        else
            local text = type(member) == "boolean" and { "no-alt-needed." .. tostring(member) } or tostring(member)
            lines[#lines + 1] = { "no-alt-needed.parameter", string.rep("  ", depth), label, text }
        end
    end
end

local function circuits(snapshot, entity, kind)
    if
        kind ~= "arithmetic-combinator"
        and kind ~= "decider-combinator"
        and kind ~= "selector-combinator"
        and kind ~= "constant-combinator"
    then
        return
    end
    local behavior = entity.get_control_behavior()
    if not behavior then
        return
    end
    if kind == "constant-combinator" then
        snapshot.details[#snapshot.details + 1] =
            { "no-alt-needed.enabled", { "no-alt-needed." .. tostring(behavior.enabled) } }
        for section_index, section in ipairs(behavior.sections) do
            snapshot.details[#snapshot.details + 1] = {
                "no-alt-needed.section",
                section_index,
                section.group,
                section.multiplier,
                { "no-alt-needed." .. tostring(section.active) },
            }
            for _, filter in ipairs(section.filters) do
                if filter.value then
                    snapshot.details[#snapshot.details + 1] = {
                        "no-alt-needed.signal-count",
                        signal_text(filter.value),
                        filter.min or 0,
                    }
                end
            end
        end
    else
        local parameters = behavior.parameters
        if parameters then
            parameter_lines(snapshot.details, parameters, 0)
            snapshot.operator = parameters.operation or (kind == "decider-combinator" and "?" or nil)
        end
    end
end

local function fluid_contents(snapshot, entity, kind)
    if not fluid_types[kind] or entity.type == "entity-ghost" then
        return
    end
    local actual = { id = "fluids", slots = entity.fluids_count, entries = {} }
    local filtered = { id = "fluid-filters", slots = entity.fluids_count, entries = {} }
    for index = 1, entity.fluids_count do
        local fluid = entity.get_fluid(index)
        local filter = entity.get_fluid_filter(index)
        if fluid then
            actual.entries[#actual.entries + 1] =
                { name = fluid.name, type = "fluid", count = math.floor(fluid.amount), slot = index }
        end
        if filter then
            local fluid_name = type(filter.fluid) == "string" and filter.fluid or filter.fluid and filter.fluid.name
            filtered.entries[#filtered.entries + 1] = { name = fluid_name, type = "fluid", filter = true, slot = index }
            if filter.minimum_temperature or filter.maximum_temperature then
                snapshot.details[#snapshot.details + 1] = {
                    "no-alt-needed.fluid-temperature",
                    signal_text({ name = fluid_name, type = "fluid" }),
                    filter.minimum_temperature or "−∞",
                    filter.maximum_temperature or "∞",
                }
            end
        end
    end
    add_group(snapshot, actual)
    add_group(snapshot, filtered)
end

function Inspect.extra_visible(mode, alt)
    return mode == "always" or mode == "normal" and not alt
end

local function extras(snapshot, entity, kind, preferences, alt)
    if entity.type == "entity-ghost" then
        return
    end
    if Inspect.extra_visible(preferences.resources, alt) then
        local group = { id = "resources", slots = 1, entries = {}, bounded = true }
        if kind == "mining-drill" then
            local target = entity.mining_target
            if target and target.valid then
                for slot, product in ipairs(target.prototype.mineable_properties.products or {}) do
                    group.entries[#group.entries + 1] = { name = product.name, type = product.type, slot = slot }
                end
            end
        elseif kind == "agricultural-tower" then
            local input = entity.get_inventory(defines.inventory.agricultural_tower_input)
            if input then
                for slot, content in ipairs(input.get_contents()) do
                    local seed = prototypes.item[content.name]
                    if seed and seed.plant_result then
                        group.entries[#group.entries + 1] = {
                            name = content.name,
                            type = "item",
                            quality = Inspect.quality_name(content.quality),
                            slot = slot,
                        }
                    end
                end
            end
        elseif kind == "fluid-turret" and (not preferences.hover or alt) then
            for index = 1, entity.fluids_count do
                local fuel = entity.get_fluid(index)
                if fuel then
                    group.entries[#group.entries + 1] = { name = fuel.name, type = "fluid", slot = index }
                end
            end
        end
        group.slots = #group.entries
        add_group(snapshot, group)
    end
    if Inspect.extra_visible(preferences.electricity, alt) then
        local network = entity.electric_network
        if network and network.valid then
            local flow = network.parent_network.flow_last_tick
            snapshot.electricity = {
                production = flow.maximum_production * 60,
                demand = flow.maximum_consumption * 60,
                satisfaction = flow.consumption_satisfaction,
            }
        end
        if kind == "accumulator" and entity.electric_buffer_size and entity.electric_buffer_size > 0 then
            snapshot.charge = entity.energy / entity.electric_buffer_size
        end
    end
end

---@return NoAltNeededSnapshot?
function Inspect.snapshot(entity, preferences, alt)
    if not Inspect.permitted(entity) then
        return nil
    end
    ---@type NoAltNeededSnapshot
    local snapshot =
        { groups = {}, details = {}, quality = preferences.hover and not alt and entity.quality.name or "normal" }
    local kind = Inspect.kind(entity)
    if preferences.hover and not alt then
        snapshot.recipe = Inspect.recipe(entity)
        modules(snapshot, entity)
        for _, name in ipairs(inventories_by_type[kind] or {}) do
            local hidden_cargo = (name == "robot_cargo" or name == "robot_repair")
                and Inspect.prototype(entity).draw_cargo == false
            if not hidden_cargo then
                read_inventory(snapshot, entity, defines.inventory[name], name, {
                    bounded = not storage_types[kind],
                    preserve_slots = name == "lab_input",
                    counts = not ammo_inventories[name],
                })
            end
        end
        if kind == "rocket-silo-rocket" and entity.type ~= "entity-ghost" then
            local pod = entity.attached_cargo_pod
            if pod and pod.valid then
                read_inventory(
                    snapshot,
                    pod,
                    defines.inventory.cargo_unit,
                    "rocket-cargo",
                    { bounded = true, counts = true }
                )
            end
        end
        filters(snapshot, entity, kind)
        circuits(snapshot, entity, kind)
        fluid_contents(snapshot, entity, kind)
        if kind == "ammo-turret" or kind == "electric-turret" or kind == "fluid-turret" or kind == "turret" then
            local targets = { id = "targets", slots = #entity.priority_targets, entries = {}, bounded = true }
            for slot, target in ipairs(entity.priority_targets) do
                targets.entries[slot] = { name = target.name, type = "entity", slot = slot }
            end
            add_group(snapshot, targets)
            if #targets.entries > 0 then
                snapshot.details[#snapshot.details + 1] = {
                    "no-alt-needed.ignore-targets",
                    { "no-alt-needed." .. tostring(entity.ignore_unprioritised_targets) },
                }
            end
        end
    end
    if Inspect.extra_visible(preferences.ammo_counts, alt) then
        for _, name in ipairs(inventories_by_type[kind] or {}) do
            local inventory = ammo_inventories[name] and entity.get_inventory(defines.inventory[name]) or nil
            if inventory then
                ---@type number
                local rounds = 0
                for index = 1, #inventory do
                    local stack = inventory[index]
                    if stack.valid_for_read then
                        rounds = rounds + (stack.count - 1) * (stack.prototype.magazine_size or 1) + stack.ammo
                    end
                end
                snapshot.details[#snapshot.details + 1] = { "no-alt-needed.ammunition", rounds }
            end
        end
    end
    extras(snapshot, entity, kind, preferences, alt)
    return snapshot
end

return Inspect
