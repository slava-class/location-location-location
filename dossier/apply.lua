---Append research notes using Py's existing text boundary, after all targets resolve.
---@param raw table<string, table<string, table>>
---@param catalogue table[]
---@param add_to_description fun(prototype: table, name: table|nil, value: table)
return function(raw, catalogue, add_to_description)
    local seen = {}
    for _, entry in ipairs(catalogue) do
        for _, target in ipairs(entry.targets) do
            local qualified = target[1] .. "/" .. target[2]
            if seen[qualified] then
                error("Py Research Dossier: duplicate target " .. qualified)
            end
            seen[qualified] = true
            if not (raw[target[1]] and raw[target[1]][target[2]]) then
                error("Py Research Dossier: missing " .. qualified .. "; update the dossier for this modpack")
            end
        end
    end

    for _, entry in ipairs(catalogue) do
        local note = {
            "py-research-dossier.note",
            { "py-research-dossier.topic-" .. entry.id },
            { "py-research-dossier.text-" .. entry.id },
        }
        for _, target in ipairs(entry.targets) do
            local prototype = raw[target[1]][target[2]]
            -- Prototype families may share a tooltip array. Isolate the append, not existing fields.
            local fields = {}
            for i, field in ipairs(prototype.custom_tooltip_fields or {}) do
                fields[i] = field
            end
            prototype.custom_tooltip_fields = fields

            add_to_description(prototype, nil, note)
            fields[#fields].order = 250

            add_to_description(prototype, { "py-research-dossier.sources" }, {
                "py-research-dossier.refs-" .. entry.id,
            })
            fields[#fields].order = 251
            fields[#fields].show_in_tooltip = false
            fields[#fields].show_in_factoriopedia = true
        end
    end
end
