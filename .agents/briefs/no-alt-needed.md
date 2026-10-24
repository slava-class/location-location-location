# No ALT Needed — implementation brief

Status: implementation and verification are authorized. **No ALT Needed**, ID **`no-alt-needed`**, owns contextual inspection, nearby recipes, fluid presentation, inserter-capacity estimates and connection warnings. The user selected one comprehensive information mod, not another throughput product. This brief specifies independently authored behavior, not an upstream implementation to port. Normal-profile installation, commits, pushes and publication remain separately authorized operations.

## Outcome and ownership

Make routine inspection and construction understandable without pressing ALT or covering the entire factory with icons. Show detail at the player's focus, recipes on nearby machines, and fluid connections when relevant. Native ALT remains available and under the player's control; the mod must not force it off on installation or load.

The independent product's `mods/no-alt-needed/info.json` owns identity, dependencies and version; this brief is not another product registry. First-party code is MIT licensed. Target Factorio **2.1.21 or newer**, with base, Space Age and the user's pY/Hardmode combination verified separately. Do not assume Space Age and pY must run together. Use native APIs and the explicitly approved MIT **Inserter Throughput Lib 2.1.0** through its public API; retain it as a declared dependency, not absorbed implementation.

Follow the [workshop architecture](../../ARCHITECTURE.md), [developer guide](../../tools/README.md) and [independent-implementation workflow](../skills/factorio-mod-subsumption/SKILL.md), subject to the implementation-ownership decision below. Runtime, settings, locales, independently written tests, scenes and any justified tuner belong to the product. Bun + Effect owns orchestration, Effect Schema owns boundary contracts, and Effect CLI owns commands. Reuse the existing toolkit rather than adding another supervisor, validator or development stack.

## Agreed presentation and defaults

The profile preferences below were read offline and accepted as the desired baseline. They are not a measurement of a running player's ALT or shortcut state. Newly proposed behavior is identified separately.

| Layer                       | Default and required behavior                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact hover                 | Enabled. Show the ordinary information applicable to that entity, not just its recipe. Preserve quality, installed/requested modules and relevant contents/configuration.                              |
| Nearby recipes              | Enabled by default. Recipe icons retain their native ALT size and position whether hovered or nearby; do not spread module grids, inventories or electrical bars to the whole neighbourhood.           |
| Global fluid clutter        | Suppress native fluid icons and connection arrows together for participating categories; custom per-player presentation supplies relevant detail. Default nearby background: none.                     |
| Fluid construction coverage | Preserve the observed 15-tile detailed-building radius and 50-tile player search envelope as initial user-facing coverage. These are settings, not a required scan algorithm or a measured UPS budget. |
| Extra resource icons        | Available, default off: extracted resource, pumpjack output, turret fuel or planted seed where appropriate.                                                                                            |
| Electrical bars             | Available, default off: network production/demand and accumulator charge.                                                                                                                              |
| Ammunition counts           | Available, default off. Ordinary ammunition icons are not disabled by this preference.                                                                                                                 |
| Automatic native ALT        | Available, default off. Opt-in temporary activation while holding relevant blueprints/planners/wires must preserve the player's own ALT choice.                                                        |
| Native interface            | Do not change native tooltip delay, interface scale, tooltip placement or mod-owner labels.                                                                                                            |

Each optional display has an independent per-player setting; allow normal-view-only or normal-and-ALT presentation where applicable. Do not silently turn optional displays on when enabling nearby recipes. Keep labels plain, explain units and restart requirements, and independently author English/German text rather than importing translations.

### Exact-hover coverage

This is a behavioral inventory, not permission to narrow the replacement to the easiest entities. Confirm each family against native behavior and independently described reference observations before declaring completion.

| Family                    | Information to retain                                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production                | Configured/active recipe, recipe quality and unavailable-recipe distinction on applicable assemblers, furnaces, processing machines and silos. Recipe identity is not merely the first output item.                                                                    |
| Modules and research      | Installed modules, pending module requests and quality on machines, beacons, drills, labs and other module-bearing entities. Lab contents retain meaningful slot gaps.                                                                                                 |
| Storage and fluids        | Applicable chest, tank, pipe, pump and wagon information, including filters versus actual contents. Respect deliberately enlarged storage icons without making machine module grids spill into neighbouring buildings.                                                 |
| Logistics and circuits    | Inserter/loader filters, splitter filtering and priorities, combinator signals/operators/settings, including quality constraints and blacklist distinctions.                                                                                                           |
| Combat and space          | Applicable ammunition, targeting priorities, asteroid-collection filters, rocket/cargo-pod contents and moving robot cargo/repair indicators. Follow the engine's actual selected entity; do not change selection priority so flying objects steal the pointer.        |
| Ghosts and modded layouts | Available recipe/filter/module/configuration information on ghosts; recognize genuine native/publicly exposed information associated with modded buildings. Do not expose intentionally hidden internals or fabricate information unavailable through a supported API. |

Respect native information-suppression rules and resolved prototype layout intent. Recipe and ordinary-content icon sizes must match native ALT, including optional storage layout adjustments; module grids retain their own inventory scales. Duplicate icons, unreadable badges, icon overlap and retained visuals after their target disappears are correctness defects. Pixel-identical reproduction of every native drawing effect is not a promise. If a capability needs a third-party public interface, the researcher must supply its reviewed contract; do not read private storage or add a name-based compatibility workaround. Any unsupported behavior must be brought back explicitly, not silently omitted.

Keep ordinary entity filters compact: omit unused filter slots, redundant filter frames/letters and equality labels, while preserving blacklist and non-equality/quality semantics. Keep inventory-slot filters distinguishable from actual contents and requested modules distinguishable from installed modules.

Splitter filters belong to their chosen output, not a centred inventory grid spanning both outputs. Preserve the actual configured item/quality, follow left/right output priority and rotation, and clear removed filters. Do not invent an additional blacklist symbol when the configured filter item itself supplies that artwork.

Recipe-name text remains owned by the separate [Recipe Name Tooltip](../../mods/recipe-name-tooltip/README.md). This mod must work without it and must neither duplicate nor rewrite its tooltip field. With the companion enabled, hover should show the recipe's localized name once. The companion currently excludes ghosts; do not advertise ghost recipe-name tooltips merely because this mod can show a ghost's recipe icon.

### Nearby recipes: honest pointer semantics

Use a neighbourhood centred on the **currently hovered entity**, on the viewed surface, not the character's location. Hovering a belt or other selectable entity may reveal nearby machines too. Include the hovered recipe-bearing machine without drawing its recipe twice. The per-player focus experiment offers **retain** (default: keep the last valid anchor across gaps), **grace** (20 ticks), and **selection** (hide immediately). Preserve overlapping recipe renderings when the anchor changes. Exact-hover details still clear immediately. Native ALT, obstructing native panels, force/surface changes and lost visibility must clear retained recipes.

Factorio 2.1.21 documents [selected-entity changes](https://lua-api.factorio.com/2.1.21/events.html#on_selected_entity_changed), [player selection](https://lua-api.factorio.com/2.1.21/classes/LuaControl.html#selected) and [cursor coordinates on custom inputs](https://lua-api.factorio.com/2.1.21/events.html#CustomInputEvent), but no general continuous world-pointer query or mouse-move event. This contract does **not** promise a spotlight following the pointer over empty ground. Do not manufacture mouse movement with GUI interception, dummy selectable entities or synthetic input.

Provide a per-player radius and enable/disable control. Choose the numerical default through native dense-pY/readability and cost trials before packaging, not by reusing the fluid radius. Define and test the inclusion boundary for large footprints so near-edge machines are not inexplicably omitted. Reveal only information permitted by the player's viewed surface/force/visibility; no fog-of-war disclosure.

When native ALT already provides the same recipe or hover information, avoid drawing a second copy. Fluid-context rendering may still be necessary where native fluid clutter is suppressed. Extra displays follow their own explicit visibility setting rather than being silently disabled or doubled.

Provide a real, shortcut-toggleable **Live experiments** panel that remains open while the player inspects the world. Do not set `player.opened` or create a second preference store. Native per-player settings remain authoritative, including changes made through Mod Settings and persistence after closing the panel. Show this product's live Boolean/choice controls. Other products opt in with `<owning-mod-id>-experiment-…` settings and an owner-executed `<owning-mod-id>-experiments` remote interface exposing `set(player_index, setting_name, value)`. Discover ownership through `LuaModSettingPrototype.mod`, not a second registry; only the owning mod writes its native setting, with the engine enforcing the value contract. Keep numeric, free-text, startup and runtime-global settings in the native settings surface.

### Fluid construction and native ALT

Cover assemblers, furnaces, boilers/heat exchangers, generators/turbines, mining drills, offshore pumps, pumps, silos, fusion reactors/generators and thrusters where their prototypes expose relevant connections. Participation defaults on for all these categories. Distinguish input/output directions, relevant fluid filters and actual fluids; re-evaluate after rotation, recipe changes, replacement and ghost revival. Use opaque, untinted, ring-free fluid icons and Factorio's native yellow connection triangles, including correctly oriented held previews.

Omit temperature labels from the world-space fluid overlay.

For actual connected pipes, align fluid content and matching filter icons with the pipe's resolved native ALT position and scale. Refresh that geometry when the connection or pipe prototype changes. Unconnected ports and held previews remain explicit construction diagrams rather than claiming an existing pipe anchor.

Preserve three per-player nearby-background choices: **none**, **fluid icons**, or **connection arrows**, defaulting to none. Maintain any chosen background layer only within the configured local search envelope, not throughout the factory. Exact hover and relevant construction context restore both detail layers. These modes must work without native ALT; native ALT must not duplicate custom fluid detail. Name them as presentation choices rather than claiming independent native arrow/icon switches.

Factorio's [per-connection suppression flag](https://lua-api.factorio.com/2.1.21/types/PipeConnectionDefinition.html#hide_connection_info) hides icons and arrows together. Do not blank shared utility sprites to simulate selective hiding: that broadens the effect beyond participating categories and can affect warning graphics. Bound optional background discovery, refresh and rendering independently from quiet-mode work, and measure each mode rather than assuming equivalent UPS cost.

Construction information follows relevant held pipes/fluid machinery and actual hovered targets. The detailed neighbourhood is centred on current selection, not a retained last-hover position; selection loss clears that neighbourhood instead of silently substituting the physical player or camera position. A [native build-cursor render target](https://lua-api.factorio.com/2.1.21/concepts/ScriptRenderTargetTable.html) may show the held machine's own applicable connection information at its snapped preview, but does not expose coordinates for querying an arbitrary-pointer neighbourhood. Background-layer coverage remains a separate explicit choice. Never reveal an entire factory merely to maintain a local overlay.

Prototype-level suppression can be global/startup-scoped. Do not mislabel such settings as independent per-player toggles or promise that disabling custom rendering restores suppressed native prototypes for one player. Keep category/startup policy distinct from per-player presentation, document any shared effect, and verify mixed-player settings explicitly. Disabling startup decluttering and restarting must restore native fluid presentation.

If automatic ALT is opted into, test both initial ALT states, changing held tools, manual ALT changes while holding a tool, setting changes, save/load and disconnect. It must not undo a later explicit player choice; relinquish ownership after manual toggles or observable external interference. The shared native ALT boolean exposes no writer identity: another mod assigning the same value is unobservable. Document that limit rather than claiming detection or inventing a private cross-mod ownership protocol.

## Inserter capacity and connection warnings

- Show a compact, centred rate for the actually hovered inserter or inserter ghost, separated from its filter icons and warning markers. It is an estimate of configured transfer capacity, not measured flow, adequate supply or guaranteed production.
- Use the [versioned public library contract](https://github.com/JanSharp/inserter-throughput-lib/blob/2.1.0/readme.md): construct the definition from the real entity, estimate capacity, and retain the library's uncertainty classification. Reuse its definition table where supported. Do not copy a donor calculator or supply a second formula.
- Explicitly report unsupported configurations rather than a plausible rate or false zero. The approved library does not support belt stacking; do not display an ordinary estimate for a setup where stacked belt transport cannot be excluded. Verify quality, hand-size research/overrides, custom reach, ghosts, belt geometry and the pinned pY machines.
- **Exclude live metering and `/it-stopwatch`**, as selected by the user. Removing the old throughput mod intentionally removes that separate feature.
- Inserter pickup/drop and mining-drill output warnings describe missing or obstructed transfer connections, not empty inventories, power, ingredient shortages or production efficiency. Recognize valid native endpoints and legitimate ground hand-offs between inserters/drills. Do not warn on host ghosts.
- Fluid warnings distinguish connected ports, unused/redundant ports, missing/ordinarily obstructed ports, fluid obstructions and incompatible fluid filters. Preserve direction and multiple ports; exclude pump-to-rail and nonordinary connections from pipe-placement claims. Full detail and issues-only presentation are separate choices.
- Warning visibility and fluid decorations are independent. Preserve an ALT-only default with per-player off/hover/ALT/always choices, separate inserter/drill and fluid-detail controls, and an explicit ignored-prototype list. Do not import another mod's global settings.
- Cover the visible factory without a continuous whole-surface scan. Bound discovery and refresh work, prioritize the selected target, retain overlapping renderings, and revalidate changes that lack a convenient notification. Respect force, visibility, surface and player isolation.
- Verify the old-to-new transition in an isolated factory: factory entities/configuration remain intact, foreign owned visuals disappear when their mods are disabled, and the exact combined package supplies the replacement behavior without development companions.

## Replacement and coexistence

The following public mod IDs are included solely to define external compatibility, not as source inputs:

- Replace `hover-alt-mode` and `Cleaner-Alt-Mode`; require an explicit mutually exclusive mod selection instead of silently disabling them or transferring their private state. Reject simultaneous activation clearly. Apply the same explicit exclusion to `alt-alt-mode`, another overlapping renderer.
- Keep `pYBetterItemFluidStorageIcons` as a compatible optional prototype-layout adjustment, not a code dependency to absorb. Verify ordinary and enlarged storage with and without it.
- Keep `recipe-name-tooltip`, `belt-direction-indicator`, `UndergroundIndicatorsFixed`, `belt-visualizer`, `heat-visualizer` and `assemblyanalyst` separate; preserve their preferences and specialist displays.
- Replace `inserter-throughput-fork` and `fluid-connection-indicators` only after the combined package is verified. Explicitly exclude overlapping throughput/warning owners, including the original `inserter-throughput`; never disable them or migrate their private state automatically.
- New settings belong to the new mod. Use the accepted defaults, not a hidden import of another mod's settings. Existing factories, recipes, inventories, research and blueprints must remain unchanged. Own and clean up only this mod's presentation/state.
- Removal/re-addition and future upgrades need explicit tests. Do not promise downgrade compatibility or a donor-state migration. The previous local third-party patch is a research reference, never the starting implementation.

No automatic placement, recipe edits, entity rotation, belt routing, production-efficiency diagnosis, recipe-planner UI or continuous whole-factory monitoring belongs in this product. No normal-profile change is authorized by this brief.

## Implementation ownership

The user has directed the main session to implement, review and verify this product itself. Subagents may perform read-only source discovery, not implementation, test authoring, review decisions or verification. This explicitly replaces the fresh-writer handoff requirement for this work.

The main session has inspected upstream source, so this work must not be represented as a source-separated clean-room implementation. The no-copy-and-relicense policy remains unchanged: do not transplant upstream code, tests, assets, translations, private interfaces or implementation-shaped specifications. Use native APIs, original first-party implementation and independently designed behavioral coverage. Reference observations identify player needs and comparative strengths/limitations, not an implementation to translate.

Preserve accurate authorship and exposure records under ignored research output. Existing partial first-party work may be reviewed and completed; no authoring or verification claim is established merely by an agent's report.

For the inserter-capacity/connection-warning extension, the source-discovery agents `ThroughputBehavior` and `ThroughputLibraries` supply behavior-only findings. The main writer uses those screened findings, existing workshop code, native API contracts and the approved library's public documentation—not donor implementation files or source-bearing transcripts. Preserve the earlier product's source-informed provenance; do not relabel the entire mod as a source-separated clean-room implementation. Keep exact package/research and handoff identities in ignored evidence, not this durable contract.

## Verification and acceptance checklist

A checked item requires current source/package-qualified evidence. None of the following implementation gates is complete merely because the brief exists.

- [ ] **Reference baseline:** the research side exercises the selected incumbent stack and the serious alternative in disposable profiles, supplies a source-free behavioral comparison, and records exact versions/settings/engine and diagnostic failures separately from observed visuals. Source inspection and listing claims are not runtime evidence.
- [ ] **Default workflow:** start with native ALT off and all four extras off; inspect each information family, construct fluid connections and move among nearby machines without needing an extra mode hotkey. Verify native ALT on/off, nearby recipes off/on, setting changes and empty-ground/GUI cleanup.
- [ ] **Recipe semantics:** multiple recipes sharing an output, multi-output/catalyst recipes, no recipe, changing/clearing recipes, automatic furnace recipes, locked recipes, quality, ghosts and revival. Do not claim configured throughput or production activity from a recipe icon.
- [ ] **Geometry:** ordinary machines plus large pY farms with 10/20/30/40 module slots; modules/requests remain distinguishable and within their intended display region, while enlarged storage contents remain readable. Exercise rotation, zoom, interface scale and dense adjacent machines.
- [ ] **Fluids:** every supported category, pipe placement, filters, input/output direction, empty/filled state, recipe/rotation changes, quiet/background-icons/background-arrows modes and construction-selection loss. Test local-envelope boundaries, startup-disabled categories, held-machine previews and all modes with native ALT off/on. Separate per-player visuals from startup-global prototype effects.
- [ ] **Optional displays:** independently exercise resource icons, electrical bars, ammunition counts and temporary ALT activation, both enabled and disabled; prove ordinary hover contents are not accidentally gated by these switches.
- [ ] **Lifecycle:** recipe/inventory/module changes without pointer movement; construction/mining/death, entity replacement/teleport, ghost revival, surface deletion/change, force change, remote view, player disconnect/rejoin and repeated disable/re-enable. No stale render objects, foreign-state cleanup or altered production.
- [ ] **Persistence:** actual save completion, fresh-process reload, insertion into an existing disposable factory, exclusion of the replaced renderers, removal/re-addition and restoration of native presentation. Same-process reload is not persistence proof.
- [ ] **Compatibility:** base, Space Age and pinned pY/Hardmode separately; the compatible layout adjustment and retained diagnostics; the tooltip companion present/absent. Reject known overlapping renderers explicitly. Record untested combinations rather than claiming universal compatibility.
- [ ] **Multiplayer:** two real connected clients, different settings/locales/ALT states, same and different hovered entities, remote views, join/leave and fresh load. Verify per-player visibility and record network-dependent hover latency. Synthetic players do not satisfy this gate; no public multiplayer claim before it passes.
- [ ] **Native presentation:** actual standalone-client captures at Extreme, observed viewport/zoom/scale/locale, and real input where hover delivery is claimed. Use researched/unlocked recipes for the thumbnail/example. Inspect the native tooltip through a real window capture if the engine screenshot API omits it.
- [ ] **Exact product:** canonical verification plus an independent exact-ZIP scenario exercising hover, nearby recipes, fluid context and cleanup without FactorioTest, tuners or undeclared dependencies. A load-only smoke is insufficient.
- [ ] **Product finish:** independently authored player README, Portal copy, settings/locales, license, relevant changelog and genuine assets. Document pointer semantics and startup/per-player distinctions without internal research diaries or claims of total native visual parity.
- [ ] **Stable focus and live experiments:** verify all three gap modes, overlap preservation, exact-hover cleanup, native setting/UI synchronization, non-modal inspection, player isolation and persistence after closing/reloading.
- [ ] **Rates and warnings:** verify supported estimates against real transfers; unsupported belt stacking remains explicit. Exercise valid/invalid endpoints, hand-offs, drill outputs, fluid connection classes, visibility/settings, lifecycle and replacement cleanup with native captures.

The two input-dependent gates remain open until approved physical input and a native window capture exercise pointer delivery, the native tooltip and network-dependent hover latency. Connected-client scripted scenarios and engine-generated captures cover the other native behavior but cannot substitute for those observations. Reference qualification must preserve the distinction between an unchanged upstream release that fails to load and an explicitly instrumented observation package.

### Performance proof

Measure before implementation and after, using the existing performance/owned-process/live-log contracts. Reference-stack comparisons and candidate-revision comparisons are different experiments: replacement changes mod identities/dependencies, so do not weaken the strict canonical comparator to pretend the closures match.

- Cover no viewers/idle, one stable hover, rapid selection changes, recipe changes while stationary, dense nearby recipes, fluid construction, large module grids, mixed viewers/settings, remote surfaces and cleanup bursts. Include the retained QoL stack to observe aggregate periodic work.
- Report total simulation ms/update, relevant script cost, update peaks, retained render/state growth, and hover-to-visible completion latency. Measure graphics/frame cost separately with connected native clients; saved players and headless visibility flags do not prove rendered cost.
- Use repeated comparable independent runs, fixed fixtures/settings and hardware/backend identity, with sample counts and spread. Separate cold/warm startup and observer overhead. Do not claim a speedup from a helper-only microbenchmark or a handful of tick maxima.
- Keep gameplay work deterministic and bounded per tick. No continuous whole-factory scan or radius change that hides required information to manufacture a gain. Fully disabled/inactive layers must not retain unnecessary active work.
- Calibrate the nearby radius, refresh latency and machine-specific acceptance budget from these runs before local installation. No universal per-mod UPS allowance or invented performance pass. Keep cheap run diagnostics, make detailed profiling opt-in, remove disposable probes, and smoke the final uninstrumented package.

Retained measurements begin with the first measured implementation revision; there is no pre-implementation UPS result to report. Repeated controls establish a local baseline and radius budget, not a speedup over the incumbent stack. Keep physical-input latency outstanding rather than relabeling simulation-tick or frame-pacing measurements as that result.

A product-owned appearance/radius tuner is justified only if repeated native iteration needs it. Reuse the existing studio boundary; do not build a second renderer or browser sidecar. Performance and exact-package verification must also run without the tuner.

## Implementation readiness and sequence

1. **Research side:** finish the bounded reference workflow comparison and screen its behavior-only results. Historical defect observations are not a substitute for a clean compatibility/performance baseline.
2. **Implementation:** the main session authors and completes the product and its tests using native facilities and existing tooling. Do not create a placeholder-green scaffold or silently drop an information family.
3. **Verification:** complete the matrix above, calibrate presentation/performance, and freeze the exact tested package. Keep failed or unavailable required evidence visible.
4. **Delivery:** report the package and evidence. Normal-profile replacement/installation, commit/push and Portal publication remain separate user-authorized actions.

Current tooling has no product-creation command; its absence is not a reason to invent one for this mod. Base, Space Age and the pinned `py-hardmode` closure are separate verification profiles. Do not substitute ambient installed mods or the offline-only Polytechnic command for that explicit closure. Real connected native clients, including two-client multiplayer, must use the canonical owned-process/profile/log boundaries rather than a tuner-dependent or product-specific launcher.

After the product exists, use the canonical `verify`, `test-ui`, `gallery`, `package-smoke`, `perf`, `runs` and `logs` commands documented in the developer guide with `no-alt-needed` as the selector. Do not run them against a nonexistent product or treat planned commands as passed evidence.
