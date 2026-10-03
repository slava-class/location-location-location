std = "lua52"
max_line_length = 140
exclude_files = {"node_modules/**", ".factorio-test/**", "types/**"}
read_globals = {"table_size", table = {fields = {deepcopy = {}}}}

local storage_fields = {read_only = true, fields = {
    location_location_location = {read_only = false, other_fields = true},
}}
files["data.lua"] = {read_globals = {"mods", data = {fields = {
    raw = {read_only = false, other_fields = true}, extend = {},
}}}}
files["control.lua"] = {read_globals = {"script"}}
files["location_location_location/**/*.lua"] = {
    read_globals = {"game", "script", "defines", "prototypes", "rendering", "helpers", storage = storage_fields},
}
-- This shared appearance module defines data-stage styles and runtime geometry.
files["location_location_location/gui/appearance.lua"] = {
    read_globals = {"deep_slot_background_tiling", data = {fields = {
        raw = {read_only = false, other_fields = true}, extend = {},
    }}},
}
files["tests/**/*.lua"] = {
    read_globals = {"game", "script", "defines", "prototypes", "rendering", "helpers", "serpent",
        "tags", "describe", "test", "before_all", "before_each", "after_each", "after_all", "after_ticks", "ticks_between_tests",
        storage = storage_fields},
}

files["tests/data.lua"] = {new_read_globals = {"mods", "table_size", data = {fields = {
    raw = {read_only = false, other_fields = true}, extend = {},
}}}}
