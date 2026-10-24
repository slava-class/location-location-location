local config = require("workshop-luacheck")
config.std = "lua52+workshop_factorio"
local storage_fields = {
    read_only = true,
    fields = { recipe_name_tooltip = { read_only = false, other_fields = true } },
}
files["control.lua"] = { read_globals = { "script" } }
files["recipe_name_tooltip/**/*.lua"] = {
    std = "+workshop_runtime",
    read_globals = { storage = storage_fields },
}
files["tests/**/*.lua"] = {
    std = "+workshop_runtime+workshop_tests",
    read_globals = { storage = storage_fields },
}
return config
