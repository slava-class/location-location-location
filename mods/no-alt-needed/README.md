# No ALT Needed

Inspect the building under your pointer, keep nearby recipes visible across gaps, and check inserter capacity or missing connections without covering the factory in every ALT icon.

Requires Factorio 2.1.21 or newer and [Inserter Throughput Lib](https://mods.factorio.com/mod/inserter-throughput-lib) 2.1.0 or newer. English and German setting text is included.

## Ordinary use

Leave native ALT off and point at an entity. Recipes use the recipe's own icon and quality, not a guessed first product. Applicable modules, module requests, inventories, filters, ammunition, circuit configuration and publicly exposed cargo remain available. Ordinary entity filters show only configured items, without an extra frame, `F` or equality label; blacklist markers, quality badges and non-equality comparisons remain visible. Module requests retain a blue outline and an `R`, while inventory-slot filters retain their distinct gold outline and `F` so they cannot be mistaken for actual contents. Quality badges are separate from item counts. Lab slot positions are retained, including gaps.

Recipe and ordinary content icons follow native ALT sizing and resolved prototype shifts, including optional storage-icon layout adjustments. Module grids use their own inventory scales rather than inheriting enlarged recipe or storage icons.

World icons are the primary view. A small, read-only information card supplements long combinator settings, target/filter notes, optional electrical units and inventory entries that cannot fit legibly in the resolved world layout. It is not a planner or a persistent window, does not take opened-GUI ownership, and does not add recipe-name text. Opening a panel, losing selection or leaving the viewed surface clears contextual inspection. Prototype information deliberately hidden by its owner stays hidden.

Native ALT remains yours. Installing or loading the mod does not turn it off. When ALT already supplies ordinary information, the custom ordinary layer steps aside rather than drawing a second copy.

### Nearby recipes

The neighbourhood follows the selected entity or the sampled pointer position over empty ground. It is not centred on your character. Only recipe icons spread to neighbours; module grids, contents and electrical bars do not. A machine's recipe icon keeps the same size and position whether it is hovered or nearby.

The radius includes a machine when the circular distance from the focus point to its collision footprint is within the chosen value. A large machine's near edge therefore counts. Only visible, permitted friendly entities on the viewed surface are inspected.

The default **Follow pointer across gaps** mode uses invisible, collision-free selection targets and immediately clears their selection, leaving normal machine tooltips enabled. Pointer positions are sampled in small cells rather than available as continuous engine coordinates. A bounded viewport grid coarsens with zoom, reconciles at most 32 slots per update and contains at most 1,024 targets per viewer. Sampling stops at extreme map-scale zoom when the visible span exceeds 1,792 tiles; ordinary entity selection remains available. Targets are excluded from blueprints, mining and deconstruction, cleaned up with the viewing context, and not copied when another script clones a factory.

In **single-player**, clearing the sampled helper prevents its tooltip while leaving ordinary tooltips enabled. Multiplayer clients can still predict and display a helper tooltip or selection outline: empty-ground pointer following has this known presentation limitation. Use one of the non-pointer focus choices in multiplayer to avoid helper entities. No global tooltip setting is suppressed or left altered in the save.

The live focus choice can instead retain the last valid neighbourhood, retain it for 20 ticks or hide it immediately. Overlapping recipe icons survive a focus change without being destroyed and redrawn. Exact hover details still clear immediately; native ALT, opened panels (including the player inventory), surface/force changes and loss of visibility clear contextual recipes. The default radius is **12 tiles** and is configurable per player. Existing per-player overrides are preserved when updating.

### Live experiments

Use the **Live experiments** shortcut to open or close a draggable, nonmodal panel. Its custom input starts unbound; assign a key in Controls if wanted. Boolean switches and declared choices change the actual per-player Mod Settings, remain after closing the panel, and update when settings change elsewhere. Numeric, free-text and startup options remain in Mod Settings.

Other workshop mods can opt in with runtime-per-user boolean/choice settings named `<mod-id>-experiment-…` and an owner-provided `<mod-id>-experiments.set(player_index, setting_name, value)` remote interface. The owner validates and writes its own settings. A foreign mod cannot write another owner's setting directly; the panel does not create a second preferences store.

## Capacity and connection warnings

Hovered inserters and inserter ghosts show configured capacity in items/s, centred above their icons and warning markers. This is **not measured flow**: an empty, unpowered or blocked inserter can still have a positive configured capacity. `~` marks additional estimation uncertainty. Hand-size research, overrides, quality and supported custom reach feed the approved library's public API.

Lane splitters, stacked belt transport and unreasonable geometry are explicitly labelled unsupported. Belt-connected estimates are conservatively unavailable when any force has belt-stacking research or the prototype set includes a stacking-capable loader; a momentarily unstacked belt does not prove future support. Inventory-to-inventory estimates remain available. There is no live metering or automatic placement.

Connection warnings have independent **off**, **hover**, **native ALT only** (default) and **always** modes. Inserter pickup/drop warnings and mining-drill item-output warnings treat valid native targets and discovered local ground hand-offs as connections, regardless of inventory stock. Fluid-only drills have no item-output warning. Ghosts are not warning hosts.

Fluid diagnostics distinguish missing connections (red), ordinary obstructions (orange), fluid obstructions (violet) and incompatible fluids (pink). The default issues-only mode hides healthy ports; full detail also shows connected ports (green) and unused alternatives (grey). Pump-to-rail and nonordinary connections are excluded from ordinary pipe diagnosis. These diagnostics are independent of fluid icons and yellow construction triangles.

Discovery and refresh are distributed across the visible factory rather than scanning the entire surface. A host is not called unserved until its local hand-off neighbourhood has been inspected. The reach envelope comes from loaded native prototypes; arbitrary script-extended reaches outside it are not guessed. Ignored prototype names suppress those hosts' warnings without removing their legitimate hand-offs. Other mods' alerts, state and rendering are not edited.

## Fluid presentation

Startup decluttering suppresses native fluid icons and connection arrows **together** for enabled categories. This policy affects all players and requires a restart. It does not blank shared sprites or change diagnostic warnings.

Each player separately chooses the nearby background:

- **None** — the quiet default.
- **Fluid icons** — only the local background icon layer.
- **Connection arrows** — only the local background arrow layer.

These backgrounds are custom presentation inside a bounded search envelope. They work without native ALT and are not independent switches for native prototype layers. Discovery and refresh are spread across ticks, so a dense background fills progressively rather than appearing instantly. Relevant hover and construction context show both detail layers.

Fluid directions use Factorio's native yellow connection triangles. Actual-fluid and filter-only icons are opaque and untinted, with no surrounding rings or temperature labels. At a connected pipe, the fluid icon uses that pipe's resolved native ALT position and scale, rather than a second offset position. Unconnected ports and held previews retain their construction diagrams.

Detailed construction neighbours follow **current selection only**. Losing selection clears them; neither the previous hover nor the physical player or camera becomes a substitute. The selected visible fluid target itself remains eligible. The initial detail radius is 15 tiles; the viewed-player search envelope is 50 tiles. These independent settings do not silently expand one another.

A held machine can show its own applicable ports at the native snapped build preview. That rendering target does not provide arbitrary pointer coordinates for neighbourhood searches. Preview ports with asymmetric direction-specific geometry that cannot be resolved through the public held-tool API are omitted rather than guessed; select the actual entity or ghost for resolved connection detail.

Participating startup categories are assemblers, furnaces, boilers/heat exchangers, generators/turbines, drills, offshore pumps, pumps, rocket silos, fusion reactors, fusion generators and thrusters. Originally hidden ports remain hidden.

Turning off a player's custom context does **not** restore globally suppressed native prototypes. To restore native fluid decorations, disable startup decluttering (or the relevant category) and restart.

## Optional displays

All four extras are off by default and independent of nearby recipes:

- Resource/seed icons: native mining products, fluid fuel in flamethrower turrets and seed items in agricultural-tower input. Fuel already shown by ordinary hover is not drawn a second time.
- Electrical bars: available network production and demand in MW, plus accumulator charge in percent.
- Ammunition counts: remaining rounds. Ordinary hover ammunition icons do not depend on this setting.
- Temporary native ALT: an opt-in lease while holding blueprints, planners or native wires.

The first three can apply only in normal view or in both normal and ALT views. They do not become factory-wide monitors.

Temporary ALT preserves an already-enabled initial state. A manual toggle or observable competing change ends its ownership until the relevant-tool session ends. Factorio exposes only a shared boolean, not its writer: another mod assigning the same value cannot be detected. No invisible cross-mod ownership promise is made. Turn the option off before removing the mod if it currently owns a temporary activation.

## Replacement and coexistence

Choose this mod **instead of** `hover-alt-mode`, `Cleaner-Alt-Mode`, `alt-alt-mode`, `inserter-throughput`, `inserter-throughput-fork` or `fluid-connection-indicators`; the dependency declarations reject simultaneous activation. There is no import of their private settings or saved state. The capacity library remains a declared dependency, not copied implementation.

`pYBetterItemFluidStorageIcons` remains an optional prototype-layout adjustment. Enlarged storage layouts are not applied to machine module grids. Recipe Name Tooltip remains separate and optional: this mod does not add or change its recipe-name field. Its own ghost-name limitation is unchanged.

Belt Direction Indicator, Underground Indicators, Belt Visualizer, Heat Visualizer and Assembly Analyst remain separate specialists. Their settings, alerts and fault warnings are not reset or replaced here.

The mod does not place, rotate or reconfigure buildings, change recipes or inventories, modify research or blueprints, or diagnose production efficiency. Removing it removes its presentation/state; it does not migrate another mod's state. Downgrades are not promised.

## Development and evidence

Use the [shared developer guide](../../tools/README.md). Native scenes are independently authored and require a real connected standalone client. Headless semantic assertions, programmatic selection and native pointer input are different evidence. Real two-client multiplayer, fresh-process persistence, exact-package behavior, pinned pY/Hardmode coexistence and performance calibration are release gates, not claims established by these source files.

Canonical entrypoints include `verify`, `test-ui`, `gallery`, `package-smoke`, `perf`, `runs` and `logs` with `no-alt-needed` selected. Product-owned behavioral and performance scripts live in `dev/`; shared toolkit orchestration owns processes, profiles, typed boundaries and logs. The native gallery uses an unlocked refinery recipe and produces a real 256-pixel thumbnail candidate for inspection; no placeholder thumbnail is supplied.

The product-owned `verify-native` command exercises the packaged mod without FactorioTest or a tuner, using two real clients and a fresh-process save reload:

```sh
mise run project -- no-alt-needed -- verify-native --engine /absolute/path/to/standalone/factorio
mise run project -- no-alt-needed -- verify-native --engine /absolute/path/to/standalone/factorio --retained --lifecycle
mise run project -- no-alt-needed -- verify-native --engine /absolute/path/to/standalone/factorio --profile py-hardmode --layout
mise run project -- no-alt-needed -- verify-native --engine /absolute/path/to/standalone/factorio --fluid-policy native
mise run project -- no-alt-needed -- verify-native --engine /absolute/path/to/standalone/factorio --fluid-policy pump-excluded
```

`--retained` adds the retained specialists and Recipe Name Tooltip. `--layout` separately adds the optional storage-layout adjustment and requires the full pY/Hardmode profile. `--lifecycle` starts with the two replaced diagnostics in a disposable factory, captures their actual rendering IDs, saves, inserts the combined product, and proves the old owners and objects are gone while factory state is preserved. It also saves/reloads, removes and re-adds the product. Nondefault fluid-policy trials compare native port flags with an unmodified disabled-product baseline; FMTK edits an engine-generated settings file in an owned profile. No mode changes normal-profile settings.

The two-client path also checks independent empty-ground focus, server-side selection clearing with normal tooltips enabled, bounded helper ownership, and a fresh-process save reload while pointer targets exist. These assertions do not prove that a multiplayer client's predicted tooltip is absent. Removal phases reject surviving helper entities rather than treating them as factory fixtures.

Each phase has a 20-minute server lifetime covering both sequential client startups and the assertions; nested client limits leave time for shutdown. Routine verification uses Low graphics; pass `--graphics extreme` when fixing graphical issues. Large pY graphics loads consume that same budget. Client readiness is not the end of the measured process lifetime.

Most scripted cases assign selection directly; the empty-ground probe instead invokes native hit-testing at explicit world positions, including overlapping viewers with different zoom levels. Neither measures physical mouse input or network-dependent input latency. `--interactive` deliberately leaves the owned client open for separately approved input, then requires Enter in the owning terminal. It does not grant desktop control or certify input automatically. Native receipts retain actual viewport, locale, scale, decoded captures and exact package/source identities.

Helper-tooltip checks require an actual window capture with native automatic selection. `game.take_screenshot`, even with `show_gui=true`, does not reliably capture the local selected-entity tooltip and cannot establish its absence. Compare single-player and connected-client behavior separately.

Scripted ALT comparisons change the native flag and explicitly invoke the mod's registered ALT handler, including the idle-to-active transition. This is not evidence of keyboard input.

The pY native scenarios select actual 10/20/30/40-slot plantation prototypes, configure unlocked recipes, fill their module inventories, compare nearby radii, and inspect large native warehouses, tanks and a multiple-fluid gasifier with populated connected pipes. Paired custom/native ALT captures use the same camera and zoom, with and without the optional layout adjustment; an additional pipe-content reference disables our fluid context so the pipe icons are genuinely native. Inserter captures exercise the owned capacity and warning layers together; splitter captures compare individual output lanes with native ALT. Powered fixtures keep engine warning flashes out of recipe-size comparisons.

Fluid comparison fixtures use filled internal buffers and script-disabled machinery to keep pipe contents stable between paired captures. They prove presentation and connection geometry, not production throughput; disabling a machine alone does not stop fluid moving into its buffers.

The native verifier also invokes a real scenario-event callback to prove that direct foreign setting writes are rejected, owner-mediated writes apply and restore, and startup settings cannot enter the live controls. This is not a console-privilege test. Lua checks use Luacheck for unused locals/functions/arguments and EmmyLua for native API/type errors; neither proves whole-program absence of unused modules or exports.

Performance scenarios use fixed 121-machine/484-module and 121-pump saves, 1,200 updates and three independent processes. `idle`, `radius-6`, `radius-10`, `radius-15`, `rapid`, `recipe-changes`, `cleanup-burst`, `construction`, `fluid-icons`, `fluid-arrows`, `disabled` and `radius-6-retained` are distinct workloads. For example:

```sh
mise run perf -- no-alt-needed radius-6 --diagnostics ticks
mise run perf -- no-alt-needed construction --diagnostics ticks
```

`empty-ground` reuses the fixed idle factory with the pointer mode explicitly enabled. It drives native ground hit-testing on a stationary point, alternates between opposite factory edges every update, changes zoom, then disables nearby recipes. Its separate observer checks cleared selection, bounded helpers, the expected edge machine's recipe, absence of opposite-edge leftovers and disabled cleanup. Timings include the public input driver and grid population, not physical mouse or GPU latency.

`inserter-diagnostics` adds 81 native inserters to the fixed factory and checks 162 missing-endpoint markers plus one hovered capacity label. `fluid-diagnostics` checks both ordinary ports on 121 pumps. Both connect destinations in a burst, remove them, then disable the layers; separate observers require complete warnings, recovery and disabled-layer cleanup while the hosts still exist. The inserter scene then removes its newly created hosts to restore the initial workload. Creation, setting changes, cleanup and public-API activity remain inside the measured window. These new-feature workloads are not interchangeable with the earlier recipe-only baselines.

`py-module-grids` separately exercises actual pinned pY/Hardmode plantations with 10/20/30/40 slots and 100 installed modules, changing selection between them and checking exact module counts, nearby recipes and cleanup. Its saved radius is 8, its fixture claims no deliberate pre-save warmup window, and its timing includes the full pY closure. Do not subtract it from a base-game scenario as if the workloads matched. Keep calibrated machine-specific budgets outside source defaults and supply them through the shared `--budget` option.

`mixed-remote` uses a save made with two real clients connected, independent nearby settings and two identical dense surfaces. It checks shared hover, remote-surface transitions, one viewer remaining active and final cleanup. The offline timings measure saved two-viewer simulation work, not network delivery.

Fixtures are saved while an owned native client is connected; the offline benchmark preserves that viewer state. The observer verifies the engine's connected flag, but this is not a live network connection or multiplayer-latency measurement. No synthetic connected flag is assigned. Active cases include identical public-API driver work in primary and correctness lanes. The separate observer checks current recipe identity, duplicate/out-of-range icons, audience, fluid coverage and final cleanup; its bounded `no-alt-performance-frames.jsonl` records rendering counts. Checkpoints establish completion upper bounds, not exact physical-hover latency. Headless counts do not measure GPU cost. Saves retain their per-player settings, so changing only `mod-settings.dat` is not a valid mode switch. `dev/performance/prepare.lua` describes native fixture construction; the scenario manifest owns fixture hashes and minimum pre-save settling. Missing machine-specific budgets remain explicitly inconclusive.

### Fleet workloads

`prepare-fleet` creates a fixed base-game factory with a real connected standalone client at Low, then updates the checksum-pinned `fleet-active` and `fleet-control` scenarios. It requires the other three runtime workshop products, resolved from their own metadata; none is absorbed into this product's release dependencies.

```sh
mise run project -- no-alt-needed -- prepare-fleet --engine /absolute/path/to/standalone/factorio
mise run perf -- no-alt-needed fleet-control --diagnostics ticks
mise run perf -- no-alt-needed fleet-active --diagnostics ticks
mise run perf -- no-alt-needed fleet-control --companion location-location-location --diagnostics ticks
mise run perf -- no-alt-needed fleet-control --companion recipe-name-tooltip --diagnostics ticks
mise run perf -- no-alt-needed fleet-control --companion reversed-underground-belt-detector --diagnostics ticks
mise run perf -- no-alt-needed fleet-active --companion location-location-location --companion recipe-name-tooltip --companion reversed-underground-belt-detector --diagnostics ticks
```

Use the same explicit `--engine` for all measured variants when comparing a particular executable. `fleet-control` stages this product disabled; no companions means the engine-plus-driver control, while one companion isolates that product's runtime closure. The last command measures the actual combination, not a sum of separate means.

Each scenario measures all 3,600 updates in three independent primary processes, with separate observer processes. Two 1,800-update cycles cover idle selection, constructing 1,000 reversed pairs, 1,200 dense updates, changing 121 recipes, clearing selection/opening the inventory, destroying the 4,000 belt entities and 121 machines, and rebuilding the machines. The dense interval covers the 1,080-tick overlap of the detector's 216-tick pulse and 60-tick alerts. The fixed factory also contains 484 modules, 121 filled pumps and a saved planner source highlight. It is an unpowered configuration workload, not a production-throughput or active planner-search benchmark.

Observers check reciprocal belt pairing, warning coverage and cleanup, current nearby recipe identities and audience, recipe tooltip updates/removal, bounded pointer helpers, saved-plan highlights, and preservation of an unrelated chest, tooltip, rendering and chart tag. Checkpoints are completion upper bounds, not physical pointer latency. Tick diagnostics distinguish whole-update, script and GC cost without summing overlapping categories. Rendering counts and a saved connected flag are not GPU, live-network or desync evidence.

The preparation readback supplies an exact `verify-fleet` command with its run ID and executable. It checks a fresh disk reload, then independently removes, saves and re-adds each runtime product in fresh owned server/client processes. Native startup explicitly re-charts the fixed viewing area and requires engine-confirmed visibility before selection; visibility saved earlier is not a permanent readiness guarantee. Selection is cleared before removal, as required by Recipe Name Tooltip's native-field contract. Re-adding the planner tests a newly created plan after the disabled save: Factorio does not preserve a removed mod's private storage, and this does not claim otherwise. These scripted native actions are not physical GUI-input evidence. Normal profiles and saves are never modified.

Rebuild the fixture deliberately when its inputs change; preparation and lifecycle receipts reject source or engine drift. Regenerate before a new source-qualified lifecycle run, rather than bypassing the seal. Machine-specific performance acceptance remains uncalibrated until representative measurements support a budget.

Independently authored first-party code, tests, translations and documentation are MIT licensed. Native Factorio artwork remains subject to Wube's terms. See [license.txt](license.txt).
