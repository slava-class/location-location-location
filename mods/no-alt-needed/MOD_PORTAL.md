- **Category:** Utilities
- **License:** MIT
- **Source:** [Source](https://github.com/slava-class/location-location-location)

## Description

Inspect what you are pointing at without covering the whole factory in ALT icons.

No ALT Needed shows applicable recipes, qualities, modules and requests, contents, filters, ammunition and configuration at the selected entity. Nearby machines show recipe icons at their native ALT size whether hovered or nearby, without spreading module grids or other details. Resolved prototype layout adjustments are retained. Native ALT remains available and under your control; ordinary information is not drawn twice.

Ordinary entity filters stay compact: only configured items are shown, without extra filter frames or equality labels. Quality restrictions and blacklist markers remain available.

Nearby recipes follow the selected entity and, by default, the pointer across empty gaps on the viewed surface—not your character. Empty-ground sampling becomes coarser as you zoom out and stops at extreme map-scale zoom. Large machines count by their collision footprint. You can instead retain the last neighbourhood, use a short grace period or hide it immediately. Overlapping icons stay steady as the focus moves. The default radius is 12 tiles and is configurable per player. Updating preserves existing per-player overrides.

Empty-ground pointer following clears helper tooltips in single-player without disabling ordinary tooltips. In multiplayer, a helper tooltip or outline can still appear; choose a non-pointer focus mode to avoid this limitation.

Open the live experiments shortcut to change switches and choices while still inspecting the factory. These are your normal per-player Mod Settings, not temporary copies.

Fluid presentation has a quiet default. Startup options jointly suppress native icons and arrows for participating categories. Per-player background choices are none, local fluid icons, or local connection arrows. Relevant hover and construction context restore both detail layers, without replacing diagnostic warnings. Construction neighbours follow current selection only; optional background coverage uses its separate bounded search envelope. Startup suppression is global and requires a restart; per-player settings cannot restore native prototypes for just one player.

Fluid icons are opaque and untinted, without surrounding rings. Connected-pipe icons line up with the pipe's native ALT position and scale. Direction markers use Factorio's native yellow connection triangles.

Resource/seed icons, electrical bars, ammunition counts and temporary tool-triggered ALT are independently optional and off by default. Ordinary ammunition icons do not depend on counts. Temporary ALT preserves initial/manual choices and relinquishes ownership after observable interference; Factorio cannot identify another mod writing the same boolean value.

The world overlay is primary. A small read-only context card supplements long circuit settings, notes and legible overflow. Native tooltip timing, placement, scale and recipe-name fields are unchanged. Recipe Name Tooltip remains separate and optional.

Hovered inserters and ghosts show configured capacity in items/s, not measured flow. Approximate results are marked with `~`; unsupported belt stacking, lane splitters and geometry are labelled rather than assigned a misleading rate.

Connection warnings cover missing inserter pickup/drop targets, mining-drill item outputs and ordinary fluid connections. Choose hover-only, native ALT only, always or off independently of capacity and recipe icons. Fluid diagnostics distinguish missing connections, obstructions and incompatible fluids; full detail can also show connected and unused ports. Empty inventories are not treated as broken connections, and legitimate local ground hand-offs are recognised.

Use this instead of Hover ALT Mode, Cleaner Alt Mode, Alt Alt Mode, Inserter Throughput or its fork, and Fluid Connection Indicators; simultaneous activation is explicitly rejected. The optional pY storage-icon layout adjustment and other belt, underground, heat and production specialists remain separate.

Requires Factorio 2.1.21 or newer and Inserter Throughput Lib 2.1.0 or newer. English and German text. Independently authored and MIT licensed; the library remains a separate dependency and Factorio artwork retains Wube's terms.
