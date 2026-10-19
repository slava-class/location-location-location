local request = helpers.json_to_table(require("request"))

local function write(name, value)
    helpers.write_file(name, helpers.table_to_json(value), false)
end

local function identity()
    return {
        schema = 1,
        runId = request.runId,
        mod = request.mod,
        purpose = request.purpose,
        profile = request.profile,
        language = request.language,
        artifactSha256 = request.artifactSha256,
        tick = game.tick,
        activeMods = script.active_mods,
    }
end

local function finish()
    storage.finished = true
    script.on_nth_tick(10, nil)
end

local function observe()
    if request.purpose == "package-smoke" then
        write("modkit-observed-mods.json", identity())
        print("MODKIT_OBSERVED:" .. request.runId)
        finish()
        return
    end
    local setting = settings.startup["factorio-test-auto-start-config"]
    local autorun = setting and helpers.json_to_table(setting.value)
    -- The framework's preliminary --create run has not selected a primary suite.
    if not autorun or autorun.mod ~= request.mod.name then
        return
    end
    if not storage.started then
        storage.started = true
        write("modkit-observed-mods.json", identity())
        print("MODKIT_OBSERVED:" .. request.runId)
        if request.profile == "base" or request.profile == "space-age" then
            finish()
            return
        end
    end
    if not remote.interfaces["factorio-test"] then
        return
    end
    if remote.call("factorio-test", "getTestStage") ~= "Finished" then
        return
    end
    if not storage.flush_requested then
        game.set_wait_for_screenshots_to_finish()
        storage.flush_requested = true
        return
    end
    local result = identity()
    result.summary = remote.call("factorio-test", "getResults")
    local player = assert(game.connected_players[1], "Native verification has no connected player")
    result.player = {
        locale = player.locale,
        width = player.display_resolution.width,
        height = player.display_resolution.height,
        scale = player.display_scale,
    }
    write("modkit-native-result.json", result)
    print("MODKIT_CAPTURE_FLUSHED:" .. request.runId)
    finish()
end

script.on_nth_tick(10, observe)
script.on_init(function()
    storage.started = false
    storage.flush_requested = false
    storage.finished = false
    observe()
end)
script.on_load(function()
    assert(type(storage.finished) == "boolean", "Recreate this obsolete verification fixture save")
    if storage.finished then
        script.on_nth_tick(10, nil)
    end
end)
