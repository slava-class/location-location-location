std = "lua52"
max_line_length = 140

local runtime = {
    globals = { "storage" },
    read_globals = { "game", "script", "settings", "helpers", "remote", "defines" },
}
files["fixtures/**/*.lua"] = runtime
files["tuning/**/*.lua"] = runtime
