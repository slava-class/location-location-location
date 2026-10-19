-- Offline API boundary model, not a native Factorio renderer.
local environment = { writes = {}, messages = {} }

local function json(value)
    if type(value) == "string" then
        return '"'
            .. value:gsub('[%z\1-\31\\"]', function(char)
                return string.format("\\u%04x", string.byte(char))
            end)
            .. '"'
    elseif type(value) == "number" or type(value) == "boolean" then
        return tostring(value)
    end
    assert(type(value) == "table", "Unexpected JSON fixture value")
    local keys, fields = {}, {}
    for key in pairs(value) do
        assert(type(key) == "string", "Flag records contain object tables")
        keys[#keys + 1] = key
    end
    table.sort(keys)
    for _, key in ipairs(keys) do
        fields[#fields + 1] = json(key) .. ":" .. json(value[key])
    end
    return "{" .. table.concat(fields, ",") .. "}"
end

local function element(definition, parent)
    local node = { valid = true, parent = parent, style = {}, children = {}, tags = {} }
    for key, value in pairs(definition) do
        node[key] = value
    end
    if parent then
        parent.children[#parent.children + 1] = node
        if node.name then
            assert(not parent[node.name], "Duplicate GUI child")
            parent[node.name] = node
        end
    end
    node.add = function(child)
        assert(node.valid, "Adding to a destroyed GUI")
        return element(child, node)
    end
    node.destroy = function()
        assert(node.valid, "Destroying an invalid GUI")
        for i = #node.children, 1, -1 do
            node.children[i].destroy()
        end
        node.valid = false
        if parent then
            if node.name then
                parent[node.name] = nil
            end
            for i, child in ipairs(parent.children) do
                if child == node then
                    table.remove(parent.children, i)
                    break
                end
            end
        end
    end
    node.clear = function()
        for i = #node.children, 1, -1 do
            node.children[i].destroy()
        end
    end
    node.bring_to_front = function()
        node.front_requested = true
    end
    node.force_auto_center = function()
        node.center_requested = true
    end
    return node
end

prototypes = { item = {}, recipe = {}, fluid = {}, entity = {}, technology = {}, tile = {} }
local function prototype(kind, name, subtype)
    local result = { type = subtype or kind, name = name, localised_name = name }
    prototypes[kind][name] = result
    return result
end
prototype("item", "same")
prototype("recipe", "same")
prototype("recipe", "Moss-1")
prototype("recipe", "diborane").hide_from_signal_gui = true
prototype("fluid", "diborane")
prototype("recipe", "burner-inserter")
prototype("item", "moss", "module")
prototype("item", "plant_unit", "item-with-entity-data").place_result = prototype("entity", "plant_unit", "furnace")
prototype("fluid", "middle-oil")
prototype("technology", "water_transport")
prototype("tile", "stone-path")
package.loaded["dossier.catalog"] = function()
    return {
        { id = "recipe-note", targets = { { "recipe", "same" } } },
        { id = "moss-note", targets = { { "module", "moss" } } },
        { id = "plant-note", targets = { { "furnace", "plant_unit" } } },
    }
end
script = { active_mods = { base = "2.1.21", ["py-research-dossier"] = "test-version" }, feature_flags = {} }
settings = { startup = {} }
defines = { events = {} }
for _, name in ipairs({
    "on_lua_shortcut",
    "on_gui_selection_state_changed",
    "on_gui_elem_changed",
    "on_gui_click",
    "on_gui_closed",
    "on_gui_text_changed",
}) do
    defines.events[name] = name
end
local player = {
    index = 7,
    force = { name = "player", recipes = {} },
    surface = { name = "nauvis" },
    gui = { screen = element({ type = "empty-widget" }) },
    print = function(message)
        environment.messages[#environment.messages + 1] = message
    end,
}
for name, proto in pairs(prototypes.recipe) do
    player.force.recipes[name] = { name = name, prototype = proto, enabled = true, hidden = false }
end
environment.translations = { ["burner-inserter"] = "Mechanical inserter", diborane = "Diborane" }
package.loaded["__flib__.dictionary"] = {
    on_player_dictionaries_ready = "dictionaries-ready",
    get = function()
        return environment.translations
    end,
    new = function() end,
    add = function() end,
}
game = {
    tick = 12345,
    players = { player },
    get_player = function(index)
        if index == player.index then
            return player
        end
    end,
}
helpers = {
    table_to_json = json,
    multilingual_to_lower = string.lower,
    write_file = function(path, data, append, for_player)
        environment.writes[#environment.writes + 1] = {
            path = path,
            data = data,
            append = append,
            for_player = for_player,
        }
    end,
}
environment.player = player
environment.window = function()
    return player.gui.screen["py-research-dossier-flag-window"]
end
environment.events = require("dossier.flag-gui").events
environment.fire = function(name, event)
    event.player_index = player.index
    environment.events[name](event)
end
environment.dump = function()
    for _, write in ipairs(environment.writes) do
        assert(write.path == "py-research-dossier/flags.jsonl" and write.append and write.for_player == player.index)
        io.write(write.data)
    end
end
return environment
