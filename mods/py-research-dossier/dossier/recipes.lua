local dictionary = require("__flib__.dictionary")
local recipes = { dictionary = "dossier-recipes", page_size = 8 }

function recipes.build_dictionary()
    dictionary.new(recipes.dictionary)
    for name, prototype in pairs(prototypes.recipe) do
        if not prototype.hidden and not prototype.hidden_from_player_crafting then
            dictionary.add(recipes.dictionary, name, prototype.localised_name)
        end
    end
end

function recipes.visible(recipe)
    return recipe and recipe.enabled and not recipe.hidden and not recipe.prototype.hidden_from_player_crafting
end

-- The force's crafting list is authoritative; neither hand-craftability nor signal visibility is a filter.
function recipes.search(player, query)
    local translated = dictionary.get(player.index, recipes.dictionary)
    query = helpers.multilingual_to_lower(query)
    local matches = {}
    for name, recipe in pairs(player.force.recipes) do
        if recipes.visible(recipe) then
            local label = translated and translated[name]
            if
                query == ""
                or helpers.multilingual_to_lower(name):find(query, 1, true)
                or (label and helpers.multilingual_to_lower(label):find(query, 1, true))
            then
                matches[#matches + 1] = recipe.prototype
            end
        end
    end
    table.sort(matches, function(a, b)
        return a.name < b.name
    end)
    return matches, translated ~= nil
end

return recipes
