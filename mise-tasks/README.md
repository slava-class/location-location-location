# Developer guide

The main [README](../README.md) covers using the mod. This guide covers its local development workflow; [RELEASE_AUDIT.md](../RELEASE_AUDIT.md) records acceptance coverage, compatibility evidence, translation review status, and remaining human checks.

## Setup

Use Mise, Python 3.9 or later, a C compiler, and an installed Factorio 2.1.20 executable. The complete verification includes a Space Age profile and requires the expansion; `mise run test-base` runs only the base-game engine suite.

`mise run verify` prepares locked Bun dependencies, checksum-pinned FactorioTest 3.1.0 and flib 0.17.2, and project-local Lua tools before running the checks. Mise pins Bun 1.4.2, Lua 5.2.4, and StyLua 2.3.1. `mise run setup` prepares tools and test dependencies without starting a game.

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
- `mise run setup`: prepare tools and test dependencies without starting a game.
- `mise run lint`, `format-check`, `typecheck`: individual Lua checks. `mise run format` applies StyLua with AST verification.
- `mise run package`: build a deterministic ZIP from `info.json`, compare every packaged file with source, and write its SHA256.
- `mise run package-smoke`: build and load that ZIP in both engine profiles with FactorioTest disabled.
- `mise run vac -- "Describe the change"`: verify, stage **all non-ignored changes**, commit, and push the current branch. This publishes source, not a Mod Portal release; run it only when publication is authorized.

## Test profiles and evidence

Each profile owns its mods, settings, results, logs, screenshots, and lock under ignored `.factorio-test/profiles/<profile>/` or `.factorio-test/native/<language>/`. Headless runs record `results.json` and `console.log`. Native runs also record `native-suite-results.json`, derived from FactorioTest's actual PASS/FAIL records because CLI 3.6 emits structured test events only headlessly.

An interrupted profile reports its `runner.lock`; inspect the recorded PID before removing a stale lock.

[control.lua](../control.lua) registers [tests/planner.lua](../tests/planner.lua) and [tests/native_preview.lua](../tests/native_preview.lua) with FactorioTest. Regression hooks are scoped to their suite. The `native-ui` tag excludes graphics-only assertions from headless runs and selects them in the graphics profile. No fixture code is injected into the mod.

Bun applies the checked-in CLI 3.6.0 patch that increases the hard-coded headless startup deadline from 10 to 120 seconds. A separate 60-second output watchdog still catches a stalled process.

Headless tests exercise game state and GUI handlers. Check UI changes with the native suite as well; detailed scenario coverage and proof boundaries belong in [RELEASE_AUDIT.md](../RELEASE_AUDIT.md).

## Lua tooling

FMTK 2.1.9 generates types from checksum-pinned Factorio 2.1.20 runtime and prototype API documents, even when the installed engine is newer. EmmyLua Check 0.25.1 uses those definitions. Explicit adapters account for missing dictionary keys and flib's partial style definitions and heterogeneous GUI elements; diagnostics are not globally suppressed. The type check must also reject an intentional invalid Factorio API-call probe.

Luacheck verifies data-stage and runtime globals separately. FactorioTest validates its dynamic regression DSL in the engine; the native UI suite is also type-checked.

## Source pointers

- [gui/appearance.lua](../location_location_location/gui/appearance.lua) owns shared GUI styles and icon states. Action artwork and item/recipe tooltips are native Factorio.
- [planner.lua](../location_location_location/planner.lua) owns private drafts, source geometry, and saved recipe tags.

This guide and the development tooling directory are excluded from release packages.
