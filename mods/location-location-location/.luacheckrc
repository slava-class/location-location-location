local config = require("workshop-luacheck")
config.std = "lua52+workshop_factorio"

local storage_fields = {
    read_only = true,
    fields = {
        location_location_location = { read_only = false, other_fields = true },
    },
}
files["data.lua"] = {
    read_globals = {
        "mods",
        data = {
            fields = {
                raw = { read_only = false, other_fields = true },
                extend = {},
            },
        },
    },
}
files["control.lua"] = { read_globals = { "script" } }
files["migrations/**/*.lua"] = { read_globals = { "game", storage = storage_fields } }
files["location_location_location/**/*.lua"] = {
    std = "+workshop_runtime",
    read_globals = { storage = storage_fields },
}
-- This shared appearance module defines data-stage styles and runtime geometry.
files["location_location_location/gui/appearance.lua"] = {
    read_globals = {
        "deep_slot_background_tiling",
        data = {
            fields = {
                raw = { read_only = false, other_fields = true },
                extend = {},
            },
        },
    },
}
files["tests/**/*.lua"] = {
    std = "+workshop_runtime+workshop_tests",
    read_globals = { storage = storage_fields },
}

files["tests/data.lua"] = {
    std = "lua52",
    new_read_globals = {
        "mods",
        "table_size",
        data = {
            fields = {
                raw = { read_only = false, other_fields = true },
                extend = {},
            },
        },
    },
}

files["dev/performance/**/*.lua"] = {
    read_globals = { "game", "defines", "rendering" },
}

return config
