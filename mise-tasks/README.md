# Developer guide

The main [README](../README.md) covers using the mod. This guide covers its local development workflow; [RELEASE_AUDIT.md](../RELEASE_AUDIT.md) records acceptance coverage, compatibility evidence, translation review status, and remaining human checks.

## Setup

Use Mise, a C compiler, and an installed Factorio 2.1.20 executable. Mise pins uv for the Python tooling; uv selects the local Python interpreter. The complete verification includes a Space Age profile and requires the expansion; `mise run test-base` runs only the base-game engine suite.

`mise run verify` prepares locked Bun dependencies, checksum-pinned FactorioTest 3.1.0 and flib 0.17.2, and project-local Lua tools before running the checks. Mise pins Bun 1.4.2, uv 0.12.13, Lua 5.2.4, and StyLua 2.3.1. `mise run setup` prepares tools and test dependencies without starting a game.

The runner detects normal Steam and standalone installations and resolves game data correctly on macOS and Linux. Override a different installation in ignored `.mise.local.toml`:

```toml
[env]
FACTORIO = "/absolute/path/to/Factorio.app/Contents/MacOS/factorio"
```

Downloading missing pinned mods reads existing Mod Portal credentials. Sign into the game once, or place the exact `factorio-test_3.1.0.zip` and `flib_0.17.2.zip` archives in `.factorio-test/mods/`. Normal game saves, configuration, and mods are untouched.

## Commands

- `mise run verify`: whitespace, release/locale audit, Luacheck 1.2.0, StyLua, minimum-version Factorio API types, tooling tests, and both real-engine [FactorioTest](https://github.com/GlassBricks/FactorioTest) regression profiles.
- `mise run test`: base and Space Age suites. Use `test-base` or `test-space-age` to run one profile.
- `mise run test-ui -- de`: the tagged FactorioTest native UI suite. It checks and renders nine scenes, then closes its own isolated test window. Supported languages: en/de/fr/es-ES/ru/zh-CN (`es` aliases `es-ES`). `native-preview` remains an alias.
- `mise run gallery -- en`: regenerate five native PNG candidates on Nauvis at 1920 × 1080 and 125% UI scale. Uses high-quality native artwork, hides the test runner and unrelated HUD, and closes only its isolated preview. Release preparation selects two for the Portal: full planner first, source survey second.
- `mise run setup`: prepare tools and test dependencies without starting a game.
- `mise run lint`, `format-check`, `typecheck`: individual Lua checks. `mise run format` applies StyLua with AST verification.
- `mise run package`: build a deterministic ZIP from `info.json`, compare every packaged file with source, and write its SHA256.
- `mise run package-smoke`: build and load that ZIP in both engine profiles with FactorioTest disabled.
- `mise run vac -- "Describe the change"`: verify, stage **all non-ignored changes**, commit, and push the current branch. This publishes source, not a Mod Portal release; run it only when publication is authorized.
- `mise run release-version -- 1.0.1 "Fix recipe category spacing and add repeatable gallery captures."`: set a newer local version and prepend that authored changelog note. Does not commit or publish.
- `mise run release-prepare -- en`: run verification, native UI assertions, packaged base/Space Age smoke tests, and fresh gallery captures; seal their artifacts without publishing.
- `mise run release-status`: read live Portal release/gallery metadata and compare the prepared bundle, including publication receipts.
- `mise run release-publish -- 1.0.1`: **publish** that exact prepared version, replace the displayed gallery with its two selected screenshots, and synchronize prepared listing copy.
- `mise run gallery-publish -- 1.0.1`: **publish only the gallery**, without uploading a release ZIP or changing listing copy.
- `mise run listing-publish -- 1.0.1`: **publish only listing copy**, without uploading a ZIP or changing the gallery.

## Release flow

`info.json` owns the mod ID, version, title, summary, and homepage. `MOD_PORTAL.md` owns the long description, category, MIT license selection, and source URL. There is no second release configuration or environment-variable override for the target mod. Historical evidence in `RELEASE_AUDIT.md` remains historical; it is not relabeled as evidence for a new release.

For a new release:

1. Run `release-version` with the chosen newer version and a real, single-line changelog note. It updates `info.json` and prepends a valid native changelog section; existing history is retained. Review/add any further release notes before preparation. Factorio versions have three components, each 0–65535; leading-zero aliases and non-increasing versions are rejected.
2. Run `mise run release-prepare -- en` on the final source. Preparation runs `verify`, `test-ui`, `package-smoke`, then `gallery` in sequence. Once version/locale inputs are resolved, it invalidates any prior candidate for that version before running checks; a failed verification or source-drift check cannot leave it publishable. It never uploads, commits, tags, or pushes.
3. Inspect `mise run release-status` and the frozen bundle in `.factorio-test/releases/<version>/`: the ZIP and checksum, ordered `gallery/*.png`, actual `gallery-results.json`, and `manifest.json`.
4. When publication of that exact version and two-image replacement is authorized, run `mise run release-publish -- <version>`.

Preparation uses the same private-index source snapshot as `vac`: tracked and non-ignored untracked files are included without changing staging. Source drift during preparation fails the seal. Publishing checks the current tree, canonical listing fields, and every frozen artifact's SHA256/SHA1 before any mutation. A later commit of the same tree is valid; a source change requires preparation again. Screenshots are 1920×1080 at 125% UI scale, with the requested locale and installed engine recorded. Packaged smoke profiles are isolated by version so an old cached ZIP cannot win mod selection.

### Credentials and publishing boundaries

Create scoped keys through the [Factorio profile](https://factorio.com/profile) and supply them outside the repository:

- `MOD_UPLOAD_API_KEY`: `ModPortal: Upload Mods`, required by `release-publish`.
- `MOD_EDIT_API_KEY`: `ModPortal: Edit Mods`, required by all three publishing tasks.

Do not check in keys or place them in listing copy. Publishing does not reuse the game's download credentials. Missing keys or malformed authorization headers stop before any mutation. API keys go only to the official authenticated endpoints, never to delegated upload URLs; requests reject redirects, and errors/receipts omit raw response text and signed URLs. `release-status` needs no key.

The publisher uses the official [release upload](https://wiki.factorio.com/Mod_upload_API), [images](https://wiki.factorio.com/Mod_images_API), and [listing details](https://wiki.factorio.com/Mod_details_API) APIs. It acknowledges the ZIP upload and checks its public SHA1 before proceeding, reuses selected images already present by SHA1, uploads only missing selected PNGs and checks their returned IDs, sets the exact displayed image order, then synchronizes title, summary, description, category, license, homepage, and source URL. It leaves unrelated fields such as tags alone. Final public readback must match the requested release, ordered gallery IDs, and listing fields.

Operational metadata reads use a unique readback query on the same canonical `/api/mods/<name>/full` endpoint. The Portal CDN caches its ordinary URL for 900 seconds and ignores request `Cache-Control: no-cache`; a cached response must not decide whether a just-uploaded release exists. This is one fresh-read path, not a retry or alternate-endpoint fallback.

The gallery belongs to the mod listing, not an individual release. Both `release-publish` and `gallery-publish` **replace the entire displayed gallery** with two prepared scenes: full planner, then source survey. Other displayed images are removed by the ordering operation; retained images are not uploaded again. Missing image uploads may already appear before final ordering. Standalone gallery/listing tasks require the latest public release version to match the prepared version. They are useful for finishing a partial rollout or refreshing the listing without a new ZIP.

### Partial publication and recovery

These APIs are not one transaction. The publisher never retries automatically or pretends to roll back an uploaded ZIP. Atomic local receipts (`publish-receipt.json`, `gallery-receipt.json`, `listing-receipt.json`) record the target/source and each attempted/confirmed mutation before proceeding. A network failure may have an unknown outcome; an API acknowledgement is not the same as a matching final public readback.

After a stopped run, use `release-status` and inspect the receipt. Origin metadata can still lag acknowledged writes: do **not** blindly repeat a ZIP upload. Once the public release/version/SHA1 match, explicitly use `gallery-publish` and/or `listing-publish` for the unfinished listing work. A full publish rejects an already published version or a local receipt confirming its ZIP upload; status never suggests another ZIP upload after that confirmation. Keep stopped receipts while investigating; an interrupted task's `.factorio-test/release.lock` records its PID, which must be checked before removing a stale lock.

Use a local desktop with graphical Factorio for preparation. A CI rollout needs Factorio, Space Age, and a working graphical display; a self-hosted desktop runner can run the same mise tasks. `vac` remains a separate source commit/push command and never publishes to the Mod Portal.

## Test profiles and evidence

Each profile owns its mods, settings, results, logs, screenshots, and lock under ignored `.factorio-test/profiles/<profile>/`, `.factorio-test/native/<language>/`, or `.factorio-test/gallery/<language>/`. Headless runs record `results.json` and `console.log`. Native runs also record `native-suite-results.json`, derived from FactorioTest's actual PASS/FAIL records because CLI 3.6 emits structured test events only headlessly.

Gallery candidates are written to `.factorio-test/gallery/<language>/script-output/gallery/`, in capture order: source survey, full planner, product picker, private marker placement, and recipe alternatives. All five remain available locally for review. `mise-tasks/release.mjs` owns the curated Portal selection: `02-planner.png` first, `01-source-survey.png` second. Only those two enter the frozen bundle; preparation removes obsolete generated images from its gallery directory, and loading rejects extra or reordered scenes.

Rerunning the gallery task replaces only that profile's generated captures. `tests/native_gallery.lua` owns the deterministic scene fixtures and composition; edit it when the captures need to change. `gallery-scenes.jsonl` records the actual surface, resolution, UI scale, world zoom, and window location. The runner rejects failed scenes or PNGs with the wrong dimensions, and its result manifest records the current mod ID/version and engine version.

The gallery is a separate `portal-gallery` suite, also tagged `native-ui`: headless runs exclude it, and `test-ui` keeps its existing nine-scene assertions separate. No fixture code runs without FactorioTest. Normal saves, configuration, and installed mods are untouched. Screenshots and manifests remain ignored and are excluded from release packages; the task never uploads them.

1920 × 1080 (16:9) is the chosen gallery presentation size, not an official Portal requirement. It gives readable text at 125% UI scale without upscaling or desktop chrome. The [official image-upload API](https://wiki.factorio.com/Mod_images_API) does not specify a preferred pixel size. Keep the separate `thumbnail.png` unchanged.

An interrupted profile reports its `runner.lock`; inspect the recorded PID before removing a stale lock.

[control.lua](../control.lua) registers [tests/planner.lua](../tests/planner.lua), [tests/native_preview.lua](../tests/native_preview.lua), and [tests/native_gallery.lua](../tests/native_gallery.lua) with FactorioTest. Regression hooks are scoped to their suite. The `native-ui` tag excludes graphics-only assertions from headless runs; graphics profiles select either the native assertions or the separate Portal gallery fixtures. No fixture code is injected into the mod.

Bun applies the checked-in CLI 3.6.0 patch that increases the hard-coded headless startup deadline from 10 to 120 seconds. A separate 60-second output watchdog still catches a stalled process.

Headless tests exercise game state and GUI handlers. Check UI changes with the native suite as well; detailed scenario coverage and proof boundaries belong in [RELEASE_AUDIT.md](../RELEASE_AUDIT.md).

## Lua tooling

FMTK 2.1.9 generates types from checksum-pinned Factorio 2.1.20 runtime and prototype API documents, even when the installed engine is newer. EmmyLua Check 0.25.1 uses those definitions. Explicit adapters account for missing dictionary keys and flib's partial style definitions and heterogeneous GUI elements; diagnostics are not globally suppressed. The type check must also reject an intentional invalid Factorio API-call probe.

Luacheck verifies data-stage and runtime globals separately. FactorioTest validates its dynamic regression DSL in the engine; the native UI suite is also type-checked.

## Source pointers

- [gui/appearance.lua](../location_location_location/gui/appearance.lua) owns shared GUI styles and icon states. Action artwork and item/recipe tooltips are native Factorio.
- Picker category slots and their table must remain non-stretching: native table justification otherwise inserts gaps in partial rows. Keep their widths aligned with the shared background tiling.
- [planner.lua](../location_location_location/planner.lua) owns private drafts, source geometry, and saved recipe tags.

This guide and the development tooling directory are excluded from release packages.
