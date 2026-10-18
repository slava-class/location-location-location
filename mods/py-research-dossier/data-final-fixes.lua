local apply = require("dossier.apply")
local catalogue = require("dossier.catalog")(mods, settings.startup, feature_flags)

apply(data.raw, catalogue, py.add_to_description)
