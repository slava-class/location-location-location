# Subsumption investigation checklist

Use the sections required by the current phase under the skill's independent-implementation policy. Record evidence and decisions, not a completed checklist without supporting results.

## Discovery and candidate selection

- [ ] Translate the requested feature into player problems, alternate terminology and likely technical mechanisms. Search those terms across the Portal, Reddit, forums, source hosts and the broader web.
- [ ] Follow renamed mods, continuation forks, related-mod links, historical Portal versions and forum attachments. Check whether native Factorio has since absorbed the feature.
- [ ] Read issue discussions through their latest disposition. Separate a reporter's hypothesis, a reproduced defect, a developer explanation and a version-specific fix or reversion.
- [ ] Shortlist materially different approaches, not several cosmetic forks of the same implementation. Explain rejected candidates and any search/access gaps without arbitrary quotas.
- [ ] Identify useful behavior, general design patterns, UX lessons, compatibility requirements and failure scenarios. Compare their pros and cons as research findings, not donor code, assets or tests to import.

For every serious candidate, retain the following in the researcher-only evidence ledger, not the writer's input packet:

| Field         | Required evidence                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Mod ID/title, Portal and source links, exact release and source revision; note missing source or package/source mismatch      |
| Artifact      | Download origin, archive hash, engine version, dependency/settings closure and independent asset/code license findings        |
| Investigation | Actually run, source-inspected only, or blocked; scenario and run/log references for observed behavior                        |
| Mechanism     | Relevant source paths/symbols and an explanation of the event-to-result path                                                  |
| Assessment    | Useful capabilities, limitations, known issue status, comparative cost evidence and independent implementation recommendation |

Do not equate unavailable source, inaccessible Reddit content or a missing old engine with proof that no alternative exists.

## Candidate runs and source dissection

- [ ] Inspect package paths, contents, licenses and executable helpers before extraction/execution. Do not run arbitrary install hooks to obtain a Lua mod.
- [ ] Use disposable writable profiles and independently authored fixtures or copies of our own saves. Donor archives are reference inputs for observation, never our implementation. Fetch dependencies through declared, pinned inputs rather than a normal installation or sibling checkout. Keep credentials and personal saves out of retained/shareable evidence.
- [ ] Record the actual loaded mod closure, engine and settings. Compare original releases where feasible; identify observation instrumentation or harnesses separately. An incompatible donor is a runtime blocker, not an invitation to port it.
- [ ] Exercise first use, normal use, disabling/re-enabling settings, repeated actions, cancellation where present, and removal of objects the feature tracks. Inspect errors and shutdown as well as success output.
- [ ] Trace event registrations and filters, whole-world scans, per-tick/per-player loops, queue ordering, cache invalidation and entity lifetime handling. Look for duplicate ownership when multiple mods operate on the same entities.
- [ ] Follow save state through initialization, configuration changes and load. Check registration restoration, invalid references, surface/force changes and cleanup of GUI, rendering and alerts.
- [ ] Inspect data-stage ordering, prototype mutations, public remote interfaces and assumptions about other mods. Identify the requirements behind compatibility branches rather than transplanting those branches.
- [ ] Compare actual UI interaction and settings semantics, not only appearance. Headless tests do not establish hit-testing, visible alert delivery or rendered performance.

## Specification and implementation decisions

- [ ] Map each requested behavior to its research evidence, intended disposition, independent design and proof scenario. No feature disappears merely because implementing it is difficult.
- [ ] Write a specification of observable inputs, outputs, interactions, settings, lifecycle, compatibility and performance requirements, plus high-level approach tradeoffs. Keep detailed source analysis in the researcher-only ledger; the writer receives only the reviewed brief defined below.
- [ ] Have a separate source-unexposed agent implement from that brief, public Factorio APIs and allowed workshop patterns. Never fork, port, vendor, adapt or copy-and-relicense donor implementations, including permissively licensed ones. Do not copy donor tests, fixtures, assets, locale text or documentation; author equivalents independently.
- [ ] Apply the mandatory source-free implementation handoff before product authoring. Record source exposure and role identities; separation is required, not an optional label attached after a rewrite.
- [ ] Select a new independent product or an existing owner. Set identity/version policy deliberately; check Portal identity when relevant without creating or modifying a listing.
- [ ] Preserve notices on isolated reference copies and credit research influences without implying imported code. Review applicable restrictions rather than assuming a rewrite extinguishes them; unresolved constraints do not authorize copying, relicensing or bypassing access conditions.
- [ ] Keep deliberately selected third-party libraries as explicit dependencies used through public APIs, with their own licenses and notices. This is distinct from subsuming their implementation. Do not import a donor's development environment, CI scripts or package registry.
- [ ] Keep reusable mechanisms in the existing typed toolkit only where there is a demonstrated shared need. Product discovery remains owned by `info.json`; development sharing need not create a player-installed library.

### Source-free implementation handoff

- [ ] Assign source research and product writing to different agent contexts. A coordinator that has inspected donor implementations stays on the research, handoff-review and authorized verification side; it must not make even small product-code or product-test fixes itself. An unexposed main session can be the writer if source scouts return only reviewed source-free findings.
- [ ] Keep the raw research ledger separate from the implementation brief. The ledger owns donor URLs, source paths, symbols, excerpts, detailed control flow, raw logs and source-bearing transcripts. Do not forward it, its tool output or a source-bearing conversation summary to the writer.
- [ ] Include in the brief the player problem, agreed scope and non-goals, observable behavior and lifecycle, compatibility promises, independently described acceptance scenarios, performance workloads and measured limits, general approach pros/cons, public Factorio API contracts and approved dependency interfaces. Label observed, source-derived and unverified claims. Retain provenance identifiers without exposing the underlying source-bearing records.
- [ ] Review every writer-facing input for leakage. Exclude donor code, translations or near-code pseudocode, copied tests/fixtures/assets, internal function names, donor-specific module/control-flow designs and implementation-specific constants. Public mod/prototype/interface IDs needed for observable compatibility are allowed; justify them as contract requirements, not copied internals. The writer chooses its own design rather than receiving a disguised port.
- [ ] Start a fresh writing context without inherited donor-source conversations, transcripts, summaries or earlier source-informed implementation drafts. Supply only the reviewed brief and an explicit allowlist of workshop/product inputs. Check those inputs for donor-derived implementations of this capability; a file's presence in our repository does not make it a clean input. Exclude donor archives, extracted files and raw research from the supplied workspace.
- [ ] Record the researcher and writer session/agent IDs, actual source exposure, allowed input identities and the exact reviewed brief revision/hash. The writer acknowledges the boundary before authoring and must not search for donor repositories or open donor packages. Do not claim filesystem access was prevented unless an enforced boundary actually did so; fresh context and restricted instructions alone are procedural separation.
- [ ] Route writer questions back as behavior or public-API questions. The research side may investigate further, but replies and revised briefs pass the same leakage review. Keep review feedback and verification failures behavioral; do not send donor patches, implementation sketches or test bodies as a shortcut. Any reference-engine output sent to the writer must be screened for source excerpts.
- [ ] If a writer encounters donor implementation material, stop authoring in that context, record the exposure and retain affected work separately without deleting it. Review the brief again and use a new unexposed writer starting from the last qualified unexposed input. Do not pass source-exposed output forward as an implementation template, or pretend compaction/forgetting removes exposure.
- [ ] Keep this role separation scoped to an already authorized subsumption implementation. It is the user's requested exception for a fresh writing agent, not permission for unrelated implementation delegation, different model routing, engine launches, installation or publication. Obey harness delegation rules; if a writing subagent is not permitted, prepare the reviewed brief for a fresh main session. Do not relax separation to avoid the handoff.

### Replacement contract

Specify these separately rather than claiming generic backward compatibility:

- Fresh installation and installation into an existing factory.
- Both original and replacement enabled: supported coexistence or an explicit incompatibility.
- Original removed/replacement added: effects on entities, inventories, recipes, research, blueprint prototype names, shortcuts, settings and saved state.
- Upgrades from the supported shipped versions, including skipped versions and migration-once behavior.
- Ownership of old alerts/render objects and preservation of unrelated mods' state.
- Removal or downgrade behavior: only promise what has been deliberately supported and tested.

Use real old artifacts and disposable saves for promised migrations. A new mod ID cannot directly adopt another mod's private storage; any bridge requires an explicit design and authorization under the repository's compatibility policy.

## Verification and product finish

- [ ] The source-unexposed writer authors independent fixtures and assertions for the selected behavior. Include boundaries, transitions and meaningful negatives; upstream failures reach it only as reviewed scenario descriptions, not copied test bodies or assertions against donor implementation details.
- [ ] Run the canonical selected-product verification and affected shared-tooling consumers. Inspect native process results and live/sealed logs, not just framework pass markers. Report unavailable required coverage explicitly.
- [ ] Exercise fresh-process save/load and supported migration paths. A same-process reload is different evidence. Use real connected clients for multiplayer claims.
- [ ] Compare equivalent performance scenarios with source/package identities, sample counts and spread. Include idle work, typical/dense workloads, construction bursts and recovery, audience/settings changes, and overlapping periodic work across relevant mods. Distinguish total update time, script cost, rendering cost and user-visible latency.
- [ ] Keep measurement overhead explicit; do not turn a faster phase into a claim of a faster whole operation. Separate inherited failures, regressions, benefits and inconclusive results.
- [ ] Run an independent exact-package smoke without test frameworks, undeclared dependencies, source substitutes or tuners. Exercise the feature and cleanup, not just startup.
- [ ] Review locales, settings labels, README and Portal copy as a player. Include supported behavior and limitations, not internal plans or speculative explanations.
- [ ] Capture presentation assets in the actual standalone Extreme client. Verify viewport, locale, scale and final image/GIF output. If a tuner is justified, reuse the existing studio boundary and recheck the product after promotion with the tuner absent.

## Delivery

Provide a concise candidate comparison and behavioral disposition, then summarize the investigated source revisions, researcher/writer identities and source-exposure records, reviewed brief revision/hash and allowed inputs, independent implementation provenance, dependency/license boundaries, replacement contract, actual checks/measurements, exact package identity, remaining blockers and authorized delivery state. Keep source-bearing evidence separate from writer-facing artifacts and link it only in the research-side handoff to the user, not in the writer's brief. Do not turn detailed run artifacts into a durable Markdown execution diary.

For future upstream changes, retain enough research provenance to identify relevant behavioral fixes and independently evaluate their lessons. Never merge or transplant upstream patches, silently expand scope, or create a new maintenance service as part of subsumption.
