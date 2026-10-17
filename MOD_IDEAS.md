# Mod ideas

This is an ideas backlog, not a commitment to implement or publish each entry. A concept moves into the implementation checklist only after its scope and acceptance criteria are agreed.

## Underground detector: high-contrast option

Status: user-requested future enhancement; not implemented in the current prototype.

- [ ] Design an optional high-contrast warning appearance for Reversed Underground Belt Detector, retaining the existing appearance as a separate choice.
- [ ] Use the tuner to evaluate visibility against varied terrain, belts and factory clutter; decide colour, opacity, scale and outline treatment later rather than inventing values now.
- [ ] Verify readability in native scenes, independence from map-alert and pulsing/steady/off preferences, per-player behavior and UPS cost before promoting the option.

## Tram

Status: idea recorded; design and implementation deferred.

### Requested concept

- Electric trams for Factorio: trams require electricity to operate.
- Very slow by design.
- Compatible with vanilla/base Factorio, Space Age, and Pyanodons, as confirmed during plan triage. These are separate supported configurations, not a promise that Space Age and pY work together.
- Additional limitations are deliberately left for later design work.

### Future design checklist

- [ ] Confirm the exact supported engine versions and base/expansion/pY combinations.
- [ ] Work out the electricity supply mechanism and behavior when power is unavailable.
- [ ] Define “very slow” in gameplay terms and decide the other limitations with the user; do not invent balancing values now.
- [ ] Resolve the actual entity/rail/pathing approach and required artwork through focused native-engine experiments.
- [ ] Define behavior, compatibility, persistence, and UPS scenarios appropriate to the chosen design.
- [ ] Choose a canonical mod ID and move an approved implementation slice into [the migration and development checklist](MONOREPO_MIGRATION_PLAN.md).

Tram is not automatically the next-small-mod tooling acceptance case: its eventual scope may be larger than a genuinely tiny mod. No production work or installation is authorized by this backlog entry.

## Lumberyard

Status: candidate idea only, explicitly deferred during triage; not an agreed repository import or extraction.

The existing first-party implementation is embedded in `../yura-py-run/`: its README describes burner and electric lumberyards that harvest nearby trees into pY `log`, with burner water/fuel/ash handling. `prototypes/tweaks/lumberyard.lua` defines the prototypes. This is not an instruction to import the entire personal-tweaks bundle or the upstream Lumberyard mod.

- [ ] Decide whether to make the embedded feature a standalone product.
- [ ] If selected, inspect runtime, assets, migrations, attribution and dependency ownership before choosing the extraction boundary.
- [ ] Agree compatibility, canonical ID, balancing and treatment of existing saves; do not infer Tram's compatibility scope for this different idea.
- [ ] Define native behavior, fuel/water/output edge cases, save/upgrade and UPS proof before scheduling extraction.

## Earlier suggestions retained for consideration

These were assistant suggestions at the start of this chat, not user-approved projects. Recording them prevents the brainstorm from disappearing without committing the fleet to build them.

- [ ] **Commissioning:** evaluate a factual, navigable construction-completeness checklist: ghosts, module requests, missing recipes or electrical connections, with explicit intentional exceptions. No automatic repair or claim to diagnose production efficiency.
- [ ] **Operations / Fulfillment:** evaluate extracting the industrial-order system from the personal pY bundle into a standalone core with a separate pY integration; not the unrelated reach, turret, lumberyard or bot tweaks.
- [ ] **Byproduct Exchange:** evaluate surveying actual byproduct producers, researched consumers and nearby configured machines. Prefer an LLL feature experiment before deciding it needs its own mod; distinguish configured recipes from measured throughput or spare capacity.

These checkboxes mean “evaluate the idea,” not “implement it.” No priority or release commitment has been assigned.
