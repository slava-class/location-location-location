local Alt = {}
local native_wires = { ["red-wire"] = true, ["green-wire"] = true, ["copper-wire"] = true }

function Alt.relevant(player)
    local record = player.cursor_record
    if record then
        return true
    end -- All public LuaRecord types are blueprints/planners/books.
    local stack = player.cursor_stack
    if not stack or not stack.valid_for_read then
        return false
    end
    return stack.is_blueprint
        or stack.is_blueprint_book
        or stack.is_deconstruction_item
        or stack.is_upgrade_item
        or native_wires[stack.name] == true
end

local function set(player, state, value)
    state.writing = true
    player.game_view_settings.show_entity_info = value
    state.writing = nil
end

function Alt.release(player, state)
    if state.owned and player.game_view_settings.show_entity_info then
        set(player, state, false)
    end
    state.owned, state.holding, state.veto = false, false, false
end

function Alt.manual(state)
    if state.writing then
        return
    end
    state.owned = false
    state.veto = true
end

function Alt.update(player, state, enabled)
    local holding = enabled and Alt.relevant(player)
    if not holding then
        Alt.release(player, state)
        return false
    end
    if not state.holding then
        state.holding, state.veto = true, false
        if not player.game_view_settings.show_entity_info then
            state.owned = true
            set(player, state, true)
        end
    elseif state.owned and not player.game_view_settings.show_entity_info then
        -- An observable competing change ends the lease. Do not fight it.
        state.owned, state.veto = false, true
    end
    -- No API identifies another writer assigning the same native boolean value.
    -- A veto lasts until this continuous relevant-tool session ends.
    return true
end

return Alt
