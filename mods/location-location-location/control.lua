local handler = require("__core__.lualib.event_handler")

handler.add_libraries({
    require("__flib__.dictionary"),
    require("__flib__.gui"),
    require("location_location_location.translation"),
    require("location_location_location.event_handlers.planner"),
})

if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")(
        { "tests.planner", "tests.native_preview", "tests.native_gallery" },
        { log_passed_tests = true, tag_blacklist = { "native-ui" } }
    )
end
