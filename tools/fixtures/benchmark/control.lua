local request = helpers.json_to_table(require("request"))
local window = require("window")
local observe
local activity
if request.purpose == "benchmark-proof" then
    observe = require("case")
end
if window.activity then
    activity = require("activity")
end
local updates = 0
local before
local checkpoints = {}
local next_checkpoint = 1

-- Activity runs in both lanes. Only the separate correctness lane observes state.
-- Steady-state primary timing has no private harness or FactorioTest at all.
script.on_event(defines.events.on_tick, function()
    updates = updates + 1
    if observe and updates == 1 then
        before = observe()
    end
    if activity then
        activity(updates)
    end
    if observe and window.checkpoints[next_checkpoint] == updates then
        checkpoints[#checkpoints + 1] = { update = updates, workload = observe() }
        next_checkpoint = next_checkpoint + 1
    end
    if updates == window.ticks then
        if observe then
            helpers.write_file(
                "benchmark-observation.json",
                helpers.table_to_json({
                    schema = 2,
                    runId = request.runId,
                    activeMods = script.active_mods,
                    before = before,
                    after = observe(),
                    updates = updates,
                    checkpoints = activity and checkpoints or nil,
                }),
                false
            )
        end
        script.on_event(defines.events.on_tick, nil)
    end
end)
