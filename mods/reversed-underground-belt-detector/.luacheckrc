std = "lua52"
max_line_length = 140
exclude_files = { "node_modules/**", ".factorio-test/**", "types/**" }
read_globals = { "table_size", table = { fields = { deepcopy = {} } } }
local storage_fields = {
    read_only = true,
    fields = { reversed_underground_belt_detector = { read_only = false, other_fields = true } },
}
files["control.lua"] = { read_globals = { "script" } }
files["settings.lua"] = { read_globals = { data = { fields = { extend = {} } } } }
files["reversed_underground_belt_detector/**/*.lua"] = {
    read_globals = {
        "game",
        "script",
        "defines",
        "prototypes",
        "rendering",
        "helpers",
        "settings",
        storage = storage_fields,
    },
}
files["reversed_underground_belt_detector/appearance.lua"] = {
    read_globals = { data = { fields = { extend = {} } } },
}
files["tests/**/*.lua"] = {
    read_globals = {
        "game",
        "script",
        "defines",
        "prototypes",
        "rendering",
        "helpers",
        "settings",
        "serpent",
        "tags",
        "describe",
        "test",
        "before_all",
        "before_each",
        "after_each",
        "after_all",
        "after_ticks",
        "ticks_between_tests",
        "async",
        "done",
        storage = storage_fields,
    },
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
