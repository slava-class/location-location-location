local event_handler = require("__core__.lualib.event_handler")
event_handler.add_libraries({ require("reversed_underground_belt_detector.undergrounds") })

if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")(
        { "tests.undergrounds", "tests.native_preview", "tests.native_gallery" },
        { log_passed_tests = true, tag_blacklist = { "native-ui" } }
    )
end
