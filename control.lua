local handler = require("__core__.lualib.event_handler")
local path = "map_tag_generator.event_handlers."

handler.add_libraries({
    require("__flib__.dictionary"),
    require("__flib__.gui"),
    require(path.."gui"),
    require(path.."init"),
    require(path.."selection"),
    require(path.."tags"),
    require(path.."translation"),
})

if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")({"tests.runtime"}, {log_passed_tests = true})
end
