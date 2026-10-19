local config = require("workshop-luacheck")
config.max_line_length = 120
globals = { "data", "py", "game", "script", "prototypes", "helpers", "defines", "mods", "settings", "feature_flags" }
files["dossier/catalog.lua"] = { max_line_length = false }

return config
