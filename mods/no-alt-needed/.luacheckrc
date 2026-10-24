local config = require("workshop-luacheck")
config.std = "lua52+workshop_factorio"
local storage_fields = {
    read_only = true,
    fields = {
        schema = { read_only = false },
        players = { read_only = false, other_fields = true },
        active = { read_only = false, other_fields = true },
        world_version = { read_only = false },
        capabilities = { read_only = false, other_fields = true },
    },
}
local runtime = {
    std = "+workshop_runtime",
    read_globals = { "remote", storage = storage_fields },
}
local data_stage = {
    read_globals = {
        "mods",
        "settings",
        "defines",
        data = { fields = { raw = { other_fields = true }, extend = {} } },
    },
}
files["control.lua"] = runtime
files["scripts/**/*.lua"] = runtime
local native_storage_fields = { read_only = true, fields = {} }
for name, definition in pairs(storage_fields.fields) do
    native_storage_fields.fields[name] = definition
end
native_storage_fields.fields.no_alt_owner_probe = { read_only = false, other_fields = true }
files["dev/native-verification.lua"] = {
    std = "+workshop_runtime",
    read_globals = {
        "remote",
        storage = native_storage_fields,
    },
}
files["dev/performance/**/*.lua"] = runtime
files["dev/performance/pointer-*.lua"] = {
    std = "+workshop_runtime",
    read_globals = {
        "remote",
        storage = {
            read_only = true,
            fields = { no_alt_pointer_trial_x = { read_only = false } },
        },
    },
}
files["settings.lua"] = data_stage
files["data.lua"] = data_stage
files["data-final-fixes.lua"] = data_stage
files["fluid-data.lua"] = data_stage
files["tests/**/*.lua"] = {
    std = "+workshop_runtime+workshop_tests",
    read_globals = { storage = storage_fields },
}
files["tests/prototypes.lua"] = data_stage
files["tests/fluid_prototypes.lua"] = data_stage
return config
