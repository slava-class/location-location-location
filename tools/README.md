# Developer guide

The [LLL README](../mods/location-location-location/README.md) covers using the mod. This guide covers local development; [RELEASE_AUDIT.md](../mods/location-location-location/RELEASE_AUDIT.md) records acceptance coverage, compatibility evidence, translation review status, and remaining human checks.

## Shared source quality

Mise supplies pinned binaries; the shared Bun + Effect CLI selects the source closure and owns subprocesses, live logs and receipts. Trunk runs the general-purpose static tools. These commands do not launch Factorio, install mods in the normal profile, commit or publish:

```sh
mise install
mise exec -- bun install --frozen-lockfile
mise run setup
mise run format -- --all
mise run format-check -- --all
mise run check -- --all
mise run check -- location-location-location
```

Choose one mod or `--all` explicitly. A selected mod includes its shared toolkit/configuration inputs and declared companions, not unrelated products. New/untracked source is included; generated files, dependencies and `.factorio-test/` artifacts are excluded. Follow the exact `logs` command printed when a subprocess starts to read it live or after completion.

| Surface                         | Formatter                                            | Other checks                                                                            |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TypeScript / JavaScript         | Oxfmt                                                | Oxlint with native TypeScript 7 and Effect diagnostics; Knip                            |
| Markdown / JSON / YAML / TOML   | Oxfmt                                                | Offline local Markdown links, text hygiene and secret scanning                          |
| Lua                             | StyLua, preserving Lua 5.2 semantics with `--verify` | Project-aware Luacheck and EmmyLua remain in the full per-mod verification lane         |
| Python helpers                  | Ruff                                                 | Ruff and ty against the locked `.venv`; shared Effect Schema wire contracts still apply |
| Shell / workflows / Dockerfiles | shfmt for shell                                      | ShellCheck, actionlint and Hadolint where those sources exist                           |

`check` and `format-check` never apply fixes. `format` changes layout only, not imports, package-field ordering, embedded code fences or semantic lint findings. Full product verification additionally audits mod contracts, runs the Factorio-aware Lua checks, tests and exact package/engine scenarios; the common static lane is not gameplay proof.

Bootstrap patches the pinned Oxlint/tsgolint pair with `@effect/tsgo`; there is no second authoritative `tsc` pass or silent unpatched fallback. The supported Effect CLI/process/platform imports are explicitly allowed in `tsconfig.json`; other correctness diagnostics remain enabled. Python stays on the pinned project interpreter, with one `uv.lock` and jsonschema dependency rather than per-helper ad-hoc environments.

Trunk's exit zero means “no new issues,” not necessarily clean source. Our verifier also rejects existing issues and incomplete or unsupported summaries. It does not accept `.trunk/user.yaml` overrides, cached success or a changed source snapshot. It re-enumerates the selection afterward, including after failure/cancellation, so additions and deletions cannot hide behind unchanged hashes of the original files. Native diagnostics and final subprocess state remain in the reported run directory; stdout stays machine-readable on failure.

Quality commands hold one workspace-wide ownership lock, including when selecting different mods. An overlapping invocation fails busy rather than racing a formatter, stealing the lock or retrying. Inspect the recorded owner before recovering an interrupted lock.

Local checks deliberately do not pass Trunk's `--ci`: the pinned CLI stopped its shared daemon after a CI-mode check, disrupting another active client. An isolated native control without that flag retained the same daemon after both exit-zero and deliberate exit-one checks. The ordinary owned-process-group policy remains unchanged; the toolkit does not shut down an unrelated developer/editor daemon.

Knip runs once through the always-selected `knip.config.ts`, with the selected source inventory passed explicitly. Its findings can point into other selected files; the trigger is not a restriction to checking that one config. An isolated wide/narrow/wide control verified both cross-file findings and changing selection in the same daemon. This avoids a virtual project-root target inflating Trunk's checked-file count.

`defineProjectTooling` is the intentional public extension API. A product may export `dev/tooling.ts` with typed `setup`, `audit` and/or `command` operations; the shared boundary supplies owned Effect services and cancellation. Only explicit setup invokes provisioning; help loads definitions without running those operations. Product commands use Effect CLI through `mise run project -- <mod> -- <command> [options]`, not another shell/task runner. Selected-mod analysis may exclude other product consumers, so the API's explicit `@public` declaration follows Knip's contract without broadening the selected source closure.

Betterleaks uses local redacted detection with credential validation disabled. Automatic Git hooks, cloud result uploads and online dependency-advisory scans are not part of these commands. Local-link checking deliberately does not crawl HTTP URLs or validate heading anchors.

Lua formatting and Luacheck cover authored runtime, tests, tuners and shared Lua fixtures. Shared engine fixtures/studio code have explicit runtime globals; tuner companion storage is distinct from the shipped product's storage. EmmyLua retains each product's explicit scope: `dev/` (including Polytechnic's offline API fixtures), LLL's `tests/planner.lua` and the detector's `tests/undergrounds.lua` are excluded. Do not describe these exclusions as full static type coverage; model and real-engine tests remain separate evidence. Polytechnic's generated catalogue emits explicit record/target lines and uses the same pinned StyLua configuration before generation/freshness comparison.

The pinned FMTK/EmmyLua combination needs one shared GUI-index adapter: variable child names otherwise infer as impossible, and missing children must remain nullable under the [native indexing contract](https://lua-api.factorio.com/2.1.21/classes/LuaGuiElement.html#index_operator). Type preparation projects that index through table inheritance. Every typecheck rejects both an invalid engine argument and an unguarded dynamic child lookup, while requiring the corresponding guarded lookup to pass. Product-owned window shapes describe children created together; no diagnostic is disabled to obtain a clean result.

Successful subprocess and aggregate verification receipts are written only after their diagnostic logs seal successfully. A zero-exit child with an unwritable final log marker is a failed run, not a successful receipt with missing evidence.

Generated output uses one canonical-path guard across project/workspace resolution, fresh run allocation, logs, locks, package/type/quality outputs, dependency caches and release directories. Existing or dangling filesystem aliases fail before directory creation; a run-root alias introduced after project resolution is rejected again at allocation. Lock cleanup checks the same path and owner token rather than deleting a replacement. These are ownership checks in the local workspace, not a sandbox against an adversary concurrently replacing arbitrary filesystem components.

A regular file appearing between missing-path and dangling-link probes is valid: `readlink` reports `EINVAL` for that non-link, and the guard still validates its ancestors. This matters during engine-log rotation. Newly introduced dangling or parent aliases remain rejected; unrelated I/O errors still fail.

## Setup

Use Mise, a C compiler, and an explicitly compatible Factorio executable. LLL declares a minimum of 2.1.20; engine version/build/distribution are recorded per run. Its full verification includes a Space Age profile and requires the expansion. Other mods use their own declared capabilities and engine floor.

Bootstrap explicitly with `mise install`, then `mise exec -- bun install --frozen-lockfile`, then `mise run setup`. The first two commands provision the pinned binaries and the one root Bun dependency installation; the canonical Effect CLI must be installed before it can parse commands. `setup` verifies the installed toolchain, synchronizes the locked Python environment, and prepares project-local Lua tools without starting Factorio. Mise automatic tool installation is disabled in this repository, and ordinary `verify` does not depend on `setup`. Help and malformed invocations reach the same Effect CLI without running dependency installation or allocating verification runs.

Provision pinned mod archives separately with `mise run dependencies-provision -- <mod>` or `--all`. Engine-backed products receive their required external/companion closure and FactorioTest. Offline products receive only the shared Lua type libraries; receipts explicitly identify the `offline-tooling` scope and unprovisioned runtime requirements. This does not claim a runnable pY installation or fetch another product's runtime stack. Current reviewed pins include FactorioTest 3.1.0 and flib 0.17.2. Ordinary engine/profile/type callers only resolve and checksum-verify existing archives: a missing or corrupt cache fails without reading credentials or downloading a replacement.

`setup` also provisions checksum-pinned Factorio API documents and Lua tool archives through Bun's bounded HTTPS boundary. The Python builder consumes only supplied local archives; type preparation consumes only supplied API documents. Lua cache identity includes the platform, source pins and builder bytes; the manifest records the actual compiler/Lua executable and every built file. Ordinary lint/type checks verify that complete inventory and executable permissions before use. Missing, extra or changed files fail without an implicit rebuild or repair. Older cache directories remain untouched and are not fallback inputs.

Polytechnic's setup hook provisions the exact reviewed pypostprocessing text helper from a checksum-pinned upstream commit, without an installed profile or sibling checkout. Its 2.1.21 API floor is independent of LLL/detector's 2.1.20 floor. The helper's CC-BY-NC-ND-4.0 provenance stays in the private cache and is not relicensed or packaged; the product README describes explicit full-source review and historical replay.

Ordinary Python helpers require the existing canonical `.venv` and use `uv run --locked --no-sync --offline --no-python-downloads`; a missing environment fails before run allocation. Full native verification passed with no HTTP client service supplied to the Bun orchestrator, including the API/type and archive helpers. This demonstrates the orchestration contract, not OS-level network isolation of host binaries. The five real-cache corruption controls and native/Docker outcomes are retained in `.factorio-test/offline-toolchain-evidence.json` and `.factorio-test/offline-toolchain-native-evidence.json`. The Docker attempt timed out under concurrent load; it is not relabeled as a successful offline verification.

Python helpers are selected by validated repository-relative `.py` paths and invoked as modules from the repository root. Both shared and product-owned helpers import `tools.helper_protocol`; request/result JSON Schemas come from the same Effect contracts. Traversal, filesystem aliases, unsupported wire refinements and missing environments fail before helper execution. There is no second product protocol or `sys.path` injection.

Headless discovery supports macOS/Linux installations and rejects ambiguous candidates. Native graphical runs require the verified standalone full client explicitly: Steam launch approval is never automated. Configure executable paths in ignored `.mise.local.toml`, or pass `--engine` to an individual engine/capture command:

```toml
[env]
FACTORIO = "/absolute/path/to/Factorio.app/Contents/MacOS/factorio"
FACTORIO_NATIVE = "/absolute/path/to/standalone/factorio.app/Contents/MacOS/factorio"
```

Explicit dependency provisioning downloads missing pins using existing local Mod Portal credentials. Alternatively use `mise run dependencies-provision -- <mod> --from /absolute/archive-directory`, containing exact `<name>_<version>.zip` files. Local selection never falls back to the network; already-valid cached inputs are reused, while damaged cache entries fail rather than being silently repaired. Per-archive ownership locks and atomic installation prevent partial files from becoming valid inputs. The supplied-archive path was exercised from an empty disposable cache with real FactorioTest/flib ZIPs, followed by a real Docker base suite; `.factorio-test/dependency-provision-evidence.json` records the source and observed inputs. Normal game saves, configuration, and installed mods are untouched.

## Commands

- `mise run verify`: verify the whole workspace. `mise run verify -- <mod>` selects one product; `--all` remains an explicit workspace selector. Coverage includes source quality, whitespace, metadata/locale audit, project-aware Lua checks, toolkit/model tests, packaging, and all declared real-engine [FactorioTest](https://github.com/GlassBricks/FactorioTest) profiles. Offline-only projects must explicitly declare that narrower contract.
- `mise run verify -- --plan`: preview selected identities, capabilities, engine backends and phase order without checking prerequisites, sealing sources, allocating runs or launching processes. Accepts a mod selector or `--all`, but not both. `status: planned` is not verification evidence.
- `mise run test -- <mod> --profile base` or `--profile space-age`: one declared engine profile.
- `test`, `test-ui`, `gallery`, `perf` and the read-only `resolve` command accept repeated `--companion <exact-mod-id>` options. These add to declared companions for that selection only; self, duplicate, missing, aliased and malformed targets fail before engine work. The source seal includes selected companions, and the receipt records the primary suite and actual mod set. Run each primary explicitly for coexistence; this never replaces standalone coverage or enables companions in independent `package-smoke`.
  - The first extracted-product coexistence campaign passed detector **34 base / 35 Space Age** cases and planner **104 base / 112 Space Age** cases, each as the primary, using the standalone 2.1.21 engine. Run IDs are `b54ced03-c2fa-425d-a352-2c0178ff8630`, `f0e8c6fb-7577-46be-8c62-770f40593c65`, `dd930fa2-5563-48f7-ad3b-3e7a03a76e90` and `236a2287-1a14-40b8-a1c5-a3ccb716a062`. Resolver/source-closure regressions passed separately; these are point-in-time receipts, not a substitute for final release sealing.
- `mise run test-model -- <mod>`: deterministic Lua model tests without launching Factorio. For LLL these exercise planner and producer/consumer behavior; they do not prove native GUI or real-engine behavior.
- `mise run project -- <mod> -- --help`: product-owned commands. Polytechnic exposes `generate`, `check`, `corpus`, `flags`, `progress`, `scope`, explicit `review-sources` and historical `replay`; all are offline. Its save-reader/annotation subprocesses use the same `runs`/`logs` interface as other toolkit work.
- `mise run test-ui -- <mod> --language de`: declared native assertion scenes, then close only the owned isolated window. LLL has nine planner scenes; the detector has its own warning scene, pulse frames and thumbnail capture. Both support en/de/fr/es-ES/ru/zh-CN. Locale names are exact; there is no `es` or `native-preview` alias.
- `mise run gallery -- <mod> --language en`: declared presentation scenes with Extreme graphics. LLL currently produces five 1920 × 1080 candidates at 125% UI scale and selects planner/source-survey images for its Portal gallery.
  - The native window must actually fit the display's usable desktop area, including window decorations and the Dock. LLL native assertions require 1600 × 1000; gallery requires 1920 × 1080. A smaller/clamped viewport fails with expected and observed geometry rather than silently resizing assets, changing desktop settings, or accepting stale captures.
- `mise run setup`: prepare the shared tools without starting a game.
- `mise run lint -- <mod>` and `mise run typecheck -- <mod>`: Factorio-aware Lua checks. Use the shared `format`/`format-check` commands above for authored-source formatting.
- `mise run package -- <mod>`: build and verify a deterministic ZIP in that mod's isolated output tree, with exact member hashes.
- `mise run package-smoke -- <mod>`: load the exact ZIP in its declared engine profiles with FactorioTest and test companions absent.
- `mise run checkpoint -- "Describe the change"`: verify every mod and commit the whole worktree locally; never push.
- `mise run vac -- "Describe the change"`: the explicit source-publishing counterpart described below; never a Mod Portal release.
- `mise run release-version -- <mod> <version> "<single-line note>"`: set a newer local version and prepend the authored changelog note. Does not commit or publish.
- `mise run release-prepare -- <mod> --language en`: verify one product, reuse its exact ZIP for independent smoke and declared native/gallery scenes, and freeze the evidence without publishing. Use `--engine` for an explicit standalone graphical executable.
- `mise run release-status -- <mod>`: read live Portal metadata and compare the prepared bundle and durable publication journals.
- `mise run release-publish -- <mod> <version>`: **publish** that exact prepared version, replace any declared gallery selection, and synchronize prepared listing copy.
- `mise run gallery-publish -- <mod> <version>`: **publish only the declared gallery**, without uploading a release ZIP or changing listing copy.
- `mise run listing-publish -- <mod> <version>`: **publish only listing copy**, without uploading a ZIP or changing the gallery.

## Offline fleet overview

`mise run mods` discovers products through the canonical resolver and returns a schema-validated snapshot. Each row contains local identity/capabilities, current source hash, the latest readable registered aggregate verification and its completed phases/profile counts, prepared-release state, blockers and executable next-command arrays. A newer failed aggregate supersedes an older success; ordinary helper commands do not supersede verification. `freshness: current` describes source identity, not success: also inspect the recorded status. The overview does not rerun checks or certify unperformed native, upgrade or multiplayer coverage.

Missing registered evidence is not green. Corrupt history makes freshness `unknown`, names the unreadable records and preserves the latest readable receipt without pretending it is necessarily the latest attempt. Historical unregistered directories remain counted as partial discovery. Unsealed success stays `finalizing`; source changes produce `stale`, and source drift during observation fails the readback.

Prepared state is `absent`, `unusable` or `ready`. `ready` uses the same full source/archive/capture/coverage qualification as publication, not mere manifest existence; stale and damaged bundles are unusable with a diagnostic. `mods` never provisions inputs, allocates runs, starts games, reads Portal credentials or contacts the Portal. Portal state remains explicitly `unknown`, with an exact selected-mod `release-status` command for an intentional refresh. The online release status shares this local prepared-state reader and reports Portal `differences` separately at the top level (`null` when no usable bundle exists).

## Workspace checkpoints

`checkpoint` and `vac` are canonical Effect CLI commands, not per-mod tasks. They discover and verify every workspace mod before staging **all tracked and non-ignored untracked changes**. Neither accepts a mod selector. One ownership lock serializes checkpoint operations.

`mise run checkpoint -- --plan` and `mise run vac -- --plan` need no message and cannot stage, commit or push. Their readback states the intended commit policy (`local` versus `push`), not a publication result. Execution still requires a nonblank explicit message. Both commands print the complete aggregate verification summary, including failed run IDs, before the transaction result or failure.

Formatting remains an explicit `mise run format -- --all` operation; verification and checkpointing never hide source mutations behind a check. These commands borrow Shivai's workspace gate and plan-before-execution ergonomics without its WIP/advisory-green mode, duplicate aliases or deployment machinery.

Verification uses a private Git index. Failed verification, source/HEAD drift, a branch switch, or changed real staging stops before checkpoint staging/commit; concurrent user staging is not restored over. A changed tree is committed with the literal supplied message. A hook-altered commit is retained locally but not pushed. An unchanged worktree creates no commit, leaves staging intact and does not push.

`checkpoint` never invokes a push. `vac` requires explicit source-publication authority and pushes the exact verified commit to the selected `origin` branch, without force or rewriting tracking configuration. Its structured `publication` field distinguishes confirmed, unconfirmed, detached, not-requested and not-needed outcomes. A local checkpoint can succeed while publication is unconfirmed; do not treat command exit zero alone as remote confirmation. There is no automatic retry or rollback.

The disposable-Git regression suite exercises local-only operation, a local bare remote, failed checks, untracked whitespace, source/index/branch drift, hook mutation and unchanged-tree staging preservation. It never commits or pushes this real checkout.

## Normal-profile mods

The `mod-status`, `mod-load`, `mod-unload` and `mod-restore` commands share the canonical Effect CLI and typed local installer. They accept packaged mod ZIPs independently of workspace projects, never invoke Factorio, download mods or modify a save. The macOS profile default is `~/Library/Application Support/factorio`; use `--profile` for another write-data directory.

Run these tasks from this repository:

```sh
mise run mod-status -- location-location-location
mise run mod-load -- /absolute/path/to/mod.zip --save "current-save.zip"
mise run mod-unload -- location-location-location --save "current-save.zip"
mise run mod-restore -- /absolute/path/to/receipt.json
```

The save argument must be an existing ZIP in the selected profile's `saves` directory: either its exact relative filename or its absolute path. Resolve the current save from the latest game log and save timestamps; do not hard-code a historical filename.

For a read-only preview or another profile, invoke the same command directly:

```sh
mise run mod-load -- /absolute/path/to/mod.zip --save "current-save.zip" --dry-run
mise run mod-status -- location-location-location --profile /absolute/write-data
```

- **Save and quit first.** An open profile `.lock` blocks mutation. The tool never closes the game or clears a stale operation lock automatically.
- **Load** validates the ZIP and derives its ID/version from `info.json`, backs up every installed version of that ID, installs exactly the chosen archive, and enables its entry. Older versions are removed from the live mods directory so they cannot win version selection.
- **Unload** disables only the requested entry, retaining the installed archives. Removing a mod while loading and subsequently saving a game can discard its entities or persistent state; the tool does not load or resave anything.
- Every change retains a checksum-verified copy of the selected save, previous mod archives, and original mod list under `mod-backups/local-mods/`. The JSON receipt gives exact identities, checksums, paths, before/after state, and `restore_argv`.
- **Restore** checks the current target against that receipt before restoring its previous files and entry. It preserves unrelated mod-list edits made afterward and refuses changed target files or damaged backups.
- Restoring mod files **does not undo a save migration**. For a downgrade, use the pre-change save backup when necessary; no save is automatically overwritten or rolled back.
- Save files, `mod-settings.dat`, and unrelated mods remain untouched. A same-build load is a no-op. Preview does not create backups or change the profile.
- Unpacked/symlinked target mods and conflicting explicit version fields are rejected rather than silently moving source checkouts or overriding pins. Dependencies remain the caller's responsibility; the loader never enables or installs additional mods implicitly.
- Archive inspection is bounded to 256 MiB compressed, 512 MiB expanded, 10,000 members and 1 MiB for `info.json`. It verifies the complete CRC inventory and exact checksum before activation; an out-of-policy archive fails explicitly rather than skipping checks.
- Mod lists must be valid UTF-8 JSON, and mod-list/backup paths cannot redirect through symlinks. Failed or interrupted mutations preserve their observed outcome in the receipt; they are not automatically replayed.

Activation is profile-wide, not per-save. After restarting Factorio, load with the installed/current mods rather than synchronizing back to the save's older mod versions. The save records the new mod set only when the player saves it.

`mise exec -- bun test tools/local-mod.test.mjs` exercises real archive/filesystem operations and the actual CLI in disposable profiles: load/unload/restore, executable receipt commands, target drift, damaged backups, active locks, preview, UTF-8/symlink refusal and save/settings preservation. These tests do not launch Factorio.

## Release flow

`info.json` owns the mod ID, version, title, summary, and homepage. `MOD_PORTAL.md` owns the long description, category, MIT license selection, and source URL. There is no second release configuration or environment-variable override for the target mod. Historical evidence in `RELEASE_AUDIT.md` remains historical; it is not relabeled as evidence for a new release.

For a new release:

1. Run `release-version` with the chosen newer version and a real, single-line changelog note. It updates `info.json` and prepends a valid native changelog section; existing history is retained. Review/add any further release notes before preparation. Factorio versions have three components, each 0–65535; leading-zero aliases and non-increasing versions are rejected.
2. Run `mise run release-prepare -- <mod> --language en` on the final source. Preparation runs verification, declared native assertions, independent packaged smoke, then declared gallery captures. Every phase consumes the one ZIP produced by verification; nothing rebuilds it afterward. Once the target/locale inputs are resolved, the prior candidate is invalidated before prerequisite checks. Invalidated candidates are preserved under the mod's release history rather than reused after failure.
3. Inspect `mise run release-status -- <mod>` and `.factorio-test/projects/<mod>/releases/<version>/`. `manifest.json` embeds the validated aggregate, engine, native/gallery and smoke receipts. The bundle retains the exact ZIP and every declared native/gallery capture, not only the public selection.
4. When publication of that exact product/version and gallery/listing scope is authorized, run `mise run release-publish -- <mod> <version>`.

Preparation seals the selected product, shared tooling/configuration, and required companion sources. Unrelated-mod edits do not invalidate that seal; selected/shared/companion changes do. A later Git commit of unchanged source remains valid, and preparation does not alter staging. Loading verifies source freshness, listing identity, ZIP/capture SHA256 and SHA1, declared profile/case coverage, observation identities, distinct run IDs, independent smoke, and exact gallery order. Frozen captures are tied to the fully decoded PNG evidence from their engine runs; loading hashes those unchanged bytes rather than decoding them again.

Each mod owns one release lock across all versions. Visual engine-backed products require declared native scenes. Explicit offline-only products retain their narrower contract: no engine/native proof is invented, and a product without a prepared gallery does not silently clear existing Portal images.

### Credentials and publishing boundaries

Create scoped keys through the [Factorio profile](https://factorio.com/profile) and supply them outside the repository:

- `MOD_UPLOAD_API_KEY`: `ModPortal: Upload Mods`, required by `release-publish`.
- `MOD_EDIT_API_KEY`: `ModPortal: Edit Mods`, required by all three publishing tasks.

Do not check in keys or place them in listing copy. Publishing does not reuse the game's download credentials. Missing keys or malformed authorization headers stop before any mutation. API keys go only to the official authenticated endpoints, never to delegated upload URLs; requests reject redirects, and errors/receipts omit raw response text and signed URLs. `release-status` needs no key.

The publisher uses the official [release upload](https://wiki.factorio.com/Mod_upload_API), [images](https://wiki.factorio.com/Mod_images_API), and [listing details](https://wiki.factorio.com/Mod_details_API) APIs. It acknowledges the ZIP upload and checks its public SHA1 before proceeding, reuses selected images already present by SHA1, uploads only missing selected PNGs and checks their returned IDs, sets the exact displayed image order, then synchronizes title, summary, description, category, license, homepage, and source URL. It leaves unrelated fields such as tags alone. Final public readback must match the requested release, ordered gallery IDs, and listing fields.

Operational metadata reads use a unique readback query on the same canonical `/api/mods/<name>/full` endpoint. The Portal CDN caches its ordinary URL for 900 seconds and ignores request `Cache-Control: no-cache`; a cached response must not decide whether a just-uploaded release exists. This is one fresh-read path, not a retry or alternate-endpoint fallback.

The gallery belongs to the mod listing, not an individual release. A requested gallery operation **replaces the entire displayed gallery** with the mod's declared ordered selection. LLL currently selects full planner, then source survey. Retained images are not uploaded again; newly uploaded images may already appear before final ordering. Standalone gallery/listing tasks require the latest public version **and ZIP SHA1/name** to match the prepared product, not merely its version string. They can finish a partial rollout without uploading another ZIP.

### Partial publication and recovery

These APIs are not one transaction. The publisher never retries automatically or pretends to roll back an uploaded ZIP. Atomic local journals live at `.factorio-test/projects/<mod>/publications/<version>/<run-id>.json`, outside replaceable preparation bundles. Each records the exact target/source, prior image IDs, and each attempted/confirmed mutation before proceeding. Interruption records a stopped, potentially uncertain outcome. An API acknowledgement is not the same as matching final public readback.

After a stopped run, use `release-status -- <mod>` and inspect its journal. Do **not** blindly repeat a ZIP upload. A previous release-upload attempt, whether acknowledged or uncertain, blocks automatic resubmission through a new full publish. Once the public release/version/SHA1 match, explicitly authorize `gallery-publish` and/or `listing-publish` for unfinished listing work. A missing listing is reported explicitly; this workflow never creates one automatically. Keep stopped journals while investigating; inspect the ownership record before recovering a stale per-mod release lock.

Use a local desktop with graphical Factorio for preparation. A CI rollout needs Factorio, Space Age, and a working graphical display; a self-hosted desktop runner can run the same mise tasks. `vac` remains a separate source commit/push command and never publishes to the Mod Portal.

## Engine backends

Headless `test`, `package-smoke`, `verify` and release/checkpoint verification accept `--backend native|docker`; the default remains `native`. Docker is an explicit selection, never a failure fallback. Graphical tests and assets remain native standalone Factorio on Extreme.

Provision Docker inputs explicitly, then run ordinary commands without runtime downloads:

```sh
mise run engine-provision
# Alternatively supply both previously downloaded, checksum-verified archives:
mise run engine-provision -- --factorio-archive <headless.tar.xz> --bun-archive <bun-linux-aarch64.zip>
mise run test -- location-location-location --backend docker --profile base
mise run test -- location-location-location --backend docker --profile space-age
mise run package-smoke -- location-location-location --backend docker
```

Provisioning pins Factorio 2.1.21 build 87673 and Bun 1.4.2 Linux ARM64 archives, inventories every extracted file, and pulls Debian image `sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f`. Current Docker support is **Linux ARM64 only**, using a local Unix-socket daemon; remote daemons, graphical Docker and native-executable overrides are rejected. The archive-input branch was exercised with verified local archives; it still explicitly pulls the pinned image. Missing or altered runtime inputs fail rather than provisioning during a test. Mod archives use explicit `dependencies-provision`; API/Lua/Python inputs use explicit `setup`, as described above.

Each owned container runs non-root with a read-only root, no network/ports, all capabilities dropped, no-new-privileges, 2 CPUs, 1 GiB memory, 64 PIDs and 64 MiB temporary storage. Only that run directory is writable; the engine and Bun/framework inputs are read-only. Neither the player's profile nor Docker socket is mounted. The supervisor drains output and records actual exit/OOM state **before** removing its exact owned container; ambiguous mutations are not retried. Readback distinguishes this last recorded inspection from a fresh daemon query.

Production proof includes base/Space Age suites, exact-ZIP smoke without FactorioTest, native parity, two live readers, graceful stop, deadline failure, cancellation and actual OOM (exit 137). `.factorio-test/docker-backend-evidence.json` and `.factorio-test/docker-supervisor-smoke-evidence.json` retain source/run identities and final log/removal readbacks. `.factorio-test/docker-isolation-evidence.json` additionally records actual mounts/security settings and kernel `cpu.max`, `memory.max` and `pids.max`, rather than treating requested configuration as observed enforcement. These are correctness/isolation results, not a paired performance claim.

## Test profiles and evidence

Every invocation owns a fresh directory under `.factorio-test/projects/<mod>/runs/<run-id>/`, with its mods, config, settings, observations, results, captures and diagnostic logs. Commands print exact live-log reader arguments. Headless suites retain framework JSON; native suites retain and validate actual framework PASS/FAIL records, since CLI 3.6 emits structured test events only headlessly. `verification.json` records the selected source, exact ZIP, engine identity, observations and complete expected case accounting.

Profile preparation accepts the canonical checksum-pinned archive request, not a fabricated build receipt. It inspects the actual ZIP for product identity and dependency constraints, then verifies staged bytes and the loaded mod closure. A frozen ZIP does not acquire invented Python/compression provenance. Wrong product/version, changed bytes and dependencies incompatible with the selected engine fail; checkout metadata cannot override the archive's declared dependency floor. Build and release receipts still retain their full, separately verified provenance.

The live stream retains separate stdout, stderr, engine-file and lifecycle channels. FactorioTest's preliminary save creation and actual game produce separate engine-log files: the collector drains the old open file before switching and preserves split UTF-8. In-place rewrites create explicit content revisions; a `game-log-file` event's `replaces` field identifies the superseded observation. File identity is opaque, not an inode string for clients to parse. Bounded prefix/tail witnesses detect ordinary rewrites while polling; final SHA-256 verification checks all consumed bytes and records a new revision when necessary. Observed revisions remain available, and final snapshots are verified; transient contents between polls cannot be reconstructed. Missing/empty logs, skipped physical rotations or an unstable final snapshot fail diagnostic collection.

Final collection waits for cleanup of the whole owned process group, not merely the launcher PID. This preserves Factorio's late shutdown output. Readers can follow concurrently and reconnect from the returned cursor; cancelling a reader does not stop the producer. The native smoke recorded two simultaneous readers, cancellation at cursor 10, exact reconnect parity and all 13,244 engine-file bytes—including final shutdown—across both generations. The retained receipt is `.factorio-test/live-log-smoke-evidence.json`; it records the exercised source identity rather than certifying later edits.

Read-only discovery uses registered run metadata, not arbitrary Factorio processes:

```sh
mise run runs -- --active
mise run runs -- location-location-location --limit 20
mise run runs -- location-location-location --kind verification --limit 5
mise run runs -- --workspace --limit 20
mise run runs -- --run <run-id>
mise run logs -- location-location-location --run <run-id> --follow
mise run logs -- location-location-location --run <run-id> --channel game --format text --follow
mise run logs -- location-location-location --run <run-id> --event game-log-file --cursor 0 --limit 64
```

Listing pages return `next`; pass it as `--after <run-id>` to continue. Result and diagnostic rows are bounded by `--limit`; `issueCount` reports additional diagnostics omitted from that page. `--active` includes interrupted/unknown records so lost owners are not hidden. PID presence is explicitly `pid-present-unverified`, not proof of process identity.

`--kind command|verification|engine-suite|package-smoke|benchmark|performance|studio|session` filters registered candidates before pagination. A cursor from another kind/scope is rejected; exact `--run` lookup cannot be combined with listing filters.

New runs atomically persist schema-2 `run.json` before launch. Aggregate lifecycle logs link each child immediately, including its phase and exact reader argv. Engine runs remain `finalizing` after process success until matching qualified evidence exists; passed evidence also requires a sealed diagnostic stream. The process receipt and test proof stay separate in readback.

`runs --run <run-id>` also returns structured failure diagnostics: launch failure, runner-owned deadline (phase and limit), cancellation, container OOM, abnormal signal, mod-load error, runtime Lua exception, failed assertion/test error, invalid evidence and finalization failure. Multiple causes remain visible; a cleanup error does not replace the original failure. A deadline remains failed even if orderly shutdown subsequently exits zero. Assertion readback checks the result's mod and case identities against that run's expected inventory; malformed evidence is reported, not treated as an empty successful suite.

Process receipt schema 2 retains these facts and bounded, redacted engine diagnostics after owned-process cleanup. Each current/previous file records absence or its byte count, SHA-256, up to eight multiline error excerpts (16,384 UTF-16 code units each), omitted-error count and an 8,192-code-unit tail. Files over 32 MiB, changing files and aliases fail diagnostic collection explicitly. Raw run logs remain the canonical retained stream. Matching dump/crash/desync artifact paths and sizes are collected only from the owned run directory; this does not search unrelated system crash reports or establish that a dump is valid. A `CrashHandler` marker is **suspected native crash** evidence, not a Lua exception and not a forensic OS-crash determination. FactorioTest's intentional exit marker is classified separately and still requires the existing strict success qualification.

Old process-schema-1 receipts remain untouched and unsupported by current qualified readback; discovery reports issues instead of inventing deadline/cancellation facts. Their raw retained files are still available. Diagnostic collection is enabled at the shared supervisor boundary, not inside gameplay callbacks.

Owned profiles explicitly set `enable-crash-log-uploading=false` under `[other]`; test failures must not implicitly publish logs. This is the engine's [documented configuration key](https://forums.factorio.com/viewtopic.php?p=677127), not a normal-profile change. A native benchmark incident before this setting was added logged an upload attempt; its completion was not confirmed. The incident and owned-process cleanup remain recorded rather than being hidden by a successful later run.

`logs` defaults to schema-validated JSONL envelopes containing `page`, `scanned`, `run` and `complete`; `--format text` renders timestamps, source/event identity, multiline text and the resumable cursor. Terminal control sequences are escaped only for display, never rewritten in retained evidence. `--channel` and `--event` filter views after the bounded raw scan: `--limit` counts scanned records, not matches. An empty filtered page can advance the cursor; reconnect with its `page.cursor.sequence`.

`page.complete` means the log stream is sealed and drained. Outer `complete` additionally requires a terminal run state, so `--follow` waits through post-exit test qualification. It can also finish with a failed, cancelled or interrupted producer: inspect `run.status` and `run.proof`, not the reader's exit code, for success. An interrupted unsealed stream retains `logsClosed: false` and any `partialRecord` warning; available-output completion does not turn damaged evidence into a pass.

Log protocol 2 records wall-clock capture milliseconds, monotonic elapsed milliseconds and optional structured event/tick/file metadata. File metadata names the opened path and stable generation identity; raw text resembling JSON does not become a structured event. Sequence is collector ingestion order, not total causal order across pipes. Old protocol-1 evidence stays untouched and is rejected as unsupported rather than receiving invented capture times; registered old runs report issues in discovery.

The qualified-view smoke exercised a real base suite, two filtered followers, reader-only cancellation at cursor 1 and exact resumed replay of both engine-file generation events. Its final cursor was 387 and completion reported passed test proof, not merely process exit. `.factorio-test/log-view-smoke-evidence.json` records the source identity and actual human readback.

Older directories without registered metadata remain untouched and count as `unregisteredDirectories`; listing coverage is `partial`, not fabricated historical state. Exact lookup rejects foreign/mismatched/aliased records. Run discovery does not launch games, provision dependencies, contact the Portal, or change the normal profile.

Graphics profiles force Factorio's maximum `extreme` preset, independently of the player's normal graphics settings. Keep screenshot and GIF work inside these isolated profiles; do not alter the normal game's settings for previews.

Gallery candidates are written below that run's `script-output/gallery/`. LLL's five scenes are source survey, full planner, product picker, private marker placement and recipe alternatives. Its `dev.config.ts` owns the public selection and order: planner first, source survey second. Release preparation freezes all declared captures and marks only the selected images for publication; loading rejects missing, extra, changed or reordered evidence.

Rerunning a gallery creates a new run rather than overwriting another session's captures. `tests/native_gallery.lua` owns the deterministic scenes and composition. `gallery-scenes.jsonl` records actual surface, resolution, UI scale, world zoom and window location. The runner checks locale, Extreme preset, dimensions, framework success, screenshot-flush completion and full PNG decoding before writing successful capture evidence.

The gallery is a separate `portal-gallery` suite, also tagged `native-ui`: headless runs exclude it, and `test-ui` keeps each product's native assertions separate. Product test fixtures are not registered without FactorioTest. The separate generated verification observer records package identity even in framework-free runs; its completed state survives loading so it does not re-register a retired tick handler. Normal saves, configuration, and installed mods are untouched. Screenshots and manifests remain ignored and are excluded from release packages; the task never uploads them.

The reversed-underground scene also captures a 3.6-second pulse in `script-output/underground-pulse/`: 36 native 710 × 200 antialiased PNGs at zoom 4 and six-tick intervals, premultiplied RGBA samples in `samples.json`, and a blue runtime-tint probe. `script-output/underground-hover/` records native belt-hover and steady-mode evidence. GIF exports must not enlarge the frames; render at the required delivery resolution instead. Inspect the probe to catch source-yellow tint regressions; the normal warning scene uses the tuned orange. These are preview evidence, not shipped sprite assets.

1920 × 1080 (16:9) is the chosen gallery presentation size, not an official Portal requirement. It gives readable text at 125% UI scale without upscaling or desktop chrome. The [official image-upload API](https://wiki.factorio.com/Mod_images_API) does not specify a preferred pixel size. Keep the separate `thumbnail.png` unchanged.

Interrupted ownership is not permission to kill another session. Inspect the recorded run and process identity before any manual stale-lock recovery.

LLL's [control.lua](../mods/location-location-location/control.lua) registers its [planner](../mods/location-location-location/tests/planner.lua), [native UI](../mods/location-location-location/tests/native_preview.lua) and [gallery](../mods/location-location-location/tests/native_gallery.lua) suites. The detector's [control.lua](../mods/reversed-underground-belt-detector/control.lua) independently registers [behavior](../mods/reversed-underground-belt-detector/tests/undergrounds.lua), [native rendering](../mods/reversed-underground-belt-detector/tests/native_preview.lua) and [gallery](../mods/reversed-underground-belt-detector/tests/native_gallery.lua) suites. Regression hooks are scoped to their suite. The `native-ui` tag excludes graphics-only assertions from headless runs; graphics profiles select either native assertions or Portal gallery fixtures. No fixture code is injected into the mod.

Planner fixtures clear all chart tags on their dedicated test surface, including manual markers left by failed assertions. Cross-surface selection regressions perform the actual source, marker, or machine selection and verify that saved plans stay unchanged; they do not depend on private selection-mode names.

Bun applies the checked-in CLI 3.6.0 patch that increases the hard-coded headless startup deadline from 10 to 120 seconds. A separate 60-second output watchdog still catches a stalled process. The same patch resolves the installed FMTK entry point and invokes it with the current interpreter, rather than `npx`: the toolkit's Bun execution does not need ambient Node/npm or a package-download subprocess. Unknown framework tool names fail explicitly.

Headless tests exercise game state and GUI handlers. Check UI changes with the native suite as well; detailed scenario coverage and proof boundaries belong in [RELEASE_AUDIT.md](../mods/location-location-location/RELEASE_AUDIT.md).

### Private programmatic control

`tools/rcon.ts` provides a scoped Bun/Effect connection restricted to `127.0.0.1`. Effect Schema validates options, commands and supported frame metadata. It permits one in-flight command, caps command bytes at 65,536 and response-frame length at 1 MiB, and rejects malformed framing, foreign IDs and unexpected responses. A timeout, cancellation or disconnect makes the connection terminal. A sent mutation with no valid response has an **unknown outcome**, not a safe-to-retry failure; neither reconnect nor mutation replay is automatic. Commands attempted after termination are reported as unsent.

The 2.1.21 standalone-engine probe exercised rejected authentication, UTF-8 structured JSON, empty replies and a 20,001-character reply. A private headless host bound both game and RCON sockets to loopback; a separate Extreme graphical client joined with byte-identical mod inputs and its own writable profile. Graphical `--host` was rejected for this design because its game socket ignored the requested `--bind` restriction. The graphical client's multiplayer disconnect required more than the generic three-second grace; the probe used a bounded ten-second grace and required clean shutdown. This is transport/topology evidence, not multi-client determinism or tuner-rendering acceptance. `.factorio-test/native-client-rcon-evidence.json` records the exact source, package, engine and process identities.

The saved player's display metadata can initially be stale after joining. A bounded probe observed 3840 × 2160 / 200%, then the actual 1600 × 1000 / 100% 63 ticks later. Studio readiness now waits for the declared viewport, scale and locale as well as scene readiness. Every capture rechecks them, verifies the actual drawable and Extreme preset in the client log, waits for the client screenshot-flush marker, and fully decodes the PNG. A changed or clamped viewport fails rather than weakening the contract.

Private RCON sessions verify `script.active_mods` directly, without an observer mod whose completed marker cannot be replayed after loading a save. The ordinary test observer persists its finished state and reconstructs its dynamic event registration on load. Save completion uses a unique, non-overwritten owned destination and correlated save-start/save-finished log records, then hashes the resulting archive. The live cursor includes published records beyond the segment-granular progress watermark; an RCON acknowledgement alone is not completion. Raw engine logs contain launch arguments, so private profiles are owner-only and public diagnostic streams redact the password.

`withEngineSession` requires an explicit evidence kind and runs orchestration beside a native engine in the same network namespace. It rejects host-side control of a network-isolated Docker engine; there is no network-mode fallback. `evaluate` accepts an optional schema-validated mod scope for Factorio's native `/sc __mod-id__` console syntax. This permits external inspection of saved mod state without a production remote testing interface. Factorio rejects `require` outside control-script parsing; for GUI qualification, use registered native handlers and real GUI elements rather than loading another copy of a runtime module.

Studio processes and general private-engine `session` runs expose their live/terminal process state through the common `runs` and `logs` commands. Their proof field is `not-applicable`: a clean session exit is not package-smoke or behavioral qualification. Only actual engine-suite, package-smoke and benchmark runs consume those dedicated typed receipts; a session must not be registered as one of those kinds merely because it launches Factorio.

An isolated 2.1.21 campaign exercised detector-alone, LLL-alone and combined exact ZIPs in **both base and Space Age**: 28 fresh processes and 22 correlated save/reload transitions. It saved 202 queued mouths before detection, then a genuinely partial validation ring with 180 of 200 warnings remaining, and compared persisted cursor/history/render identities after fresh-process loads. Detection produced 200 warnings/500 renders; correction and destruction left zero owned warnings/renders/alerts while preserving a foreign circle, chart tag and same-icon alert. LLL's real GUI handlers created, placed, edited, applied and confirmed deletion of a plan across disk loads. `.factorio-test/package-serialization-evidence.json` records the exact ZIPs, source identities, saves and archived driver hash. No FactorioTest, observer companion or source-mod directory was enabled.

For deterministic transition qualification, `game.tick_paused=true` and `game.ticks_to_run=N` were observed to advance exactly N updates, with read-only completion polling. Preserve this distinction: paused stepping is serialization/behavior evidence, not a throughput measurement, actual pointer hit-testing or multiplayer determinism proof. Native empty Lua tables encode as `{}`, not JSON `[]`; fixture wire contracts explicitly omit empty sequences and validate their counts instead of silently accepting malformed arrays.

### Parameter studios

```sh
mise run studio -- launch reversed-underground-belt-detector warnings --minutes 30
mise run studio -- inspect reversed-underground-belt-detector <session-id>
mise run studio -- export reversed-underground-belt-detector <session-id> candidate --scope preview
mise run studio -- set reversed-underground-belt-detector <session-id> --revision <current-revision> --preset <exported-json>
mise run studio -- capture reversed-underground-belt-detector <session-id>
mise run studio -- export reversed-underground-belt-detector <session-id> chosen --scope source
mise run studio -- discard reversed-underground-belt-detector <session-id> --revision <current-revision>
mise run studio -- promote reversed-underground-belt-detector warnings <source-preset-json>
mise run studio -- promote reversed-underground-belt-detector warnings <source-preset-json> --apply
mise run studio -- verify reversed-underground-belt-detector warnings
```

Launch and verification require the explicit standalone native executable (`FACTORIO_NATIVE` or `--engine`). The owner command stays running; independent commands operate through the private loopback session. Read the server/client logs using the exact reader commands printed at launch. Closing a log reader does not stop the studio. Profiles, captures, named presets and connection metadata remain ignored; the owner removes connection credentials at shutdown. Completed inspection is explicitly last-recorded, not live.

The 620-pixel native panel shows baseline/candidate values. Closing the panel preserves the preview; `panel --state open|close` controls it independently. `reset` restores canonical parameters, `undo` reverses the previous parameter/state change, `stop-preview` restores only touched product objects, and `discard` requests orderly session shutdown. Mutating commands require the current revision; a stale revision fails rather than overwriting concurrent work. Reset changes parameters, not destroyed fixture entities. Capture temporarily locks parameter changes.

Product-owned `dev/tuners/<name>/descriptor.ts`, `adapter.lua` and `verify.ts` reuse shared control, orchestration and contract code. The detector's shadow renderer is explicitly **proxy evidence**, not a product setting or production-performance proof. Preview-only visibility/span-cap experiments cannot silently enter source presets. Source exports require those controls to be back at their baseline; source promotion enforces mouth/span hierarchy and the descriptor's units, ranges and increments.

Pinned [luaparse 0.3.1](https://github.com/fstirlitz/luaparse/tree/v0.3.1) and `@types/luaparse` 0.2.13 are MIT-licensed. The supported source subset is one directly initialized local literal table, deferred methods outside bound fields, and a return of that table. Executable module-level initialization, ambiguous/computed keys and nonliteral bound values fail closed; this does not emulate Lua or Factorio prototypes. Promotion edits only AST-selected numeric literals, preserves unrelated text and file permissions, rechecks the source seal under the ownership lock, and atomically replaces the canonical configuration. The default command only previews; `--apply` is deliberate. Export and discard before promotion, then restart and verify the actual product without the tuner.

`studio verify` runs the owning mod's finite behavioral qualification and writes `studio-verification.json` only after owned processes stop and source identity is rechecked. It covers the declared scene, captures, revision conflicts, restoration, real save/reload, invalidated entities and foreign-object preservation. `defineStudioVerification`, `withStudioReload` and the private engine-session helpers are product-verifier APIs; they are not shipped runtime interfaces. This qualification is distinct from ordinary gameplay suites and final tuner-free package/native acceptance.

### Underground regression and performance checks

The real-engine underground suite covers cardinal directions, native tier/reach boundaries (including turbo belts in Space Age), adjacent mouths, unpaired/mixed-tier/foreign-force negatives, construction/removal/rotation/relinking, native cloning and ghost revival, entity death, deleted surfaces, render-object repair, repeated configuration surveys, alert ownership, per-player presentation, and a full pulse cycle.

Scheduling regressions exercise three offsets through a 60-tick cycle, a shrinking queue, empty-to-active restart, and 2,000 reversed connections above the normal one-second capacity. They assert bounded per-tick repair progress, eventual completion without starvation, and prompt event-driven corrections while background repairs remain outstanding. Partial-progress persistence uses FactorioTest's `after_reload_mods`, which calls `game.reload_mods`: Factorio describes this as save/load behavior from the mods' perspective. `after_reload_script` reloads the scenario instead and is not a substitute for testing our mod's reload behavior. This is not a disk-save round trip or a two-client multiplayer desync test.

For repeatable performance comparisons, use an isolated base-game profile with 1,000 connected reversed pairs, one player, charted terrain, and the pulsing overlay. Warm up for 180 ticks, measure 600 actual simulation ticks with alerts off, enable alerts, warm up for another 180 ticks, and measure another 600 ticks. Record engine/dependency versions and source/archive hashes. Compare a pinned baseline and candidate in independent runs, including a later baseline to check drift. Measure both the complete simulation window and the sum of detector callbacks on each tick; do not add maxima from different ticks. Repeat with per-callback profiling/logging disabled to assess measurement overhead. Keep fixture mods, private configs, raw logs, and result receipts under ignored `.factorio-test/`, never in the normal profile or release ZIP.

The validation limit counts scheduled mouth entries, not every native API call: processing an entry also examines its current/previous partner, with duplicate pair checks removed within each batch. The population credit carries recent high-water counts so deleting warnings cannot starve the remaining queue. Rendering pulses and the native alert batch remain population-sized; alert renewal is offset from the pulse. Native alert-query experiments must measure total simulation cost as well as tick peaks: per-mouth queries and per-tick full snapshots were both more expensive than retaining the once-per-second native batch.

## Fixed-save performance measurements

```sh
mise run perf -- reversed-underground-belt-detector warnings-0
mise run perf -- reversed-underground-belt-detector warnings-1000
mise run perf -- reversed-underground-belt-detector warnings-1000 --diagnostics ticks
mise run perf -- reversed-underground-belt-detector warnings-burst-1000 --diagnostics ticks
mise run perf -- reversed-underground-belt-detector warnings-audience-1000 --diagnostics ticks
mise run perf -- reversed-underground-belt-detector warnings-1000 --budget .factorio-test/warnings-1000-budget.json
mise run perf-compare -- reversed-underground-belt-detector <baseline-run-id> <candidate-run-id>
```

The product's `development.performance` points to an Effect-Schema-validated scenario file (configuration schema 2). Each scenario names a checksum-pinned save, independent observation script, expected workload counts, optional checksum-pinned activity and ordered checkpoint deadlines, profile/locale, measured ticks, independent process count and optional calibrated budget. The detector owns the 0, 100, 500 and 1,000-pair, burst, audience and mode scenarios; LLL no longer declares detector performance fixtures. The new saves derive explicitly from frozen 1.1.8 geometry, using only the detector's runtime closure, owner-scoped setting writes, 120 observed settling updates and correlated save completion. Removing LLL removes its owned control circle, so this distinct standalone workload explicitly creates one neutral circle; it does not claim old-save preservation. Both chart tags remain. `.factorio-test/performance-fixture-solo-evidence.json` records preparation identities; `dev/performance/scenarios.json` owns the final checksums. Development fixtures are excluded from release ZIPs.

Each sample uses a fresh owned process and copied save through the common native/Docker supervisor. Steady-state primary timings have neither FactorioTest nor the private harness enabled. Activity scenarios run the identical public-API driver in both lanes, with observation enabled only in the separate correctness lane. Their timing includes driver work; compare against the same driver, not a product-only steady-state measurement. The burst creates 1,000 reversed pairs at update 120 and removes its 4,000 entities at update 600, using raised native construction/destruction events. Checkpoints require complete warnings and cleanup by updates 122 and 602: these establish two-update upper bounds, not exact first-completion latency. Before/after and checkpoint controls check actual pair reciprocity/direction/span, warning-render counts/visibility flags, effective overlay/alert settings and preserved unrelated objects. Saved-player count and connected-player count are distinct: these headless fixtures have one saved pulsing player and **no connected client**. Visible-object flags are not native-renderer or multiplayer proof. Control/primary order alternates across replications. This separates observer overhead from primary timings; it does not make sequential baseline/candidate campaigns randomized trials. Native checksums must agree across identical primary processes.

`warnings-audience-1000` uses native player APIs to make 120 selection changes and change/restore force membership. Four checkpoints in separate correctness processes require the declared visible/retained render counts and selected-mouth/force counts at their stated updates; the original force's unrelated chart tags must survive even while the player belongs to another force. This is one saved player's logical audience, not mixed simultaneous viewers or a connected client. Effective alert settings are observed, not custom-alert delivery. Factorio forbids a helper mod from changing another mod's per-player settings: mode-specific saves must instead be prepared in an owned server's console using the setting owner's context, with actual save-completion proof. No private product handler or test-only runtime API is invoked.

`warnings-steady-1000`, `warnings-off-1000` and `warnings-alerts-off-1000` are separately serialized, checksum-pinned mode fixtures. Their provenance is recorded in the scenario declarations and `.factorio-test/performance-fixture-solo-evidence.json`. Primary runs contain only the product closure. Controls require actual retained/visible resource counts, including the 2,000 hidden mouth objects retained with overlays off. Different modes and saves are distinct workloads, not interchangeable baseline/candidate performance comparisons.

Receipts distinguish engine ms/update from owned-process wall milliseconds and aggregate operation elapsed time. The latter starts after input/engine resolution; it is not a complete CLI-startup measurement. `preparedWarmupTicks` describes settling before fixture serialization, not a discarded portion of the current run: every requested benchmark update, including post-load work, remains measured. Fresh processes do not flush host caches. CPU/OS/Bun/engine/backend identities, Docker limits and host load averages are retained; power/thermal state is explicitly unmeasured.

Default `--diagnostics none` collects engine summaries only. `--diagnostics ticks` asks the selected engine for bounded `all` timing output, retains the raw columns, and normalizes whole-update, script and incremental-GC nanoseconds to milliseconds. Do not add these overlapping categories. Detailed windows are limited to 5,000 ticks per process; ordinary windows allow 100,000. An earlier selected-column invocation crashed Factorio 2.1.21 while printing its first row; the runner rejected its pre-crash success-looking summary. `all` subsequently completed on idle and 1,000-pair fixtures. This is a deliberate supported configuration, not an automatic retry or silent failure fallback.

`performance` aggregates and `benchmark` children use the existing `runs`/`logs` interface. Schema-3 historical readback requalifies native output, process/container completion, observations, checkpoint deadlines, source seals, retained fixture/archive/harness hashes, exact harness file inventory, independent checksums and summary samples. Earlier experimental schema-1/2 receipts remain untouched and unsupported; their raw measurements are not upgraded into current evidence. A missing budget yields **inconclusive**, not passed. Comparisons reject changed workload/activity/checkpoints/fixture/window/instrumentation/hardware/backend classes, observer code or dependency archives, duplicate/missing independent processes and incomplete metrics. A budget names its exact baseline run; it is never recalibrated automatically, and readback recomputes the claimed assessment. Complete measurements may exit zero while inconclusive; an observed regression or blocked comparison exits nonzero. Inspect the explicit status rather than interpreting command completion as a performance pass.

Keep machine-specific calibration outside portable source defaults. `--budget <json>` explicitly supplies the same `PerformanceBudget` contract used by scenario declarations: `baseline` (a qualified local run UUID), `maximumMeanMs`, `maximumUpdateMs` and a nonempty `rationale`. It overrides the scenario's budget for that invocation and is embedded in the receipt. The file and baseline are validated before engine resolution or allocating a new run; missing history does not silently disable a budget. Baseline and candidate still must match all comparison inputs, including diagnostics mode and hardware class. A fresh checkout can measure without a budget, but cannot claim calibrated acceptance from another machine's absent history.

The one-time extraction comparison uses separately prepared **combined** fixtures, preserving the actual planner record, its valid tag and the original unrelated circle. Their proof is `.factorio-test/performance-fixture-combined-evidence.json`. Old embedded LLL versus new LLL-plus-detector intentionally changes product ownership, setting names, observer literals, saved bytes and the mod closure. Report those identities and equivalence checks explicitly; the ordinary strict `perf-compare` must not silently waive its mismatch guards. Detector-alone has no invented historical standalone baseline.

This path measures fixed-save simulation and declared activity windows. It does not yet close the broader audience, persistence, renderer, tuner, resource or whole-stack requirements in `VERIFICATION_PLAN.md`, nor calibrate acceptable burst cost. An observed range separation is not a significance test. Calibrate production budgets from representative controls and intended use; do not turn the historical baseline's timing values into universal thresholds.

### Profiling complete tooling commands

The existing verification lifecycle log records monotonic start/completion events for toolchain, quality, Lua checks, toolkit/model tests, packaging, engine suites and source sealing. Child registrations identify the actual commands. These are inclusive phase intervals inside the aggregate and process wall times; do not add overlapping intervals or mistake dispatch for completion.

Bun's built-in profilers can instrument the canonical CLI without adding production probes. After explicit setup has created `.factorio-test/`, enable them with:

```sh
mise exec -- bun --cpu-prof-md --heap-prof-md --cpu-prof-dir .factorio-test --heap-prof-dir .factorio-test tools/cli.ts verify location-location-location
```

Omit those four profiler options for ordinary execution. Profiles describe the Bun orchestrator, not the native engines or Python/checker subprocesses. Keep raw profiles local: heap snapshots can contain payloads and paths. The [pinned Bun profiling interfaces](https://bun.com/docs/project/benchmarking) write an exit heap snapshot, not an allocation sample or peak RSS. Do not add overlapping retained-size categories.

Observed on Bun 1.4.2: a real 61.8-second verification profile displayed a **7.63-second self entry**, while the Bun process's own exit counters measured only **3.238 seconds of user plus system CPU** before profile export. Treat the profile as an attribution aid, not an authoritative exclusive-CPU ledger. Validate important conclusions against monotonic completed-operation timings and explicitly scoped OS CPU/memory counters. Native command accounting can include child work; an exit RSS observation is not a leak test or simultaneous process-tree peak.

The six-process campaign and separate accounting observation are preserved in `.factorio-test/tooling-performance-evidence.json`. All complete runs exercised the same declared cases and exact product ZIP. Plain and profiled wall-time ranges overlapped; neither an optimization nor zero profiler overhead was demonstrated. Temporary self-resource probes were removed. Detailed profiles remain opt-in; existing phase/process evidence remains enabled. This does not close tuner, capture, live-reader overhead or calibrated resource-budget acceptance.

## Lua tooling

FMTK 2.1.9 generates types from checksum-pinned Factorio 2.1.20 runtime and prototype API documents, even when the installed engine is newer. EmmyLua Check 0.25.1 uses those definitions. Explicit adapters account for missing dictionary keys and flib's partial style definitions and heterogeneous GUI elements; diagnostics are not globally suppressed. The type check must also reject an intentional invalid Factorio API-call probe.

Luacheck verifies data-stage and runtime globals separately. FactorioTest validates its dynamic regression DSL in the engine; the native UI suite is also type-checked.

## Source pointers

- [gui/appearance.lua](../mods/location-location-location/location_location_location/gui/appearance.lua) owns shared GUI styles and icon states. Action artwork and item/recipe tooltips are native Factorio.
- Picker category slots and their table must remain non-stretching: native table justification otherwise inserts gaps in partial rows. Keep their widths aligned with the shared background tiling.
- [planner.lua](../mods/location-location-location/location_location_location/planner.lua) owns private multi-recipe drafts, input/output geometry, one-time single-recipe save migration, and saved recipe tags.
- [undergrounds.lua](../mods/reversed-underground-belt-detector/reversed_underground_belt_detector/undergrounds.lua) owns automatic reversed-underground detection, force-scoped warnings, and local belt lifecycle checks, independently of LLL and flib.
- [settings.lua](../mods/reversed-underground-belt-detector/settings.lua) declares the detector's per-player, default-on alert toggle and pulsing/steady/off overlay preference. Its saved choices are preserved across updates; old LLL choices are not imported.
- [underground_preferences.lua](../mods/reversed-underground-belt-detector/reversed_underground_belt_detector/underground_preferences.lua) is the canonical setting-name and audience boundary. Span filters exclude only viewers hovering that connection's entrance or exit; ordinary belts, unrelated undergrounds, and teammates remain unaffected.
- The underground arrow prototype crops only the original hollow triangle from `__core__/graphics/arrows/underground-lines.png`. A normal yellow layer and its additive, color-inverted complement produce a neutral mask for runtime tint. Runtime rendering supplies tint, opacity, scale, and orientation. No extracted artwork is packaged. Input mouths alone own the interior arrows, preventing duplicated spans.
- A shared 216-tick pulse changes existing render objects' opacity every six ticks. Steady views are created only while requested and use constant opacity; off mode hides both layers. Pulse work returns before walking warnings when nobody requests pulsing. Runtime tints multiply each RGB channel by alpha, as Factorio expects.
- Belt lifecycle events deduplicate current and previous partners into a dirty queue, processed on the next tick. Background validation rotates a persistent, constant-time linked queue, with fractional population-based work credit and a hard cap of 64 scheduled mouth entries per tick. Under the normal capacity it covers active warnings within 60 ticks; above 3,840 mouths, the cycle grows rather than dropping work. Recent population peaks prevent shrinking queues from starving their tails. Intact renderings are reused; lost mouth renderings are repaired in their existing warning records so queue membership survives. Native alerts retain their efficient 1 Hz batch, staggered from the six-tick pulse; the alert-dirty flag also clears alerts when the last warning disappears.
- Exterior lookups cache a proven query point/surface and the opposing belt reference. Reuse still checks current point/surface, entity validity, force, and direction; misses query the surface again. This relies on Factorio 2.1's [transport-belt teleport restriction](https://lua-api.factorio.com/2.1.20/classes/LuaControl.html#teleport), not an assumption that arbitrary entities never move. Negative lookups are not cached.
- Selection changes update only the previous and newly hovered connection's spans. Moving between the two mouths of one pair does not refresh them again. Hovered mouth IDs live in storage so multiplayer load/join does not change branch decisions; setting/force/lifecycle refreshes rebuild the cache from current players.

This guide and the development tooling directory are excluded from release packages.
