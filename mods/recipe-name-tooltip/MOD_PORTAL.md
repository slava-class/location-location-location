# Recipe Name Tooltip

- **Category:** Utilities
- **License:** MIT
- **Source:** [slava-class/location-location-location](https://github.com/slava-class/location-location-location)

## Description

See the recipe's name in a machine's existing information tooltip, alongside its ingredients and products.

The **Recipe** line uses the recipe's translated name and updates when the recipe changes. It works with assemblers, furnaces and rocket silos, including modded machines using those entity types. Machines without a recipe and entity ghosts have no added line.

Inspect an inserter, loader, splitter or logistic storage chest with exactly one item filter to see its translated name too. The line reads **Filter**, or **Excludes** for a blacklist, and retains quality comparisons. Multiple filters, disabled inserter filters and quality-only filters do not add a name.

No extra window, shortcut or configuration is needed. Only inspected entities are tracked; the mod does not change recipes, filters or production.

Requires Factorio 2.1.21 or newer. English and German field labels are included; recipe and item names use the game's and other mods' translations.

**Before removing the mod:** move every player's pointer off entities, save, then quit. Factorio retains custom tooltip fields if their mod is removed while they are present. Reinstalling and inspecting an affected entity repairs a retained line; moving away clears it.
