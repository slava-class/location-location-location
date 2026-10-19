local runtime = {
    globals = { "storage" },
    read_globals = { "game", "script", "settings", "helpers", "remote", "defines" },
}
files["fixtures/**/*.lua"] = runtime
files["tuning/**/*.lua"] = runtime

return require("workshop-luacheck")
