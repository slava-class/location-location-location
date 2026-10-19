local flags = {
    action = "py-research-dossier-flag",
    path = "py-research-dossier/flags.jsonl",
    ---@type DossierKind[]
    kinds = { "item", "recipe", "fluid", "entity", "technology", "tile" },
    reasons = { "expand", "missing", "change" },
}
local supported, reasons, notes = {}, {}, {}
for _, kind in ipairs(flags.kinds) do
    supported[kind] = true
end
for _, reason in ipairs(flags.reasons) do
    reasons[reason] = true
end
for _, entry in ipairs(require("dossier.catalog")(script.active_mods, settings.startup, script.feature_flags)) do
    for _, target in ipairs(entry.targets) do
        notes[target[1] .. "/" .. target[2]] = entry.id
    end
end

-- Both native hover identification and explicit pickers enter through this boundary.
---@param kind string?
---@param name any
---@return_overload nil, nil
---@return_overload DossierTarget, DossierPrototype
function flags.resolve(kind, name)
    if not supported[kind] or type(name) ~= "string" then
        return nil
    end
    ---@cast kind DossierKind
    local prototype = prototypes[kind][name]
    if not prototype then
        return nil
    end
    ---@type string
    local subtype = kind
    if kind == "item" or kind == "entity" then
        -- The discriminator selected the same prototype map above.
        ---@cast prototype -LuaRecipePrototype, -LuaFluidPrototype, -LuaTechnologyPrototype, -LuaTilePrototype
        subtype = prototype.type
    end
    return { base_type = kind, type = subtype, name = name, id = subtype .. "/" .. name }, prototype
end

function flags.write(player, kind, name, reason, note)
    if not reasons[reason] or type(note) ~= "string" then
        return nil
    end
    local target, prototype = flags.resolve(kind, name)
    if not target then
        return nil
    end
    local record = {
        schema_version = 1,
        tick = game.tick,
        player_index = player.index,
        force = player.force.name,
        surface = player.surface.name,
        reason = reason,
        note = note,
        target = target,
        dossier_note = notes[target.id],
        mod_versions = {},
    }
    -- Preserve the reported item; separately identify the owner of its composed entity tooltip.
    if kind == "item" and prototype.place_result then
        local entity = prototype.place_result
        record.placed_entity = { type = entity.type, name = entity.name, id = entity.type .. "/" .. entity.name }
        record.placed_entity_dossier_note = notes[record.placed_entity.id]
    end
    for mod, version in pairs(script.active_mods) do
        record.mod_versions[mod] = version
    end
    helpers.write_file(flags.path, helpers.table_to_json(record) .. "\n", true, player.index)
    return record
end

return flags
