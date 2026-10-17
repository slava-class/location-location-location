# First-party Factorio mod monorepo migration

Status: researched design and execution checklist, reconciled with the full EMPIRE chat and the installed LLL 1.1.7 prototype. Monorepo implementation has not started. Historical probes below remain evidence for their recorded source identities, not certification of the future toolkit.

## Goal and scope

Evolve this repository into one first-party mod monorepo with internal shared development tooling. Prove the structure by extracting:

- Title: **Reversed Underground Belt Detector**
- Mod ID: `reversed-underground-belt-detector`
- Owned Lua/prototype namespace: `reversed_underground_belt_detector`

Assume `main` is clean before implementation begins. This document does not authorize implementation, installation into normal game profiles, publication, repository renaming, or archival. Preserve intervening user changes.

The toolkit is ordinary source inside this repository, not another repository, independently released package, or player-facing Factorio dependency. Each mod retains independent identity, versions, changelog, dependencies, package, and Portal release.

The detailed [verification architecture](VERIFICATION_PLAN.md) is part of this plan: Steam-independent launch options, Docker isolation, unattended diagnostics, test methods and their proof limits, harness fault tests, and measured feedback speed.

## Checklist rules and current handoff

The [migration sequence](#migration-sequence) is the execution checklist; [verification delivery](VERIFICATION_PLAN.md#9-delivery-and-acceptance) owns the detailed verification sub-checklist. The acceptance matrix and research sections below specify those tasks, rather than creating a second completion ledger. Tick an item only when its stated outcome is demonstrated; record the source/artifact identity, command/scenario, result and evidence location alongside it. `[ ]` means unfinished, including blocked or deliberately later work; a successful spike does not complete production integration.

### Decisions and research already completed

- [x] Agree one first-party monorepo with internal tooling, independent mod releases and no mandatory shared runtime mod.
- [x] Require Bun + Effect orchestration, Effect Schema at external boundaries and Effect CLI for commands. Optional exception configuration does not mean optional validation.
- [x] Research unattended native/headless/Docker execution, tool/library reuse, native blueprint fixtures and bounded Bun RCON; preserve versions, licenses, actual spike results and limitations in the verification plan.
- [x] Read the BELT thread, finalize and install the embedded detector prototype, then audit/test the bounded-work revision as LLL 1.1.7. Receipt: `.factorio-test/bounded-sweep/verified-1.1.7.json`; package SHA256 `99260e6c6e424753f6c4fd2d4ca01fa11a25729f5f4ad6da788353119805a828`. This is not extracted-mod acceptance.
- [x] Triage the later roster: **Pyanodons Polytechnic only** is an agreed later import. Brood Engineering and the complete personal pY bundle are not selected. Lumberyard is an idea for now, not an import/extraction commitment.
- [x] Record [Tram and the idea backlog](MOD_IDEAS.md): Tram targets base, Space Age and pY separately; electricity and very slow movement are agreed, other limitations deferred.
- [x] Place real two-client detector multiplayer proof **before public release**, not before local pilot sign-off. Until it passes, report multiplayer as unverified and publication as blocked.

### Before starting the migration journey

- [x] **P0 — Human game check:** the user reports that installed 1.1.7 is working well and authorizes the local checkpoint after changing alerts to default on. This acceptance does not claim that the later default-on build was installed or manually checked.
- [x] **P1 — Local checkpoint only:** the local commit containing this checklist records the user-accepted prototype, accumulated development/planning work and verified 1.1.8 default-on change. `mise run verify`, packaging and an isolated exact-ZIP default-alert behavior smoke passed. No push or Portal publication; `vac` was not used. The installed game copy remains 1.1.7.
- [ ] **P2 — Start boundary:** begin migration only when requested, from the agreed clean `main`; capture intervening changes as the new baseline rather than assuming today's version or ignored tuner state is still current.

The current prototype bounds scheduled background validation to 64 mouth entries per tick, with next-tick event-driven corrections, fair queue progress and a normal 60-tick cycle up to 3,840 mouths. Larger populations take longer without dropping coverage. This is not a bound on all mod work: surveys, event bursts, six-tick pulse updates and the offset one-second native-alert refresh remain separate costs. Silent changes by other scripts can require validation plus an alert-refresh cycle. Preserve these explicit latency/coverage contracts during extraction.

The 1.1.7 campaign reduced measured callback peaks but did **not** demonstrate an overall throughput gain. See the verification plan's current-prototype addendum for samples and limits; neither fastest test settings nor whole-stack performance acceptance is complete.


## Target layout

Proposed eventual repository name: `factorio-mods`. Establish the local layout before any GitHub rename.

```text
factorio-mods/
  .mise.toml
  package.json
  bun.lock
  patches/
  tools/                              # Shared implementation and behavioral tests
    tuning/                           # Shared development-studio mechanics
  mods/
    location-location-location/
      info.json
      dev.config.ts                   # Optional; only nonstandard requirements
      control.lua
      data.lua
      location_location_location/
      locale/
      migrations/                     # Shipped one-time retirement migration
      tests/
      dev/tuners/                     # Mod-owned studios when needed; never shipped
      types/
      README.md
      MOD_PORTAL.md
      changelog.txt
    reversed-underground-belt-detector/
      info.json
      dev.config.ts                   # Optional; only nonstandard requirements
      control.lua
      data.lua
      settings.lua
      reversed_underground_belt_detector/
      locale/
      tests/
      dev/tuners/warnings/             # Preserved/retargeted underground tuner source
      types/
      README.md
      MOD_PORTAL.md
      changelog.txt
  dist/                               # Ignored, partitioned by mod ID/version
  .factorio-test/                      # Ignored, isolated writable run state
```

Each mod directory remains a complete Factorio mod root. `info.json` remains canonical for identity, version, title, and gameplay dependencies. Prefer documented conventions for entrypoints, source/test/migration directories, locales, and package contents. An optional `dev.config.ts` declares requirements that cannot be derived safely, such as native scenes, fixture dependencies, generated content, or unusual assets; it must not repeat metadata or standard defaults. Keep mod-specific checks beside their mod and common mechanics in `tools/`.

Use one root dependency installation and lockfile. The shared toolkit runs on **Bun**, uses **Effect** for orchestration and resource management, and uses **Effect Schema** as the canonical runtime validation and type-definition boundary. Define schemas in `tools/`, derive TypeScript types from them, and resolve conventional inputs plus any explicit configuration into one validated project context. Pass validated, encoded requests to existing Python helpers rather than teaching each helper to rediscover projects. Common formatting/tool versions belong at root; Lua globals, storage types, and source roots remain project-specific. Remove obsolete per-mod task aliases and duplicate configuration paths during cutover. A conventional small mod should need only its mod directory, implementation, and relevant evidence—not a mandatory configuration file, central registration entry, or copied tools.

## Canonical project boundary and commands

Introduce one Effect-based project resolver that distinguishes repository root, selected mod root, and generated-output root. Discover `mods/*/info.json`, decode metadata and optional development configuration with Effect Schema, validate directory/metadata identity and cross-field invariants, and produce a schema-validated resolved project context used by every tool.

No default-to-LLL behavior, sibling-directory guessing, or old-root compatibility paths. A fresh checkout must not require another local checkout to build the pilot mods.

Proposed commands (not implemented):

```sh
mise run verify -- location-location-location
mise run verify -- reversed-underground-belt-detector
mise run verify -- --all
mise run package -- reversed-underground-belt-detector
mise run test-ui -- reversed-underground-belt-detector en
mise run release-prepare -- reversed-underground-belt-detector en
```

The shared development-studio entrypoint is proposed as `mise run tune -- launch reversed-underground-belt-detector warnings`, with typed inspection, candidate application, export, and explicit promotion operations through the same Effect CLI.

Permit explicit bulk verification, not implicit bulk publication. Publishing always selects one exact mod and prepared version. Keep Mise/Bun as the front door; do not add a build framework or plugin system merely for this migration.

Use **Effect CLI** for toolkit commands, subcommands, arguments, options, generated help, and parse errors. Maintain one canonical command definition rather than separate handwritten `process.argv` parsers or competing CLI libraries. Mise tasks are thin launchers that forward arguments unchanged; command semantics and validation live in the Effect CLI entrypoint. Feed parsed arguments through the shared domain schemas and project resolver before performing work. Help and invalid invocations must not launch Factorio, install dependencies, or mutate files/profiles. Pin an Effect CLI version compatible with the chosen Effect/Bun stack and exercise the real entrypoint's help, invalid-input handling, and representative commands.

Also migrate `release-version`, `release-status`, `release-publish`, gallery/listing commands, and their printed next commands to exact mod-ID arguments. Do not make the generic local installer resolve a workspace project: `mod-load` already accepts any ZIP, while `mod-unload` accepts an installed ID and `mod-restore` a receipt. Preserve that useful separation and its explicit installation authorization.

Keep verification capabilities explicit. Pilot `verify` includes offline checks and the declared engine profiles; native checks run through `test-ui` and release preparation. Later imports can retain offline-only verification, but `--all` must report each project's actual coverage and missing prerequisites rather than silently skipping unavailable engines or implying all mods received engine proof.

### Bun, Effect, Effect CLI, and Effect Schema boundaries

Optional configuration means optional repetition of known facts, never optional validation. A documented default or standard directory is part of the schema/resolution contract, not an error-recovery path. An absent exception file can be valid; a present malformed file, contradictory identity, unsupported value, or missing required input must fail with a contextual typed error. Do not catch a decode failure and continue with defaults.

| Boundary | Required contract |
| --- | --- |
| CLI arguments and environment | Use Effect CLI for command/argument/option parsing and generated help; apply shared Effect Schema domain validation and explicit environment decoding to exact targets, versions, profiles, paths, and settings before selecting work or initiating side effects. Keep secrets out of errors and receipts. |
| Filesystem and configuration | Treat JSON, parsed configuration, directory discoveries, and imported development-config exports as untrusted values until decoded. Validate the resolved project and package inputs, including containment and identity relationships. |
| Child processes and cross-language helpers | Use explicit request/result schemas for owned protocols; encode requests and decode returned data. For external tools, parse documented output into validated domain results and check exit status and expected completion. |
| Artifacts, caches, and receipts | Validate before writing and decode on every read across the persistence boundary. Schema validity does not replace checksum, freshness, ownership, or cross-target checks. Validate archive membership and binary asset metadata with the appropriate parsers and refinements. |
| Portal and other network I/O | Validate and encode outbound requests; decode external responses into the contract actually consumed. Validate returned identity and mutation readbacks rather than trusting HTTP success alone. |

Use strict schemas for owned configuration/protocols so misspelled fields do not silently disappear. External API decoders may permit unrelated fields for extensibility while requiring all consumed fields and invariants. A TypeScript annotation, cast, or `satisfies` expression is not runtime validation. An executable `dev.config.ts` remains trusted repository code; validating its export is not a sandbox for executing untrusted code.

Represent filesystem, process, and network access through narrow Effect services; use scoped acquisition/release for locks, child processes, and temporary resources, and typed error channels for actionable failures. Preserve existing publication safety: interruption after a request can leave an unknown external outcome, so resource cleanup must not imply rollback, trigger a retry, or justify duplicate publication. Introduce no automatic retries or fallback paths.

Validate at real ingress, egress, persistence, and cross-process boundaries, then pass typed validated values internally rather than re-decoding at every function call. Use one canonical schema for each owned protocol and derive its types/encoding from it; helpers still validate what they receive using that contract rather than maintaining a competing handwritten model. Pin compatible Effect dependencies in the root lockfile and prove their Bun integration through the real toolkit commands. This is development infrastructure, not a dependency shipped to Factorio players.


## Existing tooling to adapt

| Current source | Required change |
| --- | --- |
| `mise-tasks/package.py` | Replace hard-coded LLL identity and package contents with resolved project inputs and isolated output paths. Preserve deterministic bytes and archive verification. |
| `mise-tasks/release-info.mjs` | Bind metadata, listing, and version operations to the selected project rather than accepting only LLL. |
| `mise-tasks/factorio-env.mjs` | Resolve engine minimum/distribution/architecture, explicit native or Docker backend, dependencies, locale support, and profiles per project; prepare only the required dependency closure. |
| `mise-tasks/prepare-types.py` | Separate shared API definitions from per-mod storage/flib overlays; do not turn a shared generated library into one mod's types. |
| `mise-tasks/native-preview.mjs` | Replace fixed LLL scene names/counts with explicit per-mod scene specifications; retain actual framework pass records, flush/decode captures, and use the common owned-process supervisor. |
| `mise-tasks/release.mjs` | Key bundles and receipts by mod/version; serialize version changes, preparation, and publication with one per-mod lock across versions because listing/gallery are mod-wide. |
| `mise-tasks/audit.mjs` | Separate common structural checks from LLL-specific locale, control, and artwork policy. |
| `mise-tasks/checkpoint.mjs` and `workspace.mjs` | Distinguish whole-worktree checkpointing from per-mod release source identity. |
| `.mise.toml`, checker configs, `setup.mjs`, `test.mjs`, `package-smoke.mjs`, model/tool tests | Remove assumptions that repository root is the mod root; migrate all callers together. |

Preserve working algorithms and useful Python helpers rather than rewriting them solely for uniformity. Migrate shared command orchestration and boundary contracts to Bun + Effect + Effect Schema as each tool moves into `tools/`; do not leave a parallel unchecked command path. Existing helper boundaries must adopt the validated request/result contracts above. Do not add Python for the proposed blueprint/RCON capabilities: the bounded research below selected native fixtures and a small Bun transport instead. This is not a claim that the existing packaging/setup/type-generation helpers are already Python-free.

### Existing-tool adoption research

Recommendation: **compose existing engines, libraries and command-line tools behind the shared Effect boundary; build only the Factorio-specific policy and evidence integration.** “Adopt” below means a design selection for implementation, not an installed or verified integration. “Candidate” requires the bounded acceptance spike before selection; “defer” means do not introduce it for the pilot. Required capabilities remain required regardless of which tool supplies them.

This research inspected the current manifest/task/checker sources, upstream documentation and published metadata. The checkout already pins FactorioTest CLI 3.6.0, FMTK 2.1.9, Bun 1.4.2, Lua 5.2.4, StyLua 2.3.1, Luacheck 1.2.0 and EmmyLua Check 0.25.1. Retain those working paths initially rather than replacing them with a fashionable stack. The [verification plan](VERIFICATION_PLAN.md#11-existing-verification-tool-research) maps reusable testing, performance, capture and tuner components.

**Factorio-first adoption order:** preserve FactorioTest/FMTK/core/flib; evaluate the newer FactorioTest CLI's target-aware dependency lock/install/scenario features before writing equivalents. Use native scenarios and blueprint APIs for fixtures, with a narrow Bun codec only for encoded interchange. Select a bounded Factorio-specific Bun RCON service for private interactive-server control, not a Python subprocess or an unmodified generic Source client. BELT is not selected as the canonical runner after the bounded spike; keep native benchmark execution behind the shared supervisor. The [Bun-only comparison](VERIFICATION_PLAN.md#13-bun-only-blueprint-and-rcon-research) records actual engine results, exact versions/licenses and remaining limits. Editor Extensions stays in explicit authoring profiles.

#### Workspace, orchestration and contracts

| Existing tool | Decision and useful capability | Boundary / integration requirement |
| --- | --- | --- |
| [Mise](https://mise.jdx.dev/tasks/monorepo.html) | **Keep** root tool pins and thin command entrypoints. Its native monorepo mode supports path-qualified tasks and project-specific tool environments. | Do not enable per-mod Mise configs merely to duplicate our typed mod-ID resolver. Its `config_roots` discovers Mise projects, not `info.json` capabilities. Reserve nested configs for a genuine independent toolchain need. |
| [Bun workspaces](https://bun.com/docs/pm/workspaces) | **Keep one root install/lockfile**; use workspaces if the shared TypeScript tooling later becomes multiple real packages. | A collection of Factorio mods is not automatically a collection of npm packages. Do not add 100 redundant `package.json` files or mirror `info.json` identity/version just to obtain workspace filtering. |
| [Effect CLI](https://effect.website/docs/v4/api/effect/cli/Command), [process APIs](https://effect.website/docs/v4/api/effect/process/ChildProcess) and [Bun platform services](https://github.com/Effect-TS/effect/blob/main/packages/platform/bun/src/BunServices.ts) | **Adopt** command/help parsing, typed effects, resource scopes, streams, filesystem/process services and explicit argv construction instead of independent implementations. | Current v4 CLI/process/platform APIs are marked unstable: exact compatible pins and real lifecycle tests are required. A scoped child-process API does not by itself supply durable run discovery, independent log readers, container ownership, final evidence or crash classification. |
| [Effect Schema JSON export](https://effect.website/docs/v4/schema/json-schema) + Python [jsonschema](https://python-jsonschema.readthedocs.io/en/stable/) | **Candidate for the existing Python wire boundaries**: derive the supported JSON contract once and validate it in both languages, rather than maintaining separate Pydantic/TypeScript models. | Export is best-effort and can approximate unsupported semantics; it is not proof of equivalent validation. Restrict the wire-schema subset, reject unsupported constructs, test excess keys/refinements/numeric edge cases and exact canonical JSON representations. Explicitly configure format checks where needed. Keep domain/ownership checks in the canonical services. |
| [TypeScript/Bun configuration](https://bun.com/docs/runtime/typescript) and [Effect developer tools](https://effect.website/docs/v4/getting-started/devtools/) | **Adopt an actual strict TypeScript check** when introducing the toolkit; evaluate Effect-specific diagnostics for floating effects and scope/layer mistakes. | Running/transpiling TypeScript is not typechecking it. Current Effect docs describe `@effect/tsgo` with a TypeScript 7 integration; pin/prove its compiler provisioning and diagnostics before adopting it. Do not silently mix the old plugin setup with the current one or change a developer's global editor configuration. |
| [Nx task inputs/cache](https://nx.dev/docs/guides/tasks--caching/configure-inputs) | **Defer**, but a credible later general task-graph/cache backend if fleet measurements justify it; supports file/runtime/environment inputs and arbitrary commands. | No need to falsely characterize Nx as npm-only. It still needs our Factorio graph, engine/fixture/platform identities and freshness policy; cached success cannot become newly executed native/package proof. Avoid a second hand-maintained project registry. |
| [Turborepo](https://turborepo.com/docs/crafting-your-repository/structuring-a-repository) | **Do not adopt for the pilot**. Useful task scheduling/cache in a genuine JavaScript package workspace. | Its documented structure requires package metadata per package. That adds another identity/configuration surface for primarily Lua mods without removing our engine/evidence work. |
| [Testcontainers for Node.js](https://node.testcontainers.org/features/containers/) | **Defer**; useful container configuration, logs, copying, waits and cleanup primitives. Prefer the existing Docker CLI/API through the shared Effect service for the initial short-lived engine lane. | Prove Bun compatibility, offline provisioning, resource limits and artifact retention if adopted. Its resource reaper, image pulls, reuse and removal defaults need explicit treatment; stopping must preserve evidence before removal. Do not run two competing lifecycle owners. |

At research time, the npm registry reported [`effect` 4.0.5](https://registry.npmjs.org/effect/4.0.5) and [`@effect/platform-bun` 4.0.5](https://registry.npmjs.org/@effect%2fplatform-bun/4.0.5), with the latter requiring compatible Effect 4.0.5. This is a candidate version snapshot, not a floating `latest` dependency or authorization to upgrade the checkout. In v4, CLI and process modules live under `effect/cli` and `effect/process`; do not mechanically install the v3 package split from older tutorials. The inspected Bun process adapter [reuses the Node-shared spawner](https://github.com/Effect-TS/effect/blob/main/packages/platform/bun/src/BunChildProcessSpawner.ts), which is a reason to test actual Bun cancellation/pipe behavior, not to presume every path uses `Bun.spawn`.

Use the ordinary schema interpreter initially. Effect's [JIT/AOT schema compilers](https://effect.website/docs/v4/schema/compilers) are experimental performance candidates only after schema work is measured as material; they can involve interpreter paths and second passes on invalid input. Do not add speculative compiler machinery or weaken boundary validation for speed.

#### Releases, dependency upkeep and import hygiene

| Existing tool | Decision and useful capability | Why not delegate the whole workflow |
| --- | --- | --- |
| [FMTK packaging/publishing](https://github.com/justarandomgeek/vscode-factoriomod-debug/blob/current/doc/package.md) | **Keep FMTK for its selected development capabilities; do not adopt its all-in-one `publish` workflow.** Its package/upload/details commands demonstrate existing Factorio support. | `publish` can commit, tag, package, upload, update details, increment and push. Packaging defaults to broad inclusion with ignore/extra rules and documents possible duplicate member names. That conflicts with our explicit member set, namespaced tags, exact-ZIP seals, per-mod locking and authorized one-release transaction. Preserve/adapt the existing deterministic builder and release implementation rather than wrapping these side effects invisibly. |
| [Factorio Portal read API](https://wiki.factorio.com/Mod_portal_API) and [publish API](https://wiki.factorio.com/Mod_publish_API) | **Reuse official interfaces through the current typed release/readback adapter.** Read-only fleet refresh can query the exact mod-name set; published artifacts and listing changes remain explicit operations. | Listing access and authenticated downloads/publication are different permissions. No scraping the player's token, bulk accidental publication, blind retries after uncertain upload outcomes or new credential storage scheme. Decode only consumed external fields plus required identity/invariants. |
| [Changesets](https://changesets.dev/guide/beyond-npm) | **Do not adopt for mod versions now.** It supports non-npm/private projects, but still requires `package.json` name/version metadata. | It would introduce a second version authority and a Factorio changelog/Portal adapter. Revisit only for actual independently released JavaScript packages; the shared internal toolkit does not need its own release train. |
| [Renovate Mise manager](https://docs.renovatebot.com/modules/manager/mise/) and [Bun manager](https://docs.renovatebot.com/modules/manager/bun/) | **Candidate for later reviewed dependency-update proposals**, including root tools and lockfiles. Keep compatible Effect packages grouped. | Bot installation/account access is a separate authorization. Do not auto-merge engine/API pin changes, rewrite patches blindly or run arbitrary lockfile scripts in a privileged context. Factorio archive checksums, engine compatibility and Portal dependency clauses still need explicit support and verification; they are not automatically understood by a generic manager. |
| [Bun audit](https://bun.com/docs/pm/cli/audit) | **Candidate online dependency-advisory check**, using existing Bun rather than introducing another JS audit framework immediately. | It sends dependency inventory to registry advisory endpoints; keep this separate from offline checks and record skipped coverage. Do not use auto-fix as verification or silently loosen exact pins. It does not analyze Lua gameplay correctness or prove the downloaded engine/tool binaries safe. |
| [Gitleaks](https://github.com/gitleaks/gitleaks) / [Betterleaks](https://github.com/betterleaks/betterleaks) | **Candidate local secret scanning for history imports and release inputs**, rather than home-grown token regexes. | Gitleaks currently announces security-maintenance-only development; Betterleaks is its maintainers' successor and its main-branch docs distinguish v2 development from v1 releases. Select a supported pinned release deliberately. Disable credential validation/analysis/revocation and remote scans; use local, redacted detection only. Findings require review, not automatic history rewriting. |

Do not copy each mod into a generic template that brings its own release scripts, CI stack and dependency manager. Reuse small source templates only for genuinely necessary mod files, preserving upstream licenses/attribution, and have the existing project resolver create their validated context. Review exact-release licenses and transitive/native binary requirements when adding a dependency; a development tool's availability does not authorize redistributing Factorio's full client.

#### The small custom core that still earns its keep

Existing tools supply mechanisms; the repository must still own:

- Factorio identity/dependency/capability resolution, exact package/input closure and cross-target checks.
- Run ownership, persistent active-run records, durable multi-reader log/cursor semantics, outcome classification and sealed receipts across all backends.
- Product-specific engine scenes, invariants, upgrade fixtures, expected suite membership and independent oracles.
- A narrow shared fixture/interchange contract and bounded Factorio RCON transport, not prototype/data-stage emulation or 100 copies of framing/validation code. Native scenario/stdin and private RCON are explicit execution modes, never automatic fallbacks.
- Tuner parameter semantics, generated supported Lua guards, revisioned presets, restoration and source-hash-checked promotion.
- Comparable performance workloads, calibrated budgets and interpretation of correctness/latency/resource tradeoffs.
- Per-mod release locks, prepared-byte identity, authorized mutations and readback of uncertain external outcomes.

Before adopting a candidate, prove one narrow real integration: command help/invalid input without side effects; child success/failure/cancellation with final logs; schema acceptance/rejection parity across Bun/Python; one preserved/minimized property failure; one complete decode/diff/encode asset; or one bounded benchmark/profile import, as applicable. Record the chosen exact version, license, platforms, output contract and exercised limits. Drop duplicate mechanisms when a tool is adopted; keep no automatic backend or validator fallback chain.

The initial documentation pass exercised installed FMTK 2.1.9 help and Bun test-runner capability/help output only. Subsequent [isolated compatibility spikes](VERIFICATION_PLAN.md#12-isolated-compatibility-spikes) installed exact candidate dependencies in ignored scratch storage and ran owned headless engines without user interaction. Those results supersede the initial “not exercised” notes where explicitly stated; they did not upgrade root dependencies or implement the proposed toolkit. The latest blueprint/RCON evidence is in [section 13](VERIFICATION_PLAN.md#13-bun-only-blueprint-and-rcon-research).


### Isolation and reproducibility

Writable profiles must belong to a particular worktree, mod, profile, and locale/run. Two mods at the same version must not share package manifests, saves, mod directories, screenshots, results, release bundles, publication receipts, or locks. Reuse checksum-verified downloads and common tools separately from writable run state.

Each package uses an explicit resolved target-relative package specification, derived from documented conventions plus any project-specific additions. Show and validate the resulting member set; do not use a broad recursive include of the entire mod directory. Never package sibling mods, shared tooling, credentials, caches, normal saves, or generated screenshots. Ship test modules only where the mod's optional FactorioTest entrypoint requires them; normal execution must not activate fixtures.

Create fresh run directories with an exact mod allowlist; do not reuse an arbitrary accumulated `mods/` directory. The installed CLI disables extra entries but does not purge stale archives and accepts an installed FactorioTest version above its minimum rather than enforcing our exact pin. Stage checksum-pinned archives explicitly, including transitive dependencies, then record the actual enabled versions. Never let a higher cached ZIP or a sibling source symlink override the intended artifact.

Include `migrations/` in LLL's explicit shipped contents; the current builder omits it. Make the new package specification the single file-selection authority: remove the unused legacy `info.json.package.ignore` policy if no supported caller consumes it, rather than maintaining contradictory include/exclude lists. Keep licenses/attribution with each mod and classify source assets separately from generated previews.

Shared immutable API/download caches must include version/checksum and, for compiled tools, platform/architecture in their identities. Keep project-specific type overlays and invalid-call probes isolated; the current type checker writes its probe into the source root, which would otherwise interfere with concurrent source sealing.

### Engine-test selection and native evidence

FactorioTest CLI 3.6.0 accepts one primary `modPath` or `modName`, not an array. `mods` adds companions; autorun still selects one primary mod, and structured results identify that primary mod at run level. Therefore:

- Run standalone suites separately for LLL and the detector.
- Run coexistence in two isolated profiles: LLL primary with detector enabled, then detector primary with LLL enabled. Stage companion workspace mods explicitly and enable them without downloading a Portal substitute.
- Validate the result's primary-mod identity as well as its pass/failure status. Do not merge unqualified test paths into a supposed multi-mod suite.
- Keep native runs single-primary too. Match exact expected scene identities and fresh captures, not just a completion marker or nonzero screenshot count.
- LLL loses the one detector preview scene but retains its five planner gallery candidates. Give the detector its own useful gallery selection; do not require dummy scenes to satisfy the old five-candidate/two-selected constants.

### Unattended verification and diagnostics

Use one schema-backed run request, Effect-scoped process/container supervisor, and versioned evidence receipt across engine tests, native scenes, package smoke, and release preparation. Stream stdout/stderr durably, collect the run-owned `factorio-current.log` and available crash/desync artifacts, and return actionable failure details and exact reproduction inputs without opening Steam, Finder, or the game console. A marker, zero exit, or stale output file is not proof.

Use pinned official Linux headless Factorio in Docker for portable unattended engine verification and a pinned official non-Steam full client for local native/rendered verification. Keep backend choice explicit; no silent engine/backend/graphics fallback. Docker is available on this machine and the ARM64 headless path was exercised successfully. It cannot render thumbnails or replace native macOS UI proof. The reported Steam custom-argument confirmation is not an acceptable dependency for a completed unattended graphical lane; do not automate clicking or disabling it.

Give every attempt its own profile and ID, verify the actual enabled mod set, bound startup/execution/shutdown independently, and stop only owned processes/containers. Preserve errors, signals, container OOM state, full stack traces and partial evidence even when cleanup fails. Add read-only `doctor`/exact-run diagnostics through the same Effect CLI; no per-mod shell recipes or unvalidated command path.

Live logs are a pilot requirement, not merely post-run artifacts. Discover active owned test/tuner sessions and read or follow their stdout/stderr, engine log and structured events by exact run ID, with bounded cursor-based JSONL for agents. Persist output independently of readers; disconnecting or cancelling a follower must not stop the test or tuner. Expose live test progress/failures and tuner parameter revisions/capture/errors without computer use. See the [live-log contract](VERIFICATION_PLAN.md#live-logs-for-running-tests-and-tuning-sessions).

Verification must cover the verifier itself: intentional data/runtime errors, missing executables, incompatible runtime libraries, hangs, cancellation, passed-marker-then-failure, malformed/stale/foreign receipts, incomplete captures, and exact-target isolation. Combine real-engine negative controls with small subprocess fixtures for supervisor edge cases.

Expand behavior-appropriate proof beyond example tests: deterministic model/property and metamorphic cases, real save/restart/upgrade fixtures, exact-ZIP black-box scenarios, programmatic native captures, targeted mutation controls, and risk-selected multiplayer/replay/compatibility/performance lanes. Distinguish direct handler calls from real input, reload helpers from fresh-process persistence, headless checks from rendered evidence, and Lua errors from native crashes. The [verification plan](VERIFICATION_PLAN.md) specifies delivery order and acceptance; required capability validation is never optional.

### Asset quality versus test speed

All Factorio runs that generate presentation assets—thumbnails, GIF frames, Portal gallery images, and other promotional captures—must use a dedicated isolated instance with the **Extreme** graphics preset (`--force-graphics-preset extreme`). Preserve antialiased captures and verify the effective graphics settings before capture; record those settings with the generated assets. Never change the user's normal Factorio configuration. Generate capture configuration from the eventual clean baseline, not the earlier discussion snapshot.

Keep asset-generation profiles separate from routine test profiles. Test settings must be measured and iterated on until we identify the fastest reliable configuration for each relevant workload, rather than assuming either Extreme or the lowest preset is fastest. Establish a baseline, compare candidate settings with repeated end-to-end timings, distinguish cold startup from warm-cache runs, and retain the fastest configuration supported by the measurements. Record the tested settings, engine/hardware, timings, and selected configuration so the choice is reproducible.

Use headless execution where it proves the required behavior; tune graphical/native test runs independently. Speed improvements must preserve assertions, coverage, deterministic behavior, and meaningful rendering checks—do not obtain faster results by skipping work or weakening proof. Tests of presentation quality still need the appropriate Extreme capture path. If a run both tests and produces presentation assets, the asset-quality requirement takes precedence, or split it into separate test and capture runs.

### UPS and stack-wide performance requirements

Treat player-facing performance as a required verification capability, not merely a faster-test-runner project. Measure total simulation **ms/update** and relevant script/event cost, sustained overhead, periodic/burst spikes, memory/resource lifetime and event-to-result latency. A displayed 60 UPS does not prove negligible overhead: approximately 16.667 ms/update is the budget for the entire world at that rate, not for each of 100 mods. Rendering FPS/frame time, simulation cost and development-command wall time are separate outcomes.

The pilot must establish reproducible idle, active-warning, event-burst, audience/selection, install/survey and planner interaction workloads. Preserve the current per-player pulsing/steady/off semantics and cleanup; reduced warning coverage, delayed detection or hidden visuals cannot masquerade as an optimization. Add combined-mod workloads as the fleet grows to expose cumulative cost and synchronized periodic spikes. Data/prototype changes can impose engine costs even without Lua handlers.

Use the existing engine benchmark/profiling facilities and native render/interaction evidence, plus monotonic shared-runner phase measurements, Bun/Effect profiling, version-matched helper diagnostics and scoped Docker resource observations. Measure **tuners and live-log collection/readers themselves**: production-alone, observer-idle and active-observer workloads must remain distinguishable. The complete [performance contract](VERIFICATION_PLAN.md#8-stack-wide-performance-and-ups-verification) defines coverage, scenarios, measurement protocol and proof limits across the available stack.

Require sealed baseline/candidate inputs, equivalent workloads/environment/instrumentation, repeated measurements with sample counts/spread, correctness checks and explicit enabled/opt-in/removed instrumentation disposition. Calibrate numerical cost/latency/resource budgets from representative baselines; do not invent universal thresholds or automatically accept missing/noisy evidence. Report inherited failures and uncertainty separately from measured new regressions or benefits.

Performance commands and live summaries extend the same Effect CLI, schema-backed request/receipt and owned supervisor, not another toolkit. Keep detailed profiling opt-in and bounded, with disabled collection avoiding expensive work. Verify that the comparison system detects controlled cost/latency regressions and rejects incompatible or missing measurements. Establish actual baseline evidence before the mechanical move and extraction; the earlier startup probes are not a product UPS baseline.

### Release seals and checkpointing

A prepared release seals the selected mod source/listing/configuration, all shared `tools/` and `patches/`, root dependency/tool/checker configuration and lockfiles, exact ZIP, screenshots, and verification evidence. Use a declared input closure, including companion sources used by required coexistence checks. Record the full repository commit/tree as provenance separately from the scoped release-input digest. No general dependency-graph build system is required.

An isolated change outside that input closure should not invalidate a candidate; a selected-mod, required companion, or shared-tooling change must invalidate it. Changes to root shared configuration may conservatively invalidate all candidates. Project configs/checks must not read undeclared sibling sources. Preserve private-index snapshots, non-ignored untracked input coverage, additions/deletions/modes, source-drift rejection, artifact checksums, same-input commit acceptance, credential boundaries, mutation receipts, and readback verification. Merely running the existing `git add -A` snapshot helper with a nested working directory does not create this scoped identity.

Keep `vac` explicitly whole-worktree: it verifies all registered projects and shared tooling before staging the exact verified tree and attempting the existing authorized push. Reject a per-mod selector for this command; its help/output must state the full staging and publishing scope. Retain preservation of the real index on failure, HEAD/source-drift checks, and no push after a commit hook changes the verified tree. Independent concurrent work uses separate worktrees; per-mod verification never authorizes a repository-wide checkpoint.

Provide a separate explicit local-only checkpoint operation in the shared command boundary: verify the declared whole-worktree scope, preserve index/source-drift safeguards, commit the verified tree and never push. Do not make “no publication” depend on a failed push or missing credentials. The immediate prototype checkpoint can use an explicitly local Git commit; the planned command is not a prerequisite for that checkpoint.

Bind packaged smoke evidence to the tested ZIP hash, mod/version, engine, dependency set, profile/run, and observed assertions. Today release preparation relies on task order and the package manifest, not a smoke-result receipt. Seal the actual smoke receipt with the release and reject missing, stale, or cross-target evidence. Prepare once, test those exact bytes, and publish those exact bytes; do not rebuild after proof.

## Detector extraction

Proposed initial release: `1.0.0`. Preserve Factorio 2.1.20 as the initial minimum. Use base plus optional FactorioTest for development, and the optional LLL cutover-version guard below. The detector itself uses the core event library and should not need flib after separating appearance; LLL remains independently responsible for its own flib dependency.

| Piece | Work |
| --- | --- |
| `location_location_location/undergrounds.lua` | Move detection, rendering, lifecycle, and pulse behavior to the new namespace; initialize independent storage. |
| `location_location_location/underground_preferences.lua` | Move canonical alert/overlay setting names, modes and audience selection into the detector namespace; preserve per-player visibility and selected-belt span suppression. |
| `location_location_location/gui/appearance.lua` | Move only underground appearance constants and sprite registration into the detector. Keep planner appearance in LLL. |
| `settings.lua` | Move the default-on per-player alert setting and pulsing/steady/off overlay setting to detector-owned names, using the canonical preference module; preserve explicit saved choices. |
| `locale/*/LocationLocationLocation.cfg` | Move warning and setting strings across all six existing locales. |
| `tests/undergrounds.lua` | Move behavioral coverage and update module/state/setting/message ownership. |
| `tests/native_preview.lua` | Separate the underground scene, pulse capture, and tint probe from planner UI fixtures. |
| Current ignored underground tuner | Preserve its authored source/scene, then retarget dependency, imports, rendering owner, sprite IDs and development namespace to the detector; remove the old LLL-specific detector-tuner path. |
| Metadata and product material | Add detector README, changelog, listing copy, license/credits, and thumbnail. |

Preserve current semantics: connected same-force pairs, opposing exterior belts at both mouths, no auto-rotation, four directions and tiers, force-scoped warnings, default-on map alerts with a per-player opt-out and preserved saved choices, preservation of other custom alerts, stock artwork, neutral mask, current appearance defaults and premultiplied opacity pulse, subordinate span arrows, per-player pulsing/steady/off modes, and pair-specific selected-belt span suppression. Preserve existing-factory surveying, next-tick local lifecycle corrections, the persistent 64-entry-per-tick background queue, fairness through population shrink/churn, and the stated normal/overload and native-alert latency bounds. Pulse, surveys and alert batches have their own measured costs; do not describe the background cap as a total-work cap. Use the agreed clean baseline's appearance and scheduling values rather than restoring an older discussion snapshot.

Remove detector events, prototypes, settings, preference module, active state definitions, locale entries, and tests from LLL. Its current `settings.lua` contains only detector settings and can be removed if that remains true at cutover; preserve any unrelated settings added before implementation. Update LLL docs and changelog without rewriting historical release notes.

Choose and record LLL's next release version at implementation start; do not assume the current workspace version will still be the latest. In the detector's metadata, add a versioned optional dependency on LLL at or above that cutover version. This allows the detector alone and the updated pair, but rejects older LLL builds that would run a second detector. Factorio's `!` incompatibility prefix ignores versions, so a blanket or version-qualified incompatibility is not the mechanism. Preserve no hard dependency in either direction. This intentionally excludes pre-cutover LLL even if a much older release lacked the detector; no second runtime implementation or conditional ownership handoff is needed.

### Existing-save retirement

The feature appears in LLL's version history, so account for existing saves. Ship a standalone, uniquely named Lua migration in LLL's `migrations/` directory. Guard absent old state, destroy only valid render references recorded in `storage.location_location_location.undergrounds`, remove alerts using the exact owned historical message filters, then remove obsolete detector state. Inventory the shipped generic and entrance/exit message parameter forms from actual old artifacts; do not assume one current template removes every prior form or include never-shipped experimental per-unit messages as historical requirements. The migration must not require the removed runtime module or assume the old setting still exists. Never use `rendering.clear("location-location-location")`: that would clear planner rendering too. Leave recipe plans, tags, planner preferences, unrelated rendering, and unrelated alerts intact.

This is one-time retirement of owned state, not an ongoing compatibility implementation. The new mod surveys belts on installation; do not silently import LLL storage or its old per-player alert/overlay preferences. Document that alerts and overlay mode are separate preferences in the new mod.

Do not use `migrates_from`: that transfers a removed mod's entire storage, GUI, render objects, and script inventories, whereas LLL remains a separate product. Keep the retirement migration in future packages so users can skip directly over the cutover release; the engine records migration filenames and runs each once per save. Test both upgrade without the new detector and upgrade with it, plus fresh installs where legacy state is absent. Verify actual save loading after the old sprite prototype is removed; API descriptions alone do not prove that transition.

## Development tuners

Preserve the live underground-warning tuner already developed in this checkout as the first concrete studio. Its authored source currently lives under ignored `.factorio-test/tuner-src/`; a clean `main` does not protect it. During implementation, move durable mod-owned tuner/scene source into `dev/tuners/<name>/`, share orchestration/contracts/preset handling in `tools/tuning/`, and keep generated companion mods, profiles and captures ignored. Do not create another repository, published library, or mandatory tuner for each small mod.

The current tuner changes a shadow overlay while hiding product arrows. Preserve that useful experiment, but distinguish proxy preview from production proof. Use canonical source defaults, schema-backed descriptors and presets, explicit live/rebuild/restart classification, and a source-hash-checked export/promotion path. Preview-only controls must not silently become product settings; close/reset/stop must have distinct, safe semantics. Final tests and presentation captures run with the tuner absent and the actual promoted product behavior present.

Good subsequent studios include planner/picker layout, source highlights/navigation geometry, runtime behavior parameters, recipe/prototype balance, performance workloads and Extreme capture composition. Some are live native controls; data-stage changes require restart, and nonvisual parameter sweeps can use Docker. The [verification plan's tuner design](VERIFICATION_PLAN.md#6-development-tuners-and-parameter-studios) records the current source/evidence, opportunities, Effect Schema/Lua boundary, ownership and restoration, programmatic operation, and candidate-to-source acceptance.


## Scaling toward 100 small mods

Goal: adding another small mod should add almost no administrative work. Centralize recurring work, not every possible variation. The following are design requirements and staged extensions, not claims that fleet tooling already exists.

### 1. Convention-first configuration

Derive identity and engine compatibility from `info.json`, supported locales from `locale/`, entrypoints from the mod root, and standard source/test/migration paths from documented conventions. Keep only exception configuration optional: schema decoding, invariant checks, and a complete validated resolved configuration are mandatory for every mod. Inspectable resolved configuration must explain the selected checks and package contents. Missing tests, missing generated outputs, or ambiguous requirements must not silently disable required verification.

### 2. Capability-based verification

Compose applicable checks rather than making every mod inherit LLL's full test and capture workflow:

| Capability | Required kind of evidence |
| --- | --- |
| Prototype/data changes | Load resolved prototypes and assert intended behavior and boundaries. |
| Runtime behavior | Engine scenarios, lifecycle transitions, and save/reload checks. |
| GUI or world rendering | Native assertions and relevant visual evidence. |
| Persistent state | Real old-to-new upgrade fixtures and migration checks. |
| Generated content | Generator validation and reproducibility. |
| Presentation assets | Separate Extreme-preset captures. |

Combine capabilities as needed. Discover obvious requirements from entrypoints and conventional files; require an explicit declaration where behavior such as persistence cannot be established safely. Do not interpret the absence of a test or scene as evidence that its capability is absent. Keep generic structural checks common to all mods and specialized assertions local. Tiny data-only mods do not need arbitrary GUI scenes, runtime suites, or a fixed gallery size.

### 3. Affected-mod verification and evidence reuse

Introduce affected selection when full-fleet verification becomes a measured obstacle. A mod-local change selects that mod and declared dependents; a shared-tool change selects its consumers; root toolchain changes select broad verification. Retain a deliberate full-fleet command, and select the broader set when the dependency map cannot establish a narrower safe boundary.

Start with an explicit small dependency map using the release-input closures, not a general build system. Evidence reuse must key on source inputs, toolchain, engine build, dependency hashes, profile/configuration, and relevant platform or rendering environment. Report reused results as reused, with their provenance, rather than presenting them as newly executed. Shared-source or dependency changes invalidate consumers; elapsed time or a similar previous run is not sufficient evidence.

This does not weaken whole-worktree checkpointing or exact-ZIP release proof. Keep the initial pilot's checks fresh; introduce caching only after measurements and behavioral checks establish sound invalidation, including changed, added, and deleted inputs.

### 4. Engine startup, scheduling, and batching

Measure engine startup separately from assertions and total wall time. Bound concurrent instances according to measured machine capacity instead of launching one process per mod without limit. Share immutable downloads, preserve isolated writable run state, and schedule expensive graphical captures separately from fast behavioral checks.

Investigate batching compatible data-stage assertions into a dedicated engine harness only if startup costs justify it. A combined-mod environment can mask missing dependencies and introduce interactions, so label combined evidence accurately and retain standalone package/dependency proof. FactorioTest's single-primary constraint remains: do not assume runtime suites can be concatenated into one invocation. Adopt batching only after comparison against independent execution preserves the required assertions and exposes rather than hides failures.

### 5. Generated fleet status

Provide a read-only root overview, proposed as `mise run mods`, from discovered metadata and verification/release receipts. Show each mod's ID/title, local version, engine target, verification coverage/result and whether evidence is current, prepared-release state, and missing prerequisites or blockers. Derive state; do not maintain another hand-edited version/status registry.

The local overview works offline. Portal state is unknown unless explicitly refreshed or available from a timestamped prior readback; distinguish cached, stale, unknown, and confirmed state. An explicit Portal refresh is read-only, selects a stated scope, and must not upload, create listings, change local versions, or install mods. Readbacks should retain exact target/version and usable next commands.

### 6. Lightweight new-mod creation

Add a small creation command when onboarding the next mod. It establishes the requested identity, conventional layout, and selected verification capabilities; it references shared tools and writes exception configuration only where needed. Refuse existing targets rather than overwriting work.

Creation must not invent gameplay, fabricate passing tests, mark a new mod verified, generate empty suites merely to obtain green status, or create/publish a Portal listing. The acceptance case is adding a genuinely tiny implemented mod with relevant behavioral evidence without modifying the shared toolkit, editing a central list, or copying another mod's scripts.

### 7. Runtime sharing remains a separate decision

Share development helpers directly inside the repository. Do not add a player-installed runtime framework just because the collection grows. If repeated small runtime utilities become a demonstrated maintenance cost, consider deterministic build-time inclusion with explicit source provenance, license preservation, package verification, and affected-consumer tracking. Each resulting mod ZIP must remain self-contained unless it declares an actual runtime dependency.

Only consider a separately installed library mod when shared runtime state or services justify that dependency. Neither build-time runtime sharing nor a library mod is required for the detector split.

### Delivery order

Establish convention-first resolution, composable verification requirements, and a minimal generated local fleet overview alongside the initial architecture. Prove them with LLL and the detector. Add the creation command with the next small-mod onboarding case. Introduce affected-run caching and engine batching only when measured fleet costs justify them, retaining the same safety and evidence contracts. Keep all of these in this repository; no separate toolkit release process is introduced.

## Migration sequence

### A. Establish monorepo structure with unchanged LLL behavior

- [ ] **A1 — Freeze the baseline:** after P0–P2, record clean source commit, tool/engine identities, source/package hashes and existing check results. Preserve this repository's history.
- [ ] **A2 — Preserve upgrade evidence:** before moving files, generate an isolated real old-artifact save containing detector warnings, planner plans/tags and unrelated alerts/rendering. Retain the package and preconditions; never use the normal save as a disposable fixture.
- [ ] **A3 — Preserve tuner authorship:** snapshot ignored `.factorio-test/tuner-src/` and its smoke scene before any cleanup; move durable authored source to mod-owned `dev/tuners/`, leaving generated profiles/captures ignored and active sessions undisturbed.
- [ ] **A4 — Measure before moving:** establish repeated representative product UPS/latency/resource and tool end-to-end baselines, with environment, scenario, instrumentation and cold/warm identities. Existing spikes are not this baseline.
- [ ] **A5 — Move the product:** place LLL under `mods/location-location-location/`, leaving its detector embedded until the mechanical move is verified.
- [ ] **A6 — Establish the typed boundary:** implement one canonical resolver and strict Effect Schema contracts for target/config/input/output identity; compose declared capabilities without a manual mod registry or silent defaults.
- [ ] **A7 — Migrate orchestration:** move shared tools to `tools/`, use Bun + Effect and Effect CLI, and migrate every task/checker/package/release/native caller together. Preserve working Python helpers through the canonical validated contract, without adding Draftsman or Python RCON.
- [ ] **A8 — Isolate runs and dependencies:** separate worktree/mod/profile/locale/run writable state, checksum-pin immutable inputs, verify actual enabled dependency closure and enforce resource/ownership boundaries.
- [ ] **A9 — Deliver unattended verification:** complete verification checklist V-A, including native and Docker supervisor paths, live logs, failure diagnostics, standalone graphics, negative controls and performance receipts.
- [ ] **A10 — Deliver local fleet status:** derive offline current/stale/missing/failed evidence from canonical metadata and receipts, with unknown Portal state explicit.
- [ ] **A11 — Update developer entry points:** root README/guidance describes the workspace; LLL retains its own product rules, attribution and docs. Update links, exclusions, type overlays and local-only versus publishing command descriptions.
- [ ] **A12 — Accept the move:** rerun LLL checks/native preview through the common boundary; compare package members/bytes and paired performance to A1/A4, explain intentional differences and investigate new regressions. Do not conflate moving files with extracting the feature.

### B. Extract detector and retire LLL's implementation

- [ ] **B1 — Establish independent identity:** create the exact requested detector ID/title/namespace, proposed 1.0.0 release, declared engine minimum and minimal dependencies; choose the actual LLL cutover version at implementation time.
- [ ] **B2 — Move all ownership:** move runtime/preferences/settings/styles/sprites/locales/tests/native scenes and product documentation/artwork; preserve the extraction semantics above, including pair-specific hover and bounded scheduling.
- [ ] **B3 — Remove the embedded implementation:** delete obsolete detector registrations, definitions and owned files from LLL while preserving unrelated planner behavior/settings; no aliases or runtime shim.
- [ ] **B4 — Ship narrow retirement:** package the persistent one-time migration; verify all shipped old alert forms and render-state cleanup without clearing unrelated data. Enforce the optional versioned LLL guard against duplicate detectors.
- [ ] **B5 — Retarget the tuner:** move dependency/import/render/sprite ownership in the same cutover; establish shared schema-backed controls, preset export/promotion, stale-source rejection and safe reset/close/stop.
- [ ] **B6 — Prove upgrade and behavior:** complete verification checklist V-B for standalone, coexistence, real baseline upgrades, fresh-process serialization, exact ZIPs and tuner-free native behavior. Run each required primary FactorioTest suite explicitly.
- [ ] **B7 — Compare equivalent performance:** compare old embedded LLL with new LLL-plus-detector on equivalent fixtures; separately identify detector-alone results. Cover latency, peaks, total update cost and resource lifetime, not just average UPS.
- [ ] **B8 — Accept the extraction:** both mods work independently, their combination has exactly one detector, upgrade preserves planner data, and required local proof is complete. Record multiplayer as pending V-R1 rather than implying it passed.

### C. Prove multi-mod tooling and independent releases

- [ ] **C1 — Prove isolation:** exercise two targets sharing a version; reject exchanged, wrong-target, stale, missing and tampered artifacts/receipts across profiles, bundles and locks.
- [ ] **C2 — Seal real inputs:** verify declared release-input closures, source drift and companion dependencies; unrelated-mod edits preserve a seal while selected/shared/required-companion changes invalidate it.
- [ ] **C3 — Prove exact packaged behavior:** smoke the actual frozen ZIPs with FactorioTest and source checkouts absent, asserting detection and cleanup with an external scenario rather than adding production test interfaces.
- [ ] **C4 — Prepare local releases:** freeze independent packages, native/gallery evidence and receipts; no rebuild after proof, no upload or automatic listing creation. Exercise the first-release-existing-listing and missing-listing branches.
- [ ] **C5 — Prove checkpoint boundaries:** shared local-only checkpoint never pushes; whole-worktree `vac` verifies all consumers and explicitly publishes source, rejecting per-mod selectors and preserving index/drift safeguards.
- [ ] **C6 — Prove fresh checkout:** install root dependencies and explicitly provision engines/dependencies, reproduce selected-mod and `--all` results/ZIPs without sibling repos or normal game state. Same CLI works in CI; native proof needs a graphics-capable worker.
- [ ] **C7 — Sign off the local pilot:** A/B/C and V-A/V-B are complete, fleet status is accurate, remaining later/publication gates are visible. This does not authorize publication.

### D. Import the agreed remaining first-party project

- [ ] **D1 — Audit import provenance:** record Polytechnic's clean source commit and destination prefix; review history for secrets/private/generated content before importing. Stop for a sanitization decision if necessary.
- [ ] **D2 — Preserve history:** one-time non-squashed import of `py-research-dossier`, with ancestry, authorship and licenses intact; no nested repository, submodule or ongoing subtree synchronization. Preserve conflicting tags using explicit provenance/namespaced refs; future tags use `<mod-id>/v<version>`.
- [ ] **D3 — Adopt the shared toolkit:** retain authored content and specialized validation, exclude player-specific feedback/audit outputs, preserve the declared minimum (currently 2.1.21) and deliberately offline verification contract. Remove duplicate common tooling without mislabeling offline proof as engine proof.
- [ ] **D4 — Verify the import:** exercise its declared checks/package and shared-tool consumers, confirm independent version/release identity and fresh-checkout behavior.
- [ ] **D5 — Close consolidation:** document source-to-prefix provenance and any separately authorized remote/issues/releases/tag/URL transition. Ignored local artifacts and remote metadata do not move automatically.

Only Polytechnic is selected in the latest triage. Brood Engineering and the full personal pY tweaks mod remain outside this migration; retain the following research for a future scope decision, not as work currently owed:

- Brood would need floating tool pins and hard-coded executable paths replaced while preserving declared 2.0 support.
- The personal bundle's canonical ID is `arrayjam-hard-py-lazy-biter-run-tweaks`, not checkout name `yura-py-run`; a future import would need to remove its sibling-Brood test dependency and distinguish shipped graphics from previews.
- Lumberyard is recorded in [the ideas backlog](MOD_IDEAS.md), explicitly not an approved extraction or whole-bundle import.
- Upstream-tracking forks and external API/documentation tools remain outside. Shared tooling supports distinct declared engine targets without silent upgrades.

### E. Grow toward 100 small mods

- [ ] **E1 — Prove cheap onboarding:** use the shared creation command for a genuinely small, implemented mod with behavior tests; no mandatory per-mod package/config, central registration, copied tools or placeholder-green scaffold. Do not automatically choose Tram for this case.
- [ ] **E2 — Expand useful studios:** use the detector studio as the pattern for planner/layout, source highlights, runtime/balance, workload and Extreme capture studios when each has a concrete consumer; preserve live versus rebuild/restart and proxy versus product proof.
- [ ] **E3 — Tune test settings:** run repeated end-to-end cold/warm experiments per workload/backend to choose the fastest reliable settings without weakening assertions; Extreme remains mandatory for every presentation asset run.
- [ ] **E4 — Add affected selection/caching when measured:** implement declared input/dependency invalidation and honest cached-result provenance; prove relevant shared/companion changes cannot reuse stale evidence.
- [ ] **E5 — Add bounded batching/concurrency when measured:** measure startup amortization and resource contention, preserve single-primary suite accounting and standalone package/dependency proof, and report combined-run limits.
- [ ] **E6 — Verify fleet-scale performance:** exercise named combined workloads, periodic alignment and multi-run contention; extend calibrated budgets and soaks rather than multiplying a single-mod average by 100.
- [ ] **E7 — Reconsider runtime sharing only with a real repeated need:** prefer no runtime library; if selected later, seal deterministic vendored/package bytes and explicit dependencies rather than introducing hidden coupling.
- [ ] **E8 — Maintain the tool decision backlog:** complete applicable verification checklist V-T spikes before adoption; keep rejected/deferred options and exact version/license evidence, not speculative dependencies.

### R. Public-release gates, separate from local completion

- [ ] **R1 — Real multiplayer:** complete V-R1 before any public detector release; local pilot completion is allowed first by explicit user decision.
- [ ] **R2 — Verify target identity:** confirm detector listing availability/ownership and intended source/homepage URLs, with explicit authorization for listing creation, account changes or repository rename/archive.
- [ ] **R3 — Authorize each publication:** obtain authorization for the exact source push and/or frozen Portal release/gallery/listing scope. A local commit, installed prototype or completed plan is not that authorization.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| LLL alone | Planner regressions/native UI pass; no active detector remains. |
| Detector alone without LLL/flib | Base and Space Age behavior works, including warning detection and cleanup. |
| Both installed | Two explicit primary-mod runs plus coexistence assertions; no namespace conflicts, duplicate warnings, or planner changes. |
| Old LLL plus detector | Versioned optional dependency rejects the pre-cutover combination; detector alone remains allowed. |
| Upgrade from baseline LLL | Test with and without the new detector; shipped migration retires old state while preserving plans/tags, unrelated rendering, and alerts. |
| Save/reload | Correct resumed detection without stale or duplicated overlays. |
| Native rendering | Fresh screenshots/pulse capture show correct direction, tint, opacity, and mouth/span hierarchy. |
| Packaged ZIPs with FactorioTest disabled | Load and exercise actual changed behavior, not merely source-based tests. |
| Same-version cross-target tooling | Artifacts/receipts cannot be exchanged; wrong-target and tampered bundles rejected. |
| Source seals | Edits outside declared inputs preserve a candidate; selected-mod/shared-tool/required-companion changes invalidate it. |
| Asset generation | Thumbnails, GIF frames, and gallery captures come from isolated Extreme-preset runs with effective graphics settings recorded. |
| Test-run tuning | Repeated baseline/candidate timings identify the fastest reliable settings per workload without reducing coverage or weakening assertions. |
| Convention-based onboarding | A genuinely tiny implemented mod uses shared tools without mandatory exception configuration, central registration, or copied scripts. |
| Capability selection | Relevant checks compose; missing required evidence fails rather than silently dropping a capability. |
| Fleet overview | Local metadata/receipt-derived status works offline and distinguishes unknown/stale Portal state from fresh readback. |
| Later affected-run caching | Changes invalidate all affected consumers; reuse reports exact provenance and never disguises stale results as fresh runs. |
| Later engine batching | Measured gains preserve assertions and standalone dependency/package proof; combined evidence is identified as such. |
| Later runtime sharing | Included runtime bytes have deterministic provenance and package coverage; no accidental undeclared library dependency. |
| Effect boundary validation | Real commands reject malformed inputs, misspelled owned fields, wrong-target results, invalid persisted evidence, and unsuccessful process/network outcomes without fallback or unauthorized side effects. |
| Unattended launch/readback | Successful and deliberately failing engine runs complete without user interaction; exact-run logs, stack traces, exit facts and reproduction inputs are available programmatically. |
| Live test/tuner logs | Output is readable before producer completion; independent readers can follow/resume by cursor on native and Docker runs, and reader cancellation leaves the session running. Partial writes, rotation, recording failure and crash/final-drain behavior are covered. |
| Steam-independent graphics | The selected standalone full client runs required scenes without Steam confirmation; headless success does not substitute for this acceptance. |
| Docker backend | Pinned engine/image/platform pairing runs with isolated inputs/output and bounded resources; diagnostics survive failure and owned-container removal. |
| Harness negative controls | Invalid input, missing/incompatible executable, hangs, cancellation, passed-marker-then-failure and incomplete/foreign evidence cannot become green results. |
| Actual dependency set | Requested and observed names/versions agree, including bundled expansion modules; no source ZIP/symlink substitution or silently enabled companion. |
| Save and capture completion | Save/reload uses real serialized bytes in a fresh process; native captures are flushed and fully decoded before shutdown, not accepted by a fixed sleep or header alone. |
| Expanded capability evidence | Model/property, mutation, multiplayer/replay, visual and performance checks report exactly what was exercised and their limits; absent required proof remains visible. |
| Development tuner preservation | Ignored authored tuner/scene work is captured before cleanup, retargeted with detector ownership, and excluded from release ZIPs. |
| Tuner-to-product handoff | Validated presets preserve units/identity/source hash; stale or preview-only promotion is rejected; the actual product reproduces the chosen result with no tuner dependency. |
| Product UPS and latency | Repeated sealed-baseline/candidate runs cover idle, representative scale and bursts; total update cost, relevant script cost and event-to-result latency are reported together, with correctness and explicit limits. |
| Performance evidence integrity | Comparable fixtures/environment/units, sample counts/spread, baseline budgets and instrumentation mode are validated; missing/inconclusive evidence is not green, and controlled cost/latency regressions are detected. |
| Tooling and observer overhead | Real Bun/Effect/helper/packaging/Docker command paths are measured end to end; tuner and live-log CPU/memory/I/O/latency remain distinguishable from product cost, with slow/disconnected-reader and cleanup cases. |
| Fleet performance | Named multi-mod workloads expose aggregate engine cost, periodic alignment and resource contention; individual mod averages or cached check results do not substitute for combined fresh evidence. |

The existing ten-update loader proves loading, not detector behavior. The current background queue has a normal 60-tick cycle and longer overload cycles; native alerts have a separate refresh. Packaged smoke must create a reversed pair, observe actual warning/alert behavior, correct it and observe cleanup within the declared fixture-specific bounds, rather than passing because a fixed tick count elapsed.

Include no-FactorioTest package runs with LLL alone, detector alone and both, with no source checkout in the tested mod directory. Preserve the original ten-tick loader as load evidence if useful, but never label it detector-behavior proof.

Fresh-checkout acceptance must cover root dependency installation, explicit engine/dependency provisioning, selected-mod commands, `--all`, and reproduction of each target ZIP without sibling repositories. Full graphical distributions require legitimate game/expansion access; the official Linux headless distribution is publicly downloadable and currently includes Space Age content. Pin exact versions/checksums and report unavailable required profiles rather than claiming success. CI can invoke the same commands and Docker backend, with native proof on a separately graphics-capable runner; automatic Portal/source publication and a new CI platform are not required by this migration.

## Completion and publication boundaries

Pilot complete means LLL and the detector independently pass the convention-first common tooling, including capability-appropriate checks, generated local fleet status, baseline upgrade, and packaged-behavior proof. Full consolidation additionally means importing the agreed remaining first-party mods and removing duplicate common tooling. The next-small-mod creation case and measurement-gated fleet optimizations follow the delivery order above; they do not require building a 100-mod platform before the pilot works.

Repository renaming, old-repository archival, source pushing, initial Portal listing creation, and Portal publication are separate authorized actions. Update canonical source/homepage URLs when the destination is established. For the detector, verify target availability/ownership before publication. The current publisher supports an existing listing with an empty release list in its version-selection logic, but requires metadata to exist and has no listing-creation path. Add coverage for that first-release branch and missing-listing failure; do not silently turn a failed readback into listing creation. Gallery/listing-only writes require an already-published matching version.

## Evidence status

The source re-evaluation retained the monorepo decision and the staged move-then-extract sequence. It tightened these previously underspecified boundaries:

1. Separate primary-mod FactorioTest runs from coexistence; preserve run-level identity.
2. Fresh exact dependency profiles rather than trusting reused caches/CLI minimum-version checks.
3. Shipped one-time LLL migration, narrowly scoped cleanup, no wholesale mod replacement.
4. Versioned optional LLL guard to prevent dual detectors.
5. Per-mod release locks across versions, scoped declared source closure, and ZIP-bound smoke receipts.
6. Explicit whole-worktree `vac`, first-listing prerequisites, and fresh-checkout/import acceptance.
7. A common unattended runner/evidence boundary, Docker headless lane, standalone graphical lane, verifier fault tests, and capability-specific proof methods; see [verification research and design](VERIFICATION_PLAN.md).

Source anchors for implementation (paths describe the pre-migration layout):

- [Current task graph](.mise.toml), [project environment](mise-tasks/factorio-env.mjs), [source snapshot](mise-tasks/workspace.mjs), [checkpoint](mise-tasks/checkpoint.mjs).
- [Packager](mise-tasks/package.py), [package smoke](mise-tasks/package-smoke.mjs), [release seals/publisher](mise-tasks/release.mjs), [Portal transport](mise-tasks/mod-portal.mjs), [generic local installer](mise-tasks/local-mod.mjs).
- [Type generation](mise-tasks/prepare-types.py), [typecheck probe](mise-tasks/typecheck.mjs), [native runner](mise-tasks/native-preview.mjs).
- [Detector runtime](location_location_location/undergrounds.lua), [shared appearance](location_location_location/gui/appearance.lua), [planner lifecycle](location_location_location/event_handlers/planner.lua), [detector regressions](tests/undergrounds.lua), [native fixtures](tests/native_preview.lua).
- Installed pinned CLI 3.6.0: `config/cli-config.js` (one string `modPath`), `run.js` (one autorun primary), `mod-setup.js` (dependency installation and profile adjustment), and `test-results.js` (result shape). These are dependency sources, not files to vendor or routinely fork.
- [Factorio mod structure and dependency semantics](https://lua-api.factorio.com/2.1.21/auxiliary/mod-structure.html), [migrations](https://lua-api.factorio.com/2.1.21/auxiliary/migrations.html), [data lifecycle](https://lua-api.factorio.com/2.1.21/auxiliary/data-lifecycle.html). Read from the local 2.1.21 documentation corpus; validate the engine behavior at the declared supported minimum during implementation.
- [LuaRendering ownership](https://lua-api.factorio.com/2.1.20/classes/LuaRendering.html) and [LuaRenderObject validity](https://lua-api.factorio.com/2.1.20/classes/LuaRenderObject.html), checked against the local checksum-pinned 2.1.20 runtime API.

Exploration exercised existing `readInfo`/`profileConfig` without preparing a profile: they resolved the current root mod as `location-location-location` version `1.1.3`, confirming the current single-root contract. The installed CLI schema accepted a single `modPath` and a companion-mod list and rejected an array of primary mod paths. Neither probe launched Factorio, modified a game profile, or called the Portal. No planned migration, engine, native, or publication acceptance is claimed as passed.

Subsequent verification research ran eight isolated headless probes: successful prototype/runtime execution and intentional data/runtime failures, on both the installed macOS Steam binary and official Linux ARM64 Factorio in Docker. All completed without user interaction or computer use; failures returned nonzero with readable stack traces. These are runner-feasibility probes, not the migration or full mod test acceptance. The [verification plan](VERIFICATION_PLAN.md) records exact provenance, the observed glibc incompatibility and unexpected bundled-mod enablement, timings without comparative speed claims, and untested graphical/crash/multiplayer limits.
