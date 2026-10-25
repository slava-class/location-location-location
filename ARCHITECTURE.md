# Workshop architecture

This document owns durable design decisions, verification requirements and unfinished development work. [The developer guide](tools/README.md) owns current commands and recovery procedures; product READMEs own player-facing behavior; product guidance owns implementation constraints; [mod ideas](MOD_IDEAS.md) are not scheduled work. Run IDs, completed migration diaries and benchmark results do not belong in these documents. Inspect current qualified run/release records when evidence is needed.

## One workspace, independent products

The goal is simple maintenance and inexpensive onboarding at roughly 100 small mods, not a framework or a speed claim. Keep the development toolkit as ordinary internal source in this repository. It has no separate repository, release train or player-installed dependency. Each product owns its identity, version, dependencies, changelog, assets, license and Portal release.

- `mods/<mod-id>/info.json` is the identity/dependency authority. [The project resolver](tools/projects.ts) discovers products; there is no manual registry or default product.
- Product roots are complete Factorio mods. Runtime, locale, storage types, migrations, tests, content generators, scenes and `dev/tuners/` remain product-owned. Shared mechanisms belong in `tools/`, relocatable tool configurations in `.config/`, and the package manifest and Bun lockfile at root. Keep native discovery/path anchors where relocation would change behavior.
- Optional `dev.config.ts` describes only requirements that cannot safely be derived. Optional configuration never means optional validation. Missing tests or scenes must not silently remove required verification.
- A conventional small mod should not need its own JavaScript package, installer, copied task scripts or arbitrary GUI/gallery fixtures. Shared tooling must not branch on product IDs when a typed capability or product-owned extension supplies the distinction.
- Dependencies and compiled/API caches are immutable, checksum-qualified inputs. Writable profiles, saves, logs, captures, packages and release preparations are isolated by worktree, product and run under ignored `.factorio-test/`.
- No sibling checkout, normal profile, source symlink or ambient cached mod may satisfy an undeclared input. Exact package contents are explicit; preserve migrations and attribution while excluding tooling, private data and development companions.
- Development sharing does not justify a runtime library. Consider build-time inclusion only for demonstrated repetition, with deterministic bytes, attribution and affected-consumer tracking; a player-installed library needs an actual shared runtime service/state requirement.

The [licensing policy](README.md#licensing-and-attribution) keeps MIT for first-party work, preserves upstream notices for derived portions and leaves third-party terms intact. Every independently packaged product carries its own license; neither monorepo ownership nor directory relocation transfers upstream copyright.

## Canonical typed boundaries

[Effect CLI](tools/cli.ts) owns commands, options, parsing and help. Mise forwards arguments. Bun + Effect owns orchestration and scoped filesystem/process/network resources. Effect Schema owns runtime contracts and derived types; no second validator, handwritten command parser or cross-language wire layer is needed.

Validate actual boundaries: arguments/environment, discovered metadata and imported configuration exports, filesystem/archive inputs, network responses, external-tool output, persisted artifacts and readbacks. Owned formats reject unknown fields; external APIs may contain unrelated fields but must satisfy every consumed identity and invariant. An executable development configuration is trusted repository code, not a sandbox merely because its export is decoded.

Decode once at the boundary and pass typed values internally. A cast or `satisfies` is not validation. Schema validity does not replace path containment, source freshness, ownership, checksums, exact target identity or successful operation completion. Errors retain phase, target and actionable context without credentials.

Help, invalid arguments and read-only plans do not install tools, allocate engine work or mutate profiles. Provisioning is explicit; ordinary verification resolves existing inputs. No implicit repair, silent fallback, automatic mutation retry or backend substitution. Cancellation releases owned resources but cannot imply rollback of an uncertain external operation.

## Mechanisms we reuse, policy we own

Exact installed versions live in the root manifests, lockfile and tool configuration, not another hand-maintained inventory. Recheck exact-version licenses, platform support and behavior when changing a dependency.

| Capability                  | Boundary and reason                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source quality              | Trunk orchestrates Oxfmt, Oxlint with native TypeScript/Effect diagnostics, Knip and applicable text/secret/shell/workflow/container checks. Lua keeps StyLua, Luacheck and EmmyLua with versioned FMTK types. `format` mutates layout; checks do not. Native `bun check` does not replace Effect diagnostics.                                                                                                                                                 |
| ZIP and tar                 | Reuse MIT-licensed [yauzl](https://github.com/thejoshwolfe/yauzl), [yazl](https://github.com/thejoshwolfe/yazl) and [tar-stream](https://github.com/mafintosh/tar-stream); Bun supplies compression, CRC, hashing and binary primitives. We own entry/resource limits, raw-name/type rejection, CRC checks, cancellation and atomic output. Yauzl does not check CRC itself; a map that collapses duplicate tar entries cannot establish our rejection policy. |
| Lua tools and offline saves | Bun owns provisioning and type overlays; native compilers/checkers remain subprocesses. Polytechnic owns only its explicitly supported save-layout subset, not a general Factorio save emulator. No Python environment is required; the private Pyanodons Lua helper and its separate license remain necessary.                                                                                                                                                |
| Engine tests                | Retain [FactorioTest](https://github.com/GlassBricks/FactorioTest) and the reviewed Bun/FMTK patch. One primary mod per run; companions do not select additional suites. Framework results are inputs to our qualifier, not complete process/source proof. FMTK's all-in-one publisher is not our release transaction.                                                                                                                                         |
| Deterministic fixtures      | Use native entity creation and saved scenarios. Factorio resolves prototypes, placement and underground pairing. Draftsman's full prototype/data-stage emulation is unnecessary. A future interchange consumer may justify a small Bun codec and Effect Schema subset, not a second engine model.                                                                                                                                                              |
| Private RCON                | [The bounded Factorio transport](tools/rcon.ts) owns framing, authentication, request correlation, deadlines and terminal disconnect behavior in an Effect scope. Generic Source clients' termination-packet assumptions are not interchangeable with Factorio. Native scenarios or owned stdin are deliberate alternatives, not failure fallbacks.                                                                                                            |
| Images and studios          | Factorio supplies rendering and native controls; Bun.Image supplies terminal PNG decode/re-encode alongside explicit framing/CRC/completion checks. Studios share descriptors, presets, lifecycle and source-aware promotion, not a browser sidecar or another production renderer.                                                                                                                                                                            |

Prefer native facilities and existing dependencies before adopting another package. Nx/Turbo, Changesets, Clusterio, Testcontainers and a telemetry service are not needed by default. A real missing capability may justify a bounded integration, not symmetry with another repository. Dependency bots, online advisory scans and remote services have separate authorization/data-disclosure boundaries; local secret scanning does not validate credentials remotely.

### Blueprint interchange, only when required

For a blueprint-consuming feature, define deterministic entity IDs/order, positions, names, directions and underground input/output roles, rejecting unsupported fields. Use native `set_blueprint_entities`/`build_blueprint` or JSON `import_stack`; encoded interchange needs only the documented prefix, base64 and bounded zlib with a schema for the consumed subset. Set the intended packed engine version explicitly without JavaScript 32-bit bitwise truncation.

Host decoding does not establish native validity. Assert both `underground_belt_neighbour` relationships, directions and endpoint roles after actual construction in all cardinal directions. Modded reach, competing endpoints, obstructions, quality, circuits, recipes, ghosts and event delivery each need their own support tests. See the [official interchange format](https://wiki.factorio.com/Blueprint_string_format) and version-matched [native APIs](https://lua-api.factorio.com/2.1.20/classes/LuaItemCommon.html); do not treat an outdated wiki entity-field table as a complete current schema.

### Private control and save completion

RCON is plaintext administrative access, confined to owned loopback sessions with ephemeral redacted credentials. Read-only log consumers need no mutation access. A graphical studio uses a private headless server plus a separate standalone client and separate writable profiles; do not use a graphical host whose binding cannot satisfy that boundary. Network-isolated Docker and host-side RCON are not interchangeable modes.

Commands are serialized and bounded. Validate fragmented/coalesced frames, IDs, types, terminators and UTF-8. Timeout/cancellation/disconnect terminates the connection; a dispatched mutation without a valid response has an unknown outcome and must not be replayed automatically. Structured operation results need their own schema and correlation, not just a transport acknowledgement.

Saving is a workflow: use a unique owned destination, correlate that save's start and completion, validate the archive and hash its bytes. Persistence proof then loads it in a fresh process and checks meaningful state. File existence, RCON success, an unrelated save-completion line or `game.reload_mods()` is not that proof.

## Verification requirements

Capability declarations choose the required evidence; generic checks remain common and assertions stay with the product. Explicit offline-only products retain their limits: **Polytechnic development tasks must not launch Factorio**, even to fill a missing native-evidence cell. Filtered authoring checks do not satisfy a fuller release gate.

| Changed surface   | Required proof and limitation                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolkit/contracts | Real CLI/path exercise, strict schema/identity failures, source-selection and ownership controls. Tests must detect plausible consumer-visible failures, not copies of implementation text.                                              |
| Prototype/data    | Engine load and focused semantic projections of resolved prototypes under the actual mod/settings closure; no inferred correctness from source names or a huge unchecked dump. Offline-only products disclose that this proof is absent. |
| Runtime/lifecycle | Real tick/event scenarios and observable outcomes. Direct handler calls, raised events and actual player/robot input are different evidence. Preserve deterministic seeds and minimized traces for generated failures.                   |
| Persistent state  | Old shipped artifacts, actual save completion, new-process reload, upgrade/migration-once behavior and preservation of foreign state. Do not claim unsupported downgrade compatibility.                                                  |
| GUI/rendering     | Native structure/state/geometry plus fresh decoded captures; actual input when hit-testing/key delivery is claimed. Headless success and nonblank screenshots are insufficient.                                                          |
| Generated content | Canonical generation/freshness, deterministic output, relevant editorial/provenance checks; mechanical completeness is not scientific approval.                                                                                          |
| Package/release   | Exact ZIP, independent dependency closure, declared members/assets/licenses/migrations and behavior without FactorioTest or source substitutes. Load-only smoke does not prove warning detection and cleanup.                            |
| Compatibility     | Explicit risk-selected engine minimum/current versions, base/Space Age or pY combinations, settings, locales/scales and platforms. Missing required cells are visible, not silently skipped.                                             |

LLL alone, detector alone without flib, and coexistence are distinct contracts. Run each primary in coexistence; the optional versioned dependency rejects pre-cutover LLL. The LLL retirement migration must remain shipped for skipped-version upgrades and remove only historical detector-owned state/alerts/rendering, preserving planner and foreign objects. Do not use whole-mod storage transfer or global rendering cleanup. New detector preferences remain independent.

### Execution and diagnostic integrity

Use the same owned supervisor for native headless, explicit Linux ARM64 Docker, native standalone rendering, studios and performance. No Steam confirmation automation. Docker supplies an unattended headless environment, not a Mac GPU or native renderer. Pin engine/runtime/image/platform inputs, verify the actual executable pairing, and separate legitimate full-client provisioning from ordinary runs.

Runs resolve inputs, allocate isolated state, publish registered identity, launch with argv, observe, qualify and clean up. Retain stdout/stderr, rotated engine logs, structured events, bounded multiline failures, exit/signal and actual container OOM facts. Collect only run-owned crash/desync artifacts; a crash marker is not forensic proof, and collection does not authorize upload. Disable automatic engine crash-log uploading in owned profiles.

Deadlines distinguish startup, execution, capture flush and shutdown, with an overall bound. Quiet work is not necessarily hung; noisy output is not progress. Reap only owned processes/containers and collect exit/OOM/log state before removing them. Never signal an unrelated Factorio instance or mount the normal profile into a test.

Live logs must be readable before completion, persist independently of subscribers and support bounded cursor reconnects. Reader cancellation never cancels the producer. Preserve stream identities, partial UTF-8, rotation/replacement generations and final drain; report gaps/recording errors rather than pretending a complete stream exists. Ingestion order is not total causal order across pipes. Public readback remains redacted.

Completion requires exact expected cases, observed dependency identities, compatible process outcome, source/artifact checks and sealed logs. Reject unexpected skips, empty/duplicate/foreign/stale/truncated results, passed-marker-then-failure and incomplete captures. Test the verifier with disposable malformed inputs, missing executables, data/runtime/assertion failures, hangs, floods, cancellation, finalization failure and OOM controls. Targeted mutation controls alter disposable fixtures, never the user's working tree. No unsafe crash injection is required on the user's desktop.

### Native assets and tuners

Routine graphical tests use **Low** in isolated standalone instances; preserve assertions, viewport and scale. Use **Extreme** when fixing graphical issues and for every final thumbnail, gallery image, GIF/video frame or other presentation asset. Record the verified preset alongside observed viewport, scale, locale, zoom and scene identity. Wait for screenshot-flush completion and fully decode the declared output. A clamped display fails; do not resize/upscale evidence, alter normal settings or weaken capture contracts. A test screenshot is diagnostic, not a publishable asset: final asset generation and release preparation require fresh Extreme captures, even when reusing a test scene.

Native startup qualifies actual window/drawable dimensions and the forced graphics preset from owned live logs as soon as they are available. Reject known mismatches before waiting for scene completion; retain final synchronized player and decoded-image checks. Missing standalone-client selection fails before native suite/studio source sealing and packaging. Neither early startup evidence nor a successful process exit replaces complete native verification.

Use stable scenes and meaningful regions for future image comparisons; masks exclude only known nondeterminism, never the changed feature. Review baseline changes rather than auto-accepting diffs. Native-language review, wrapping and actual input can still require focused human checks. An encoder must validate ordering, dimensions, frame cadence/duration and full decode; captured PNGs alone are not GIF/video acceptance.

Studios are optional product-owned development capabilities. Descriptors own supported keys, ranges, units, dependencies and live/rebuild/restart classification; canonical product source owns defaults. Generate the supported Lua metadata/guards instead of duplicating range tables. A proxy preview is not production behavior or production-performance proof.

Preserve distinct close-panel, reset, undo, stop-preview and discard semantics; restore only touched objects. Revisioned changes reject stale writers. Exports bind target, source hash, values and scene; promotion rejects preview-only fields and changes only supported source literals under a seal. Restart at the required lifecycle stage and verify the actual product without the tuner afterward. Useful later studios include planner/picker layout, source navigation, runtime budgets, data-stage balance, performance workloads and Extreme capture composition.

### Performance across the stack

Maintainability is the architectural goal; performance work still needs measured evidence. Record total simulation **ms/update**, relevant script cost, burst peaks and action-to-result latency, not just displayed UPS. At 60 UPS the entire world has about 16.667 ms/update; this is not a per-mod allowance. Simulation, rendering frame time, CPU, memory and CLI wall time are distinct metrics.

Cover idle/active scales, bursts and recovery, mixed audience/selection, installation surveys, persistence, planner lookup/GUI, repeated lifecycle cleanup and combined-mod periodic alignment. Include Bun/Effect/schema/packaging/checker phases, Docker contention, tuner application/idle cost and live-log collection/readers. Product-alone, observer-idle and active-observer workloads remain distinct. Headless visible-object flags do not measure rendered cost; saved players are not connected clients.

For a change, define the completed user-visible operation and representative fixture first. Seal baseline/candidate sources, packages, dependencies, settings, hardware/backend and instrumentation. Repeat independent comparable runs, alternate order where practical, distinguish warm-up/cold/warm conditions, and report sample counts, central values and spread. Measure coarse phases as well as end to end; do not sum nested/concurrent durations. Correlated ticks are not independent repetitions, and a few maxima do not establish a tail bound.

Calibrate cost, latency and resource budgets from representative baselines and intended use, not universal invented thresholds. Missing/noisy evidence is inconclusive or blocked, not green. Distinguish inherited failures from new regressions and benefits; do not loosen a budget, reduce warnings, hide visuals, extend latency or move work outside the interval to manufacture a gain. Model counterfactuals are not observed reruns. Deterministic work budgets, not wall clocks, govern gameplay scheduling.

Keep cheap shared run/phase diagnostics enabled; detailed tick/DAP/CPU/heap/counter probes remain bounded and opt-in, with collection gated when disabled. Measure observer overhead and equivalent enabled/disabled behavior. Remove temporary probes, then smoke the final path. Profiles attribute work, not necessarily exclusive CPU; exit heap/RSS is not a leak test or process-tree peak. Test measurement rejection with deliberately costly/delayed disposable controls and mismatched inputs.

Tune test settings through repeated end-to-end experiments per representative workload/backend until the fastest reliable tested configuration is established. Preserve assertion scope and Extreme assets. Add affected-result reuse, batching and concurrency only when measured fleet costs justify them: invalidate on source membership/content, shared/companion/toolchain/engine/dependency/profile changes; label reused or combined evidence honestly; retain standalone exact-package proof and a deliberate full-fleet command.

## Delivery boundaries

Release preparation seals the selected product, required companions, shared tools/configuration, exact package, captures and qualified proof. Changes outside that input closure need not invalidate it; selected/shared/companion changes must. Never rebuild after proof. Fresh-checkout reproduction must not depend on another repository or an implicit install.

`checkpoint` verifies and commits the whole worktree locally; `vac` additionally pushes the exact verified commit. Both require explicit authority, preserve concurrent staging and reject source/HEAD/index drift. Per-mod verification is not permission for a whole-worktree commit.

Normal-profile installation, source pushes, Portal release/gallery/listing mutations, initial listing creation, repository rename/archive and account changes are separate authorized actions. A stopped mutation may have an unknown outcome: inspect exact-target journals/public readback, never blindly replay. The current publisher does not create a missing listing. `factorio-mods` remains only a possible future repository name, not a requested rename.

## Remaining development checklist

Unchecked means unfinished, not implicitly authorized or mandatory for every tiny mod. Conditional items begin only when their stated need exists. Remove completed execution history; retain the resulting durable contract in its owning document. Current source-qualified proof comes from the toolkit, not a checked box.

### Next products and fleet scale

- [ ] **E1 — Cheap onboarding:** add the creation command with a genuinely small implemented mod and relevant behavior tests. No mandatory per-mod package/config, central registry, copied tools or placeholder-green scaffold. Refuse existing targets; never invent gameplay or publish a listing. Tram is not automatically this case.
- [ ] **E2 — Useful studios:** add a studio only for a concrete consumer, retaining lifecycle-stage and proxy/product distinctions.
- [ ] **E3 / V-T10 — Test-setting calibration:** compare repeated cold/warm end-to-end runs per workload/backend, retain coverage and Extreme assets, and report uncertainty rather than a speculative speed ranking.
- [ ] **E4 — Affected selection/reuse, when justified:** prove dependency/input invalidation for changed, added and deleted inputs; identify reused evidence and preserve full-workspace checkpoint scope.
- [ ] **E5 — Bounded concurrency/batching, when justified:** measure startup amortization and contention; preserve single-primary accounting, isolated state, a separate graphics queue and standalone dependency/package proof.
- [ ] **E6 — Fleet performance:** measure named combined workloads, periodic alignment and contention; extend calibrated budgets and soaks rather than multiplying a single-mod mean by 100.
- [ ] **E7 — Runtime sharing, only with demonstrated repetition:** assess deterministic inclusion versus a real library dependency without introducing hidden coupling.

### Verification capabilities and tool decisions

- [ ] **V-T4 — Blueprint interchange, when a feature consumes it:** implement only the needed bounded schema/codec and prove imports, directions and reciprocal pairing in the engine; direct native fixtures need no codec.
- [ ] **V-T8 — Generated/mutation cases:** use replayable seeds and independent invariants for relevant product transitions. Prefer existing Effect/native facilities; add fast-check or mutation machinery only for an uncovered need, not a second generator for the same contract.
- [ ] **V-T9 — Debug/profiler integration:** exercise version-matched FMTK/native DAP ownership, framing and actual trace import before claiming unattended debugging or Perfetto/Speedscope support. FactorioTest and DAP cannot both own stdout without designed integration; Instrument Mode is not multiplayer-safe. Add Hyperfine/Mitata or log viewers only for a concrete gap.
- [ ] **V-T11 — Risk expansion:** add required platform/dependency/pY combinations, replay/desync checks, longer cleanup/resource soaks, mixed connected viewers, planner/renderer/tuner latency and production budget calibration as scope demands. Respect Polytechnic's no-engine rule; changes to that boundary need explicit authorization.
- [ ] **E8 / V-T12 — Dependency and security automation:** re-evaluate exact-version/license/platform support before adoption. Local redacted secret scanning already exists; bot installation, advisory inventory disclosure and remote access remain separate decisions. No automatic pin upgrades, history rewriting or auto-merge of engine/API changes.
- [ ] **Media tooling, when requested:** prove localized visual-diff rejection and complete GIF/video encoding. Prefer a single suitable image path and pinned FFmpeg/ffprobe where encoding is needed; inspect build-dependent licenses/codecs. Do not introduce a Linux software-render farm without an actual missing capability and verified Extreme fidelity.

### Release and human gates

- [ ] **R1 / V-R1 — Detector multiplayer:** before any public detector release, use an owned private server and two actual clients to exercise mixed preferences/selection, join/leave, force/surface changes, ownership, save behavior and desync diagnostics. FactorioTest, synthetic players, reload helpers and benchmark consistency do not replace this. Local pilot work may precede this gate.
- [ ] **R2 / V-R2 — Release identity and current proof:** confirm detector listing availability/ownership and intended URLs, then requalify the exact frozen bytes against the supported matrix. Missing listing creation or repository/account changes require separate authority.
- [ ] **R3 — Publication authority:** obtain the exact source-push and/or Portal release/gallery/listing authorization. Neither a local commit nor installed prototype supplies it.
- [ ] **LLL translation review:** native speakers review German, French, Spanish, Russian and Simplified Chinese; rendering and key parity are not linguistic certification. LLL's real-client multiplayer coverage remains unverified too, not established by simulated actors.
