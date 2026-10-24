# Recipe Name Tooltip

Adds a **Recipe** line to a crafting machine's existing entity tooltip. It uses the recipe's localized name—not the output item's name—and follows recipe changes while you inspect the machine. There is no extra window or placement automation.

Requires Factorio 2.1.21 or newer. Assemblers, furnaces and rocket silos use the same native recipe API; machines with no current recipe and entity ghosts have no added line. The field label is available in English and German; recipe names use the translations provided by the game and the recipe's mod.

For inserters, loaders, splitters and logistic storage chests, a **Filter** line names the item when exactly one filter is configured. Blacklist filters use **Excludes** instead. Quality comparisons are included when quality is enabled. Disabled inserter filters, multiple filters and quality-only filters have no added line; inventory-slot reservations and logistic requests are not entity filters.

## Runtime contract

Only inspected supported entities are tracked, with one native field shared by their viewers. Selection updates immediately; recipe and filter changes are checked every 15 ticks (250 ms at 60 UPS). With no inspected targets, the periodic handler is unregistered. The mod never scans the factory or changes recipes, filters, inventories, placement or production.

Engine-allocated field IDs and the mod's localized labels identify owned fields. Other mods' fields are preserved. Retained fields from a previous installation are reconciled when that entity is inspected again, without a map-wide cleanup pass.

### Removing the mod

Factorio saves custom tooltip fields with their entities; it does **not** remove them automatically when their mod is disabled. Before disabling or removing this mod, have all players move their pointers off entities, then save and quit. This clears the owned fields before the save. Removing it while a field is present can leave a stale or untranslated line; reinstalling and inspecting that entity again repairs it, and moving away clears it.

## Development

Use the shared [developer guide](../../tools/README.md) and [verification requirements](../../ARCHITECTURE.md#verification-requirements):

```sh
mise run verify -- recipe-name-tooltip
mise run test-ui -- recipe-name-tooltip --language en --engine /absolute/path/to/standalone/factorio
mise run test-ui -- recipe-name-tooltip --language de --engine /absolute/path/to/standalone/factorio
mise run gallery -- recipe-name-tooltip --language en --engine /absolute/path/to/standalone/factorio
mise run package-smoke -- recipe-name-tooltip
```

The declared engine suites cover base and Space Age, recipe assignment/change/removal, automatic furnace and fixed silo recipes, single-filter edits and removal, multiple/disabled filters, blacklist and quality semantics, ownership, shared viewers, invalidation, cloning, retained fields and native mod reload. Quality-specific cases are registered only with Space Age. Synthetic extra viewers test ownership logic, not network synchronization. Actual two-client multiplayer remains unverified; do not infer it from these tests or a headless save/reload probe. Native scenes use an oil refinery so the displayed recipe name differs from its products.

Factorio 2.1.21's screenshot API omits the entity hover tooltip, even with GUI rendering enabled. Automated native scenes check the field and capture the machine; they are not visual proof of the recipe line. Inspect that line through an actual native window capture. The world-only gallery candidate is deliberately excluded from the public gallery selection.

The runtime has no dependency on Hover ALT Mode or any other QoL mod. MIT-licensed; see [license.txt](license.txt). The thumbnail is a cropped native tooltip capture from the standalone client at Extreme, with no upscaling; Factorio artwork retains Wube's terms.
