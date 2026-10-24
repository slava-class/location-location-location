-- Controlled fixtures follow overhaul post-processing and never exist without FactorioTest.
if mods["factorio-test"] then
    require("tests.prototypes")
end

require("fluid-data")

-- This resolved data-stage property is not exposed by LuaEntityPrototype.
-- Preserve the native suppression decision rather than guessing from entity names.
local hidden_recipes = {}
for _, group in pairs(data.raw) do
    for name, prototype in pairs(group) do
        if prototype.show_recipe_icon == false then
            hidden_recipes[name] = true
        end
    end
end
data:extend({
    {
        type = "mod-data",
        name = "no-alt-needed-presentation",
        data_type = "no-alt-needed.presentation.v1",
        data = { hidden_recipes = hidden_recipes },
    },
})
