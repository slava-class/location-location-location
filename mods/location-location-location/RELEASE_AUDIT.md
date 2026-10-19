# Release acceptance — 1.0.0

The release starts from `0d016aea2117c6bec70b84269fc73ad513f383ff` in `slava-class/location-location-location`; its source is captured by the release checkpoint containing this document. Runtime checks use the installed Factorio **2.1.20** on this Mac; FMTK types use the declared minimum **2.1.20** API. Version **1.0.0** was published to the Mod Portal under **arrayjam** on 3 October 2026 UTC (4 October in Melbourne). No normal-game launch or new Py run was performed.

## Automated coverage

- `tests/planner.lua`, registered by `control.lua`, contains **101 base regressions** and **8 additional Space Age checks**. It covers private survey/edit/apply/discard workflows, source-free plans, manual placement, fluid/multi-output recipes, saved-state reload and configuration changes, recipe lookup, remote view, lifecycle cleanup, and stale saves/retirement/deletion across simulated actors and forces.
- Space Age creates actual Nauvis, Vulcanus, Fulgora, Gleba, Aquilo, and an owned platform. Each runs a complete plan workflow. Platform rename, reload and destruction are checked. These tests found and fixed closest lookup on uncharted owned-platform chunks.
- `tests/data.lua` supplies FactorioTest-only probability fixtures. The regression distinguishes impossible outputs from possible outputs using Factorio 2.1's independent/shared probability fields. Normal games without FactorioTest never load the fixtures.
- `tests/native_preview.lua` is an actual **nine-test FactorioTest suite**, tagged `native-ui`. The canonical CLI selects it in graphics mode against unmodified repository source. It checks and screenshots the list, editor, pinned editor, picker, empty search, delete confirmation, retired plan, conflict notice, and source-free draft. Headless profiles explicitly skip these nine checks; regression hooks stay scoped to their own suite.
- Six locale files have **88 keys each**, with runtime argument and control-token parity, balanced rich text, and complete referenced keys. English tooltips explain private drafts, Apply, Discard, pinning, marker placement, retirement and rebound source-selection controls. Native galleries cover en/de/fr/es-ES/ru/zh-CN. Spanish uses Factorio’s actual es-ES locale (`es` remains a CLI alias); the Russian Add closest label was shortened after rendered inspection.
- Verification includes Luacheck 1.2.0 (data/runtime globals separated), StyLua 2.3.1, EmmyLua Check 0.25.1 with FMTK 2.1.9 types, and an intentional invalid Factorio API call that must be rejected. The dynamic regression DSL is linted and engine-tested; the native suite is also type-checked. The explicit dictionary/flib adapters preserve API diagnostics.
- Bun tests exercise checkpoint safety and reject invalid engine versions, missing core data, changed dependency ZIPs, wrong profile selection, unsafe process cleanup, fabricated native passes, and broken locale tokens.

## Verified results

The final `mise run verify` passed: **101 base tests**, **109 Space Age tests**, **17 Bun tooling tests**, **zero Luacheck warnings/errors**, successful StyLua and minimum-version API type checks, and six-locale parity. The nine native-only tests are intentionally skipped by each headless profile. All six native profiles separately passed **9/9** assertions and generated nine fresh screenshots each (**54 checks and 54 screenshots**).

## Repeatable evidence

Run `mise run verify`, `mise run test-ui -- <language>`, and `mise run package`.

- Headless: `.factorio-test/profiles/{base,space-age}/results.json`, `console.log`, and `factorio-current.log`.
- Native: `.factorio-test/native/<language>/native-suite-results.json`, `factorio-current.log`, and `script-output/release-ui/*.png`. Graphics results are derived from actual FactorioTest PASS/FAIL log records; CLI 3.6 does not emit structured test events in this mode.
- Package: `location-location-location_1.0.0.zip.sha256` and `.factorio-test/package-manifest.json`; every packaged byte is compared with source. Tooling, dependencies, caches, saves and screenshots are excluded.

Setup automatically prepares exact, checksum-pinned FactorioTest 3.1.0/flib 0.17.2 archives and locked Bun packages. Each profile has its own settings and lock. The checked-in Bun patch for CLI 3.6.0 allows a 120-second cold engine startup while retaining the output watchdog. Installed Mod Portal credentials are only read. Cleanup targets only the test process whose executable, mod directory and config match the owned profile.

## Remaining human acceptance

1. A real two-client multiplayer session remains unverified. Current tests establish state/force/revision behavior in one engine process, not network determinism.
2. Native speakers should review the five machine-assisted translations. Rendering/key parity is checked; linguistic certification is not claimed.
3. The maintainer has already verified Py manually. Do not revive that work without a new compatibility issue.

## Minimum and listing review

The declared minimum is now **2.1.20**, matching the installed engine used for runtime verification. The engine guard, README, metadata, EmmyLua library path, and checksum-pinned runtime/prototype API definitions all target that build. Versioned API cache directories preserve earlier definitions without reusing them for the new target.

The live listing is [Location Location Location](https://mods.factorio.com/mod/location-location-location). The public API returned **200** after publication and confirmed version **1.0.0**, the dependencies, license, owner and approved description. The signed-in listing subsequently confirmed the shorter summary and removal of the Manufacturing tag; category remains **Utilities**. API and in-game metadata may take up to 15 minutes to catch up with listing edits. `MOD_PORTAL.md` records the current listing copy separately from the archive's metadata.

The live downloaded ZIP is byte-for-byte equal to the submitted archive: **106,958 bytes**, **24 members**, valid CRCs, and every member equal to its corresponding source file at publication. It includes the final generated **144×144** cover and initial-only native changelog. SHA256: `7c42128f0e617ae696b698bd91c98a3b364472ce08b3dd744975e58146230475`; Portal SHA1: `421e806a1438d7cb36e168bb8da3f2db4100b9f6`. Workspace handoff evidence is saved in `release-handoff-1.0.0/verification.json` and `published-listing.jpg`. The in-game listing was not inspected. After upload, the Portal summary and source `info.json` description were shortened together; the published ZIP retains its original description and checksum.

At the maintainer's request, the older `location-location-location_3.3.0.zip` was moved from the normal game's `mods/` to sibling `mod-backups/`. Its checksum was preserved, and the mod list and other installed mods were unchanged. No replacement was copied into the active folder: the maintainer will install **1.0.0** through the in-game Mod Portal.
