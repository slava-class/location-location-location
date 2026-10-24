local event_handler = require("__core__.lualib.event_handler")

event_handler.add_libraries({ require("recipe_name_tooltip.tooltip") })

if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")({
        "tests.tooltip",
        "tests.native_preview",
        "tests.native_gallery",
    }, { log_passed_tests = true, tag_blacklist = { "native-ui" } })
end
