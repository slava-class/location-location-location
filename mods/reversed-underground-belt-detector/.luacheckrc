local config = require("workshop-luacheck")
config.std = "lua52+workshop_factorio"
local storage_fields = {
    read_only = true,
    fields = { reversed_underground_belt_detector = { read_only = false, other_fields = true } },
}
files["control.lua"] = { read_globals = { "script" } }
files["settings.lua"] = { read_globals = { data = { fields = { extend = {} } } } }
files["reversed_underground_belt_detector/**/*.lua"] = {
    std = "+workshop_runtime",
    read_globals = { storage = storage_fields },
}
files["reversed_underground_belt_detector/appearance.lua"] = {
    read_globals = { data = { fields = { extend = {} } } },
}
files["reversed_underground_belt_detector/warning_planner.lua"] = {
    read_globals = { data = { fields = { extend = {}, raw = { other_fields = true } } } },
}
files["tests/**/*.lua"] = {
    std = "+workshop_runtime+workshop_tests",
    read_globals = { storage = storage_fields },
}
files["dev/tuners/warnings/**/*.lua"] = {
    read_globals = {
        "game",
        "script",
        "defines",
        "rendering",
        "helpers",
        "remote",
        storage = {
            read_only = true,
            fields = {
                preview = { read_only = false, other_fields = true },
            },
        },
    },
}
files["dev/performance/**/*.lua"] = { read_globals = { "game", "defines", "rendering" } }

return config
