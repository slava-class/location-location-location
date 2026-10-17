local preferences = require("location_location_location.underground_preferences")

data:extend({
    {
        type = "bool-setting",
        name = preferences.alert_setting,
        setting_type = "runtime-per-user",
        default_value = true,
        order = "a[underground-alerts]",
    },
    {
        type = "string-setting",
        name = preferences.overlay_setting,
        setting_type = "runtime-per-user",
        default_value = preferences.default_mode,
        allowed_values = preferences.modes,
        order = "b[underground-overlay]",
    },
})
