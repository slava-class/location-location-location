local Inspect = require("scripts.inspect")
local Presentation = {}
local card_name = "no_alt_needed_context"
-- Native ALT insets ordinary recipe/content icons; inventory sequences own their scale.
local ordinary_icon_inset = 0.9

local function destroy(objects)
    for _, object in ipairs(objects or {}) do
        if object.valid then
            object.destroy()
        end
    end
end

function Presentation.clear_card(player)
    local card = player.gui.left[card_name]
    if card and card.valid then
        card.destroy()
    end
end

function Presentation.clear(state, player)
    destroy(state.objects)
    state.objects = {}
    state.signature = nil
    state.entity = nil
    state.snapshot = nil
    state.draw_recipe = nil
    if player and player.valid then
        Presentation.clear_card(player)
    end
end

---@param vector MapPosition|Vector
---@return number, number
local function xy(vector)
    local x = (vector.x or vector[1]) --[[@as number]]
    local y = (vector.y or vector[2]) --[[@as number]]
    return x, y
end

local function bounds(entity)
    local box, position = entity.selection_box, entity.position
    return {
        left = box.left_top.x - position.x + 0.08,
        top = box.left_top.y - position.y + 0.08,
        right = box.right_bottom.x - position.x - 0.08,
        bottom = box.right_bottom.y - position.y - 0.08,
    }
end

local function inventory_layout(prototype, index)
    for _, specification in ipairs(prototype.icons_positioning or {}) do
        if specification.inventory_index == index then
            return specification
        end
    end
    return nil
end

-- Preserve resolved ALT scales and inventory layouts. Only layouts that exceed
-- a machine's footprint are constrained; storage keeps its intended enlargement.
function Presentation.geometry(entity, snapshot)
    local prototype, box = Inspect.prototype(entity), bounds(entity)
    local specification = prototype.icon_draw_specification
    local width = math.max(0.25, box.right - box.left)
    local height = math.max(0.25, box.bottom - box.top)
    local recipe_y = select(2, xy(specification.shift))
    local recipe_size = specification.scale
    local recipe_height = snapshot.recipe
            and math.min(height, math.max(recipe_size, recipe_y + recipe_size / 2 - box.top + 0.08))
        or 0
    ---@type NoAltNeededGroupLayout[]
    local groups = {}
    local bounded_count = 0
    for _, group in ipairs(snapshot.groups) do
        if group.bounded then
            bounded_count = bounded_count + 1
        end
    end
    local bounded_index = 0
    for _, group in ipairs(snapshot.groups) do
        local native = inventory_layout(prototype, group.inventory)
        local size = group.preserve_slots and group.slots or #group.entries
        local scale = native and native.scale or 0.5
        local separation = native and native.separation_multiplier or (group.bounded and 1.1 or 1)
        local columns = native and native.max_icons_per_row
            or (group.bounded and math.floor(width / 0.75) or math.ceil(math.sqrt(size)))
        columns = math.max(1, math.min(columns, math.max(1, size)))
        local rows = math.max(1, math.ceil(size / columns))
        local shift_x, shift_y
        if native then
            shift_x, shift_y = xy(native.shift)
        elseif group.bounded then
            shift_x, shift_y = 0, 0.7
        else
            shift_x, shift_y = xy(specification.shift)
        end
        if group.splitter_lane then
            -- A splitter's filter belongs to one output belt, not its entire footprint.
            local offset = group.splitter_lane == "left" and -0.5 or 0.5
            local direction = group.splitter_direction
            if direction == defines.direction.south or direction == defines.direction.west then
                offset = -offset
            end
            if direction == defines.direction.north or direction == defines.direction.south then
                shift_x = shift_x + offset
            else
                shift_y = shift_y + offset
            end
        end
        if not group.bounded then
            scale = size > 1 and scale * specification.scale_for_many or specification.scale
        end
        local cell = scale * separation
        ---@type number
        local top
        if group.bounded then
            bounded_index = bounded_index + 1
            if native then
                cell = math.min(cell, width / columns, height / rows)
                top = shift_y + (rows - 1) * native.multi_row_initial_height_modifier * scale - cell / 2
                top = math.max(box.top, math.min(box.bottom - rows * cell, top))
            else
                local region_height = math.max(0.15, height - recipe_height) / math.max(1, bounded_count)
                cell = math.min(cell, width / columns, region_height / rows)
                top = box.top + recipe_height + (bounded_index - 1) * region_height + (region_height - rows * cell) / 2
            end
            scale = math.min(scale, cell / separation)
            shift_x = math.max(box.left + columns * cell / 2, math.min(box.right - columns * cell / 2, shift_x))
        else
            top = shift_y - rows * cell / 2
        end
        local maximum_rows = native and native.max_icon_rows or rows
        local visible_rows = math.min(rows, maximum_rows)
        -- Keep icons legible instead of silently compressing arbitrary modded
        -- inventories to subpixel grids. The full overflow is in the context card.
        local overflow = cell < 0.22
        groups[#groups + 1] = {
            group = group,
            columns = columns,
            rows = visible_rows,
            cell = cell,
            icon_size = scale,
            top = top,
            left = shift_x - columns * cell / 2,
            overflow = overflow,
            maximum = overflow and 0 or visible_rows * columns,
        }
    end
    return { groups = groups, box = box, recipe_height = recipe_height, specification = specification }
end

local function draw_context(player, entity, objects)
    local function remember(object)
        objects[#objects + 1] = object
        return object
    end
    local function target(x, y)
        return { entity = entity, offset = { x, y } }
    end
    local specification = Inspect.prototype(entity).icon_draw_specification
    local function sprite(path, x, y, size, tint)
        if not helpers.is_valid_sprite_path(path) then
            return
        end
        remember(rendering.draw_sprite({
            sprite = path,
            target = target(x, y),
            surface = entity.surface,
            players = { player.index },
            x_scale = size,
            y_scale = size,
            tint = tint,
            render_layer = specification.render_layer,
        }))
    end
    local function text(value, x, y, scale, color)
        remember(rendering.draw_text({
            text = value,
            target = target(x, y),
            surface = entity.surface,
            players = { player.index },
            color = color or { 1, 1, 1 },
            scale = scale or 0.65,
            alignment = "center",
            vertical_alignment = "middle",
            use_rich_text = true,
        }))
    end
    local function rectangle(x, y, width, height, color, filled)
        remember(rendering.draw_rectangle({
            left_top = target(x - width / 2, y - height / 2),
            right_bottom = target(x + width / 2, y + height / 2),
            surface = entity.surface,
            players = { player.index },
            color = color,
            filled = filled,
            width = 1,
        }))
    end
    return sprite, text, rectangle
end

local function draw_entry(entry, x, y, layout, sprite, text, rectangle)
    local size = layout.icon_size
    local namespace = entry.type == "virtual" and "virtual-signal" or entry.type or "item"
    sprite("utility/entity_info_dark_background", x, y, size)
    if entry.name then
        sprite(namespace .. "/" .. entry.name, x, y, size * (layout.group.bounded and 1 or ordinary_icon_inset))
    end
    if entry.quality and entry.quality ~= "normal" then
        sprite("quality/" .. entry.quality, x + size * 0.28, y + size * 0.28, size * 0.32)
    end
    if entry.request or (entry.filter and layout.group.id ~= "filters") then
        rectangle(x, y, size, size, entry.request and { 0.3, 0.7, 1 } or { 1, 0.85, 0.35 }, false)
        text(entry.request and "R" or "F", x - size * 0.3, y - size * 0.3, math.min(0.6, size))
    end
    if entry.comparator and entry.comparator ~= "=" then
        text(entry.comparator, x, y + size * 0.5, math.min(0.65, size))
    end
    if entry.count then
        text(tostring(entry.count), x, y + size * 0.28, math.min(0.7, size))
    end
end

local function add_card(player, lines)
    Presentation.clear_card(player)
    if #lines == 0 then
        return
    end
    local card = player.gui.left.add({
        type = "frame",
        name = card_name,
        direction = "vertical",
        caption = { "no-alt-needed.context" },
    })
    card.style.maximal_width = 420
    local pane = card.add({ type = "scroll-pane", horizontal_scroll_policy = "never", vertical_scroll_policy = "auto" })
    pane.style.maximal_height = 520
    pane.style.maximal_width = 400
    for _, line in ipairs(lines) do
        local label = pane.add({ type = "label", caption = line })
        label.style.single_line = false
        label.style.maximal_width = 385
    end
end

function Presentation.recipe(player, entity, recipe, state)
    local signature = recipe and helpers.table_to_json(recipe) or ""
    if
        state.entity == entity
        and state.signature == signature
        and state.objects
        and (#state.objects == 0 or state.objects[1].valid)
    then
        return
    end
    Presentation.clear(state)
    state.entity, state.signature = entity, signature
    if not recipe then
        return
    end
    state.objects = {}
    local sprite = draw_context(player, entity, state.objects)
    local specification = Inspect.prototype(entity).icon_draw_specification
    local x, y = xy(specification.shift)
    local size = specification.scale
    sprite("utility/entity_info_dark_background", x, y, size)
    sprite("recipe/" .. recipe.name, x, y, size * ordinary_icon_inset)
    if recipe.quality ~= "normal" then
        sprite("quality/" .. recipe.quality, x + size * 0.3, y + size * 0.3, size * 0.3)
    end
    if recipe.unavailable then
        sprite("utility/crafting_machine_recipe_not_unlocked", x, y, size * 0.65)
    end
end

---@param draw_recipe boolean
function Presentation.update(player, entity, snapshot, state, draw_recipe)
    if not snapshot then
        Presentation.clear(state, player)
        return
    end
    local signature = helpers.table_to_json(snapshot)
    local valid = state.entity == entity and state.signature == signature and state.draw_recipe == draw_recipe
    if valid then
        for _, object in ipairs(state.objects or {}) do
            if not object.valid then
                valid = false
                break
            end
        end
    end
    if valid then
        return
    end
    Presentation.clear(state, player)
    state.entity, state.signature, state.snapshot, state.objects = entity, signature, snapshot, {}
    state.draw_recipe = draw_recipe
    local sprite, text, rectangle = draw_context(player, entity, state.objects)
    local geometry = Presentation.geometry(entity, snapshot)
    local lines = {}
    for _, line in ipairs(snapshot.details) do
        lines[#lines + 1] = line
    end
    if snapshot.recipe and draw_recipe then
        local recipe_state = {}
        Presentation.recipe(player, entity, snapshot.recipe, recipe_state)
        for _, object in ipairs(recipe_state.objects) do
            state.objects[#state.objects + 1] = object
        end
    end
    if snapshot.quality ~= "normal" then
        sprite("quality/" .. snapshot.quality, geometry.box.right - 0.15, geometry.box.top + 0.15, 0.3)
    end
    for _, layout in ipairs(geometry.groups) do
        local group = layout.group
        local overflow = {}
        for index, entry in ipairs(group.entries) do
            local slot = group.preserve_slots and entry.slot or index
            if slot <= layout.maximum then
                local x = layout.left + ((slot - 1) % layout.columns + 0.5) * layout.cell
                local y = layout.top + (math.floor((slot - 1) / layout.columns) + 0.5) * layout.cell
                draw_entry(entry, x, y, layout, sprite, text, rectangle)
            else
                overflow[#overflow + 1] = {
                    "no-alt-needed.overflow-entry",
                    entry.slot,
                    Inspect.signal_text(entry),
                    entry.count or "",
                    entry.request and "R" or entry.filter and "F" or "",
                }
            end
        end
        if #overflow > 0 then
            lines[#lines + 1] = { "no-alt-needed.overflow", #overflow, { "no-alt-needed.group-" .. group.id } }
            for _, line in ipairs(overflow) do
                lines[#lines + 1] = line
            end
        end
    end
    if snapshot.filter_mode == "blacklist" then
        sprite("utility/filter_blacklist", geometry.box.left + 0.15, geometry.box.top + 0.15, 0.35)
    end
    if snapshot.operator then
        text(snapshot.operator, 0, geometry.box.top + 0.3, 0.7)
    end
    if snapshot.electricity then
        local electricity = snapshot.electricity
        local y = geometry.box.bottom + 0.2
        local width = math.max(0.6, geometry.box.right - geometry.box.left)
        rectangle(0, y, width, 0.12, { 0.08, 0.08, 0.08, 0.9 }, true)
        local fraction = math.max(0, math.min(1, electricity.satisfaction))
        rectangle(-width * (1 - fraction) / 2, y, math.max(0.001, width * fraction), 0.08, { 0.25, 0.85, 0.3 }, true)
        lines[#lines + 1] = {
            "no-alt-needed.electricity",
            string.format("%.3f", electricity.production / 1000000),
            string.format("%.3f", electricity.demand / 1000000),
        }
    end
    if snapshot.charge then
        local width = math.max(0.6, geometry.box.right - geometry.box.left)
        local y = geometry.box.bottom + 0.4
        rectangle(0, y, width, 0.12, { 0.08, 0.08, 0.08, 0.9 }, true)
        local fraction = math.max(0, math.min(1, snapshot.charge))
        rectangle(-width * (1 - fraction) / 2, y, math.max(0.001, width * fraction), 0.08, { 0.3, 0.65, 1 }, true)
        lines[#lines + 1] = { "no-alt-needed.charge", string.format("%.1f", snapshot.charge * 100) }
    end
    add_card(player, lines)
end

return Presentation
