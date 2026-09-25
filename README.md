# Map Tag Generator — additive-selection fork

A fork of Majoca's [Map Tag Generator](https://mods.factorio.com/mod/map-tag-generator), imported from the published 3.0.1 archive because no upstream source repository was linked. Original authorship and MIT license are preserved. This fork keeps the mod's internal name, settings, and save data; install it instead of the upstream archive, not alongside it.

## Selecting suppliers

Take the existing Map Tag Generator selection tool, then:

- **Left-drag:** replace the pending selection.
- **Shift-left-drag:** add entities. Overlapping selections count each entity once.
- **Shift-right-drag:** subtract entities, without deleting map tags.
- **Right-drag:** use the existing map-tag eraser in zoomed-out map view.

Choose **Average of entities** for the arithmetic centroid of the selected entity centers. **Middle of entities** remains the bounding-box midpoint; it is not the centroid. These are geometric suggestions, not throughput-weighted or collision-checked building positions.

The tool stays in your cursor. The non-modal preview updates as you refine the selection, retaining position/layout choices, edits to surviving generated icons, and manually added icons. Drag the dialog out of the way if needed. Confirm creates the tags; Cancel, clearing the tool, or changing surfaces ends the pending selection.

Add/subtract gestures always open the preview, including an empty selection. Normal selection still respects the existing dialog settings. Existing entity-category filters remain in effect; this version does not add belts or recipe-specific ingredient anchors. Train stops retain their existing special positioning behavior.

## Verification

Run all automated checks with one command:

```sh
mise run test
```

This uses the official [FactorioTest](https://github.com/GlassBricks/FactorioTest) library and its `factorio-test-cli` runner, in headless benchmark mode. No desktop automation or custom scenario is required. Independent real-engine tests cover selection replacement/union/difference, centroid placement, overlapping drags, ghosts, destroyed suppliers, resource totals, dialog lifecycle, script reload, retained icon edits, manual tags, same-name stations, and the separate tag eraser.

The suite exercises real game state and GUI event handlers, not mouse injection.
Headless mode does not render chart view; eraser coverage checks its world-view
safety gate and its Cancel/Confirm behavior separately.

Install development dependencies with `bun install --frozen-lockfile`, then configure the executable once in ignored `.mise.local.toml`:

```toml
[env]
FACTORIO = "/absolute/path/to/Factorio.app/Contents/MacOS/factorio"
```

Prefer a standalone Factorio build. The Steam executable also supports headless benchmark mode without opening Steam's graphical game. The official runner downloads FactorioTest and flib into `.factorio-test/mods` using your existing Factorio Mod Portal credentials.

All test configuration, the framework's bundled test save, logs, and `results.json` live in ignored `.factorio-test/`, separate from your saves and live mods. If your installation needs an explicit data path, set `read-data` in `.factorio-test/config.ini` to the game's data directory. FactorioTest controls setup/teardown, asynchronous ticks, reloads, reporting, and process completion; failed or incomplete runs return a failing exit status.
