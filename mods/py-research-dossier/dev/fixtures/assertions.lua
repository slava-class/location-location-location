local M = {}

function M.copy(value)
    if type(value) ~= "table" then
        return value
    end
    local result = {}
    for key, child in pairs(value) do
        result[key] = M.copy(child)
    end
    return result
end

function M.equal(expected, actual, path)
    path = path or "root"
    assert(type(expected) == type(actual), path .. ": changed type")
    if type(expected) ~= "table" then
        assert(expected == actual, path .. ": changed value")
        return
    end
    for key, value in pairs(expected) do
        M.equal(value, actual[key], path .. "/" .. tostring(key))
    end
    for key in pairs(actual) do
        assert(expected[key] ~= nil, path .. "/" .. tostring(key) .. ": unexpected addition")
    end
end

function M.only_annotations(before, after, catalogue)
    local targets = {}
    for _, entry in ipairs(catalogue) do
        for _, target in ipairs(entry.targets) do
            targets[target[1] .. "/" .. target[2]] = entry
        end
    end
    local checked = 0
    for prototype_type, group in pairs(before) do
        for name, prototype in pairs(group) do
            local qualified = prototype_type .. "/" .. name
            local current = after[prototype_type][name]
            local entry = targets[qualified]
            if entry then
                local old_fields = prototype.custom_tooltip_fields or {}
                local fields = assert(current.custom_tooltip_fields, qualified .. ": missing annotation")
                assert(#fields == #old_fields + 2, qualified .. ": lost or duplicated tooltip fields")
                for i, field in ipairs(old_fields) do
                    M.equal(field, fields[i], qualified .. "/original-field-" .. i)
                end
                local note = fields[#old_fields + 1]
                local refs = fields[#old_fields + 2]
                assert(note.show_in_tooltip ~= false, qualified .. ": note hidden in tooltip")
                assert(refs.show_in_tooltip == false, qualified .. ": references clutter hover")
                assert(refs.show_in_factoriopedia == true, qualified .. ": references hidden in encyclopedia")
                -- Compare the complete prototype after removing only our appended fields.
                local restored = M.copy(current)
                restored.custom_tooltip_fields = prototype.custom_tooltip_fields
                M.equal(prototype, restored, qualified)
                checked = checked + 1
            else
                M.equal(prototype, current, qualified)
            end
        end
    end
    for prototype_type, group in pairs(after) do
        assert(before[prototype_type], "Unexpected prototype type: " .. prototype_type)
        for name in pairs(group) do
            assert(before[prototype_type][name], "Unexpected prototype: " .. prototype_type .. "/" .. name)
        end
    end
    local expected = 0
    for _ in pairs(targets) do
        expected = expected + 1
    end
    assert(checked == expected, "Not all targets were exercised")
    return checked
end

return M
