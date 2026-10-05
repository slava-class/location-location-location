# Location Location Location

**Find a place for your next production line.**

You have a recipe in mind, but its ingredients are scattered across the factory. Location Location Location lets you survey those sources, compare a suggested location with your own choice, and save the site as a shared map tag—before laying belts, pipes, or rails.

Use it to plan an expansion, mark a future build, or leave a production-site plan for a teammate. It is a **geometric planning aid**, not a throughput calculator or an automatic factory builder.

## Make your first recipe tag

1. Open the planner with **Control-Shift-L**, its shortcut, or its top-left button.
2. Click **+**, then choose a product and recipe. Browse the compact category grid or search by name, enable **Show unresearched** to plan ahead, or use **Copy from machine** to read one configured assembler, furnace, or silo.
3. Assign ingredient sources with **Select** or **Add closest**. Pin the editor to keep the world interactive while surveying.
4. Review the suggested site, or use **Choose marker location** and drag an area to place the marker at its center.
5. Click **Apply**. Your force can now reopen the recipe tag and see its map marker.

You can save a recipe before assigning sources. It stays in the list; a map marker appears once it has sources or a manually chosen location.

## Survey sources

| Action | Result |
| --- | --- |
| **Select** | Choose source anchors yourself. Left-drag replaces; Shift-left-drag adds; right-drag removes. Click **Selecting** again to pause. The tooltip follows your actual key bindings. |
| **Add closest** | Add the nearest machine configured to produce that ingredient, keeping existing sources. Changes remain private until Apply. |
| **Find closest** | Show that producer with a temporary navigation pin, distance, and off-screen direction arrow. Does not change assignments; the pin expires after 30 seconds. |
| **Clear** | Remove that ingredient's sources from the draft. |

Automatic lookup searches **your force's charted machines on the tag's surface** (or your force's machines on its own space platform), measured from your current character or remote-view position. It matches configured recipe outputs, not inventory contents. Manual selection accepts any selectable entities—including belts, empty chests, and ghosts—so you can mark planned supply points as well as working producers.

Hover ingredient and recipe icons for Factorio's native details. **Highlight sources** marks saved source positions for your active recipe tags; while editing a saved tag, it previews your draft. Highlights are personal, shared positions are deduplicated, and removing an original entity does not erase its saved anchor.

## Choose the site

The automatic suggestion is the average of the assigned ingredients' centers:

- Each ingredient's center is the average of its source anchors.
- Each assigned ingredient gets equal weight, regardless of its anchor count.
- Unassigned ingredients are excluded.

This is a starting point for your judgment. It does **not** account for consumption rates, transport distance along routes, terrain, collisions, or available space.

**Choose marker location** overrides the suggestion without moving machines or placing blueprints. **Reset to automatic** restores source-based placement. **View location** opens the site in remote view without moving your physical character or saving edits.

## Keep plans organized

- **Surfaces:** browse saved recipe tags by planet, platform, or other surface. Browsing does not move your view. World-facing actions automatically enter the tag's surface in remote view; new tags belong to your current surface.
- **Pinned editor:** keep source and marker controls beside the world. Expand the same draft to change its recipe, name, or label setting and inspect the minimap.
- **Apply / Discard changes:** drafts are private; Apply saves for your force. Discard restores the latest saved version, or returns an unsaved new draft to the list. Closing or switching tags/surfaces discards unapplied edits. Ordinary player surface or force changes close the editor.
- **No label:** new map markers are icon-only by default. Turn this off for a name and, when incomplete, an assignment count. Hiding the label preserves the name.
- **Retire / Reactivate:** shelve a plan without deleting its marker. Retired tags are hidden by default and excluded from source highlights; **Show retired** brings them back into the list.
- **Delete:** confirm to remove the recipe tag and its owned marker. Unrelated chart tags and personal navigation pins are untouched.

Saved markers do not move automatically. Apply updates their position and can recreate a deleted marker. A teammate's newer revision blocks stale saves, retirement, or deletion rather than overwriting their work.

## Requirements and installation

- Factorio **2.1**, build **2.1.20 or later**.
- [Factorio Library](https://mods.factorio.com/mod/flib) **0.17.2 or later**.
- Mod ID: `location-location-location`. Factory Planner is **not** required.
- Space Age is optional. Planet and platform navigation uses the surfaces available in your game.
- FactorioTest is optional and only needed for development tests.

For manual installation, put `location-location-location_1.0.0.zip` in Factorio's `mods` directory, install Factorio Library, and enable both mods. The source repository is [slava-class/location-location-location](https://github.com/slava-class/location-location-location).

### Coming from Map Tag Generator

This is a separate mod, not an in-place upgrade. Both can remain enabled, but private storage from `map-tag-generator` does **not** transfer automatically. Back up an existing save before switching; there is no cross-ID recipe-tag migration. The old generic tag generator and eraser are not part of this mod.

The prepared [Mod Portal listing](MOD_PORTAL.md) is local release copy. The public API currently has no listing for this mod ID; the draft has not been published.

## Development

Run `mise run verify` with Mise, Python 3.9 or later, a C compiler, and Factorio 2.1.20 installed. It prepares pinned dependencies and detects the game; the complete suite also requires Space Age.

- `mise run verify`: run all checks and both headless suites.
- `mise run test-ui -- en`: check the native UI and render screenshots.
- `mise run gallery -- en`: regenerate five Mod Portal screenshots at 1920 × 1080 with 125% UI scale on Nauvis.
- `mise run package`: build and validate the release ZIP.

See the [developer guide](mise-tasks/README.md) for setup overrides, individual commands, test profiles, and tooling details.

## Credits and license

Maintained by [slava-class](https://github.com/slava-class). Originally based on [Map Tag Generator](https://mods.factorio.com/mod/map-tag-generator) by majoca. Product/recipe picker code and styles are adapted from [Factory Planner](https://github.com/ClaudeMetz/FactoryPlanner) by Claude Metz.

[MIT licensed](license.txt), with original attribution preserved.
