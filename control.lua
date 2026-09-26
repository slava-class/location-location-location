local handler = require("__core__.lualib.event_handler")

handler.add_libraries({
    require("__flib__.dictionary"),
    require("__flib__.gui"),
    require("map_tag_generator.translation"),
    require("map_tag_generator.event_handlers.planner"),
})

if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")({"tests.planner"}, {log_passed_tests = true})
end
