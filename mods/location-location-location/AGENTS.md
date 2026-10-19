# Location Location Location

Factorio mod for recipe-based map tags, factory surveying, and build planning.
Originally based on Map Tag Generator, with UX inspired by Factory Planner.

## Source map

- `info.json`: canonical mod ID, title, version, and dependencies. The shared packager owns the release-member policy.
- `data.lua`: prototype entry point; delegates native artwork and GUI styles to `gui/appearance.lua`.
- `control.lua`: event-library registration and optional FactorioTest entry point.
- `location_location_location/planner.lua`: private drafts, net change counts, source geometry, and shared saved recipe tags.
- `location_location_location/sources.lua`: source lookup, temporary navigation pins, and highlights.
- `location_location_location/gui/`: planner, product/recipe picker, and shared GUI components.
- `location_location_location/gui/appearance.lua`: canonical custom colours, native icon interaction states, and data-stage styles for both GUI surfaces.
- `location_location_location/event_handlers/`: engine event handling.
- `locale/en/LocationLocationLocation.cfg`: player-facing strings.
- `tests/planner.lua`: scoped real-engine behavioral regressions.
- `tests/native_preview.lua`: tagged FactorioTest native UI assertions and screenshots.

## Boundaries

- Mod ID: `location-location-location`; owned Lua/prototype/style/control namespace: `location_location_location`; locale section: `location-location-location`.
- Keep identifiers and top-level GUI roots independent of Map Tag Generator. Do not add an incompatibility dependency to avoid namespace collisions.
- Use Factorio's native artwork for action icons. Do not introduce custom action-image assets or hand-redrawn replacements.
- Preserve Factory Planner attribution for adapted picker code and styles.
- Draft edits remain private until Apply. Discard changes restores the latest saved draft in place, or returns an unsaved draft to the list; X closes. Manual placement moves only the recipe marker, never buildings or blueprints.
- A selected recipe can save without sources or a marker. No label hides map text without losing the recipe-list name.
- Keep appearance policy shared. Explicit dark titlebar sprites must not also undergo native hover inversion. Recipe-row geometry must account for the native button-child inset, not just caption padding.
- View location changes remote view, not the physical character's position, and must preserve the private draft.
- The new mod ID has separate storage; do not promise automatic migration from the old ID or introduce silent fallback paths.

## Verification and delivery

- Bootstrap explicitly using the root developer guide; ordinary verification does not install the root toolchain. Use ignored `.mise.local.toml` for explicit `FACTORIO` and standalone `FACTORIO_NATIVE` paths.
- Run `mise run test-ui -- location-location-location --language <language>` for the actual FactorioTest native suite; keep its `native-ui` tag excluded from headless profiles.
- Run `mise run verify -- location-location-location` for source quality, metadata, Lua checks, model/toolkit tests and both real-engine profiles. `mise run test -- location-location-location --profile base` runs only the selected engine suite.
- Verify UI changes in the isolated native preview as well as tests. Screenshots, fixture mods, configs, saves, and logs belong under ignored `.factorio-test/` and must not enter release packages.
- Keep the preview sandbox limited to this mod and required dependencies. Add other mods only for an explicit compatibility check, then remove them from the sandbox.
- Never alter normal Factorio saves, configuration, or installed mods without an explicit installation request.
- Update README and changelog for permanent behavioral changes. Keep package identity derived from `info.json`.
- Workspace `checkpoint` verifies every product and commits locally; `vac` additionally publishes source. Both require explicit authority and a literal commit message; neither is a routine check. See the root developer guide for staging and drift safeguards.
