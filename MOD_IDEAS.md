# Mod ideas

This is an ideas backlog, not a commitment to implement or publish each entry. A concept moves into the implementation checklist only after its scope and acceptance criteria are agreed.

## Underground detector: high-contrast option

Status: proposed enhancement.

- [ ] Design an optional high-contrast warning appearance for Reversed Underground Belt Detector, retaining the existing appearance as a separate choice.
- [ ] Use the tuner to evaluate visibility against varied terrain, belts and factory clutter; decide colour, opacity, scale and outline treatment later rather than inventing values now.
- [ ] Verify readability in native scenes, independence from map-alert and pulsing/steady/off preferences, per-player behavior and UPS cost before promoting the option.

## Tram

Status: deferred concept.

### Requested concept

- Electric trams for Factorio: trams require electricity to operate.
- Very slow by design.
- Target vanilla/base Factorio, Space Age and Pyanodons separately; this does not require Space Age and pY to work together.
- Additional limitations are deliberately left for later design work.

### Future design checklist

- [ ] Confirm the exact supported engine versions and base/expansion/pY combinations.
- [ ] Work out the electricity supply mechanism and behavior when power is unavailable.
- [ ] Define “very slow” in gameplay terms and decide the other limitations with the user; do not invent balancing values now.
- [ ] Resolve the actual entity/rail/pathing approach and required artwork through focused native-engine experiments.
- [ ] Define behavior, compatibility, persistence, and UPS scenarios appropriate to the chosen design.
- [ ] Choose a canonical mod ID and move an approved implementation slice into [the development checklist](ARCHITECTURE.md#remaining-development-checklist).

Tram is not automatically the next-small-mod tooling acceptance case: its eventual scope may be larger than a genuinely tiny mod. No production work or installation is authorized by this backlog entry.

## Lumberyard

Status: candidate standalone mod; scope undecided.

The existing first-party implementation is embedded in `../yura-py-run/`: its README describes burner and electric lumberyards that harvest nearby trees into pY `log`, with burner water/fuel/ash handling. `prototypes/tweaks/lumberyard.lua` defines the prototypes. This is not an instruction to import the entire personal-tweaks bundle or the upstream Lumberyard mod.

- [ ] Decide whether to make the embedded feature a standalone product.
- [ ] If selected, inspect runtime, assets, migrations, attribution and dependency ownership before choosing the extraction boundary.
- [ ] Agree compatibility, canonical ID, balancing and treatment of existing saves; do not infer Tram's compatibility scope for this different idea.
- [ ] Define native behavior, fuel/water/output edge cases, save/upgrade and UPS proof before scheduling extraction.

## Recipe name tooltip

Implemented as [Recipe Name Tooltip](mods/recipe-name-tooltip/README.md), ID `recipe-name-tooltip`. Its runtime, removal procedure and verification contract live with the product. Keep it independent of the parked throughput advisor.

- [ ] Verify actual two-client simultaneous inspection and differing player locales before claiming multiplayer coverage.

## No ALT Needed

Status: selected for preparation, not yet implemented. Title **No ALT Needed**, planned ID `no-alt-needed`.

The goal is useful information without needing ALT for routine inspection: ordinary detail on the hovered entity, recipe icons on nearby machines, and context-sensitive fluid information. Native ALT remains available. The [source-free implementation brief](.agents/briefs/no-alt-needed.md) owns the agreed scope, defaults, replacement contract and acceptance checklist.

- [ ] Finish the isolated reference comparison, then qualify the source-free handoff to a fresh writer. Source readers must not author replacement code or tests; never copy, port or relicense a donor implementation.
- [ ] Independently replace the contextual-view capabilities of Hover ALT Mode and Cleaner Alt-Mode. Retain optional resource icons, electrical bars, ammunition counts and automatic ALT switching, all off by default.
- [ ] Keep Recipe Name Tooltip, throughput, belt directions, connection-fault diagnostics and other inspection tools independent and compatible.
- [ ] Verify nearby-recipe boundaries, large pY module grids, storage readability, lifecycle, fresh-process persistence, mixed-player settings, actual multiplayer and measured idle/active performance before claiming completion.

Nearby recipes are centred on the hovered entity, not an unsupported continuous pointer position over empty ground. Numerical radius tuning belongs to native readability/performance trials. Preparation does not authorize installation, commits, pushes or publication.

## Machine inserter advisor

Status: parked. Information-only scope and compact-row presentation are agreed; implementation and product identity remain open.

### Requested workflow

- Invoke a shortcut while hovering an existing machine or machine ghost. Open a **highly compact**, pinnable popup inspired by Factory Planner's compact mode, retaining the selected target while the player builds normally.
- Select an inserter-handled input or output resource. Show its configured full-speed requirement alongside the estimated capacity of connections already placed, with a shortfall or shared-capacity indication. Do not size against the machine's currently starved or blocked production.
- Keep gross inputs and outputs separate, including catalysts that appear on both sides. Include item fuel and burnt results where applicable; require a concrete fuel choice when the model only knows a fuel category. Fluids and abstract/non-inserterable flows are not inserter-sizing targets.
- Default to compact rows with an item icon, short name, capacity/requirement and concise status, showing inputs and outputs together. Put assumptions, connection details and what-if controls behind an expansion rather than recreating a large calculator window.
- Update information as relevant inserters are built, removed, rotated or reconfigured. Count only connections actually serving the selected target, not every inserter nearby. Separate installed capacity from user-placed ghost/planned capacity.
- Offer informational **Prefer faster**, **Prefer mechanical**, and **Custom** what-if suggestions for building ahead of time. Prefer faster targets a compact mix. Prefer mechanical minimizes powered/nonpreferred inserters before total count, allowing more mechanical arms within the available space. Custom evaluates an explicit mix without changing the world.
- Read geometry from existing connections. For hypothetical connections, make transfer assumptions explicit; a one-/two-tile gap can be an advanced assumption, with suitable unlocked reach required for recommendations. Do not claim that a proposed count fits or sustains the required rate without the relevant geometry and capacity evidence.
- The user owns all placement and configuration. **No placement preview, automatic building, ghost stamping, automatic filters, belt routing or modification of existing entities.** Ghost support means analyzing ghosts the user has placed, not creating them.
- Hovering a resource row temporarily highlights the existing inserters/connections counted for it, for that player only. This explains shared feeds; it never previews hypothetical placement.

### UX resume notes

- Proposed interaction: a non-modal screen-edge panel with remembered position; one resource's details expand below the list. Keep rows stable while values update and leave normal building/cancel controls and the cursor alone.
- Retarget through the shortcut, not mouse movement. Keep built and planned/ghost calculations visibly separate; show shared/unknown capacity honestly rather than inventing a per-item allocation.
- The wireframe was conceptual, with illustrative rates. No runtime UI or native visual proof exists yet; settle the remaining interaction details when this work resumes.

### Capacity accounting

- Distinguish **required rate**, **estimated installed transfer capacity**, and **actual supplied flow**. Capacity is not measured delivery, and enough nominal capacity does not prove adequate supply or a continuously running machine. Continuous live-flow metering is not required for this advisor.
- Resolve each inserter's pickup/drop connection, lane access, active filters, quality and hand-size limits. Two resource types on opposite belt lanes do not necessarily have dedicated inserters; one arm may serve both.
- Treat a shared inserter as one transfer-time budget across every resource it can handle, for outputs as well as inputs. Never credit its full capacity independently to each eligible item or divide it equally without evidence. Show a shared pool, qualified bounds or an explicitly modelled allocation; feasibility under stated assumptions is not proof of the engine's actual item-selection schedule.
- Multiple distinct inserters serving the same resource can contribute capacity, but shared source lanes and connected belt streams must not be counted repeatedly as independent supplies. Belts at different distances, long-reach arms, sideloading, splitters and overlapping resource sets require connectivity-aware accounting.
- Where item eligibility, source supply or contention is unresolved, keep that uncertainty visible instead of showing a false success or zero. Distinguish known disconnection, unknown allocation, planned connections and insufficient capacity.

### Reuse boundaries

- Use the public [sw-rates library API](https://github.com/SWeini/sw-rates#how-to-use) as the machine-rate boundary, with its pY adapter for supported scripted mechanics. Pass the actual force and surface; distinguish current configurations from planned ghost/module/beacon configurations. Unsupported or ambiguous cases must remain visible rather than acquiring a second calculator or a guessed rate.
- Use [Rate Calculator](https://mods.factorio.com/mod/RateCalculator) as a reference for inserter-unit calculations and interaction, not as a dependency on private GUI modules or an assumed public rate API.
- Use [Factory Planner](https://mods.factorio.com/mod/factoryplanner) compact-mode patterns and existing workshop adaptations where useful, preserving attribution. Its pinned interface does not supply this machine-targeted connection analysis.
- Own the local connection accounting, layout-aware inserter capacity model and informational mix suggestions, not a placement workflow. A nominal inserter cycle rate is not proof of sustained belt pickup/drop capacity.
- Investigate existing sw-rates lane/filter/item-route inference before duplicating it. Qualify the supported integration boundary and bounded execution; possible-item routing is not measured flow or a guarantee of supply.

### Acceptance checklist

- [ ] Choose the independent product identity and pin reviewed dependency/API versions and applicable licenses before integration.
- [ ] Verify machine and ghost selection, missing recipes/fuel, requested modules, upgrades and beacon effects. Preserve the distinction between current and planned configurations, and retain the pinned target while the cursor moves to building work.
- [ ] Verify recommendation availability versus already installed inserters, transfer geometry, all cardinal orientations, machine footprints, filters, quality, hand-size research and actual pickup/drop targets.
- [ ] Verify faster/mechanical suggestions and custom hypothetical mixes against explicit assumptions and space limits. Distinguish a theoretical count from a layout-qualified recommendation; never present a capacity shortfall as sufficient.
- [ ] Exercise real belt-to-machine and machine-to-belt arrangements: dedicated item feeds, two different lane items, mixed items on one lane, shared input/output arms, multiple belts with overlapping resource sets, long-reach pickups, sideloading, splitters and competing consumers. Assert that arms and shared belt supply are not double-counted.
- [ ] Include recipe batches, catalysts, probabilistic products, fuel/ash and buffers. Distinguish expected average capacity from a no-stalls guarantee; ambiguous routing/supply must remain visibly qualified.
- [ ] Verify updates after player/robot construction, removal, rotation, filter/recipe/module changes, research changes, target invalidation and ghost revival. Closing the advisor must release its tracking; information updates must not mutate factory configuration, inventory or the player's build cursor.
- [ ] Verify highly compact native popup readability/input, per-player isolation, save/load and explicit base/Space Age/pY combinations. The pY adapter's presence alone does not establish Hardmode compatibility.
- [ ] Measure invocation-to-readout and update latency plus idle/active UPS cost. Bound tracking to the selected target and relevant surroundings; do not introduce continuous whole-factory monitoring.

## Belt contamination detection

Status: proposed separate candidate; detection rules and implementation scope are not yet agreed.

The player problem is stray, unintended items travelling along belts and causing trouble downstream, not environmental pollution.

- [ ] Evaluate per-belt/per-lane expected item declarations and clearly separate confirmed mismatches from inferred suspicions. Rare items are not automatically contamination; mixed belts and low-volume pY ingredients can be intentional.
- [ ] Highlight unexpected items and trace their downstream route through undergrounds, splitters and relevant pickup points. Respect routing/filter choices rather than treating every connected machine as a destination.
- [ ] Distinguish contamination present from demonstrated blockage. Missing consumption at one machine is not proof that no downstream destination legitimately accepts the item.
- [ ] Evaluate bounded monitoring and incident-based alerts without repeated warnings for each item.
- [ ] Keep this detection-only: no automatic deletion, spilling or rerouting. Confirm the scope and proof scenarios before scheduling implementation.

## Stock badges in the native crafting list

Status: parked. Preserve the native crafting-list design; do not substitute a separate inventory browser.

- For recipes that produce placeable entities, add a small inventory-stock dot and an outer logistics-stock ring to the recipe button.
- Use non-overlapping stock bands: 0, 1, 2–4, 5–99 and 100+. Distinguish no connected logistics network from a connected network with no available stock.
- Decide quality matching, cursor-held items and genuinely available logistics supply before implementation. Do not confuse existing stock with the native craftable count.
- Factorio 2.1.21 does not expose individual native crafting buttons through the [Lua GUI API](https://lua-api.factorio.com/2.1.21/classes/LuaGui.html). Revisit when a supported per-button extension exists; the [native-GUI extension request](https://forums.factorio.com/viewtopic.php?t=134025) remains relevant. Avoid absolute-position or negative-padding overlays that break when the native window moves or changes layout.

## Other candidates

Unscheduled concepts for evaluation:

- [ ] **Commissioning:** evaluate a factual, navigable construction-completeness checklist: ghosts, module requests, missing recipes or electrical connections, with explicit intentional exceptions. No automatic repair or claim to diagnose production efficiency.
- [ ] **Operations / Fulfillment:** evaluate extracting the industrial-order system from the personal pY bundle into a standalone core with a separate pY integration; not the unrelated reach, turret, lumberyard or bot tweaks.
- [ ] **Byproduct Exchange:** evaluate surveying actual byproduct producers, researched consumers and nearby configured machines. Prefer an LLL feature experiment before deciding it needs its own mod; distinguish configured recipes from measured throughput or spare capacity.

These checkboxes mean “evaluate the idea,” not “implement it.” No priority or release commitment has been assigned.
