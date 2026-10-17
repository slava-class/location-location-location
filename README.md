# Location Location Location

**Find a place for your next production line.**

You have a production site in mind, but its inputs and destinations are scattered across the factory. Location Location Location lets you select several recipes, survey their ingredient sources and output destinations, compare a suggested location with your own choice, and save the site as a shared map tag—before laying belts, pipes, or rails.

Use it to plan an expansion, mark a future build, or leave a production-site plan for a teammate. It is a **geometric planning aid**, not a throughput calculator or an automatic factory builder.

## Make your first recipe tag

1. Open the planner with **Control-Shift-L**, its shortcut, or its top-left button.
2. Click **+**, then choose products and recipes. Selections stay in the picker so you can add more; click again to remove a selection, then **Back to editor** when ready. Browse the category grid or search by name, enable **Show unresearched** to plan ahead, or use **Copy from machines** to add the distinct recipes of selected assemblers, furnaces, or silos.
3. Assign **Ingredient sources** and **Output destinations** with **Select** or **Add closest**. Pin the editor to keep the world interactive while surveying.
4. Review the suggested site, or use **Choose marker location** and drag an area to place the marker at its center.
5. Click **Apply**. Your force can now reopen the recipe tag and see its map marker.

You can save a plan before assigning connections. It stays in the list; a map marker appears once it has an input source, an output destination, or a manually chosen location.

## Plan several recipes together

One plan can contain several recipes while keeping one shared marker. Use the recipe **+** button to add more, or the small **X** beside a selected recipe to remove it. The picker highlights selected recipes and products.

- Shared ingredients and products are listed once per side. An item or fluid used as both an input and an output has separate source and destination assignments.
- Adding recipes preserves existing assignments. Removing a recipe removes only connections no longer used by any selected recipe; **Discard changes** restores the saved plan.
- Inputs produced by another selected recipe are not automatically cancelled out. Leave internal connections unassigned when you do not want them to influence the location. This is not a production-ratio or net-flow calculator.
- The first selected recipe supplies the marker icon. Automatic names combine the recipe names; a custom name is retained when the selection changes.

Existing single-recipe plans migrate on mod update, preserving their identity, revision, name, sources, retirement state, and saved marker. Output rows are added without moving that marker; only **Apply** updates it.

## Survey connections

| Action | Result |
| --- | --- |
| **Select** | Choose source or destination anchors yourself. Left-drag replaces; Shift-left-drag adds; right-drag removes. Click **Selecting** again to pause. The tooltip follows your actual key bindings. |
| **Add closest** | Add the nearest configured producer for an input, or consumer for an output, keeping existing anchors. Changes remain private until Apply. |
| **Find closest** | Show that producer or consumer with a temporary navigation pin, distance, and off-screen direction arrow. Does not change assignments; the pin expires after 30 seconds. |
| **Clear** | Remove that input's sources or that output's destinations from the draft. |

Automatic lookup searches **your force's charted machines on the tag's surface** (or your force's machines on its own space platform), measured from your current character or remote-view position. It matches configured recipe outputs for producers and configured recipe ingredients for consumers—not inventory contents or fuel buffers. Manual selection accepts any selectable entities—including belts, pipes, empty chests, and ghosts—so you can mark planned connection points as well as working machines.

Hover input, output, and recipe icons for Factorio's native details. **Highlight connections** marks saved input and output positions for your active recipe tags; while editing a saved tag, it previews your draft. Highlights are personal, shared positions are deduplicated, and removing an original entity does not erase its saved anchor.

## Choose the site

The automatic suggestion is the average of the assigned input and output centers:

- Each input or output center is the average of its assigned anchors.
- Each assigned connection gets equal weight, regardless of its anchor count or how many selected recipes use it.
- Unassigned connections are excluded from the suggestion. The assignment count includes all listed inputs and outputs, but leaving rows unassigned does not prevent saving.

This is a starting point for your judgment. It does **not** account for consumption rates, transport distance along routes, terrain, collisions, or available space.

**Choose marker location** overrides the suggestion without moving machines or placing blueprints. **Reset to automatic** restores connection-based placement. **View location** opens the site in remote view without moving your physical character or saving edits.

## Keep plans organized

- **Surfaces:** browse saved recipe tags by planet, platform, or other surface. Browsing does not move your view. World-facing actions automatically enter the tag's surface in remote view; new tags belong to your current surface.
- **Pinned editor:** keep input, output, and marker controls beside the world. Expand the same draft to change its recipes, name, or label setting and inspect the minimap.
- **Apply / Discard changes:** drafts are private; Apply saves for your force. Discard restores the latest saved version, or returns an unsaved new draft to the list. Closing or switching tags/surfaces discards unapplied edits. Ordinary player surface or force changes close the editor.
- **No label:** new map markers are icon-only by default. Turn this off for a name and, when incomplete, an assignment count. Hiding the label preserves the name.
- **Retire / Reactivate:** shelve a plan without deleting its marker. Retired tags are hidden by default and excluded from connection highlights; **Show retired** brings them back into the list.
- **Delete:** confirm to remove the recipe tag and its owned marker. Unrelated chart tags and personal navigation pins are untouched.

Saved markers do not move automatically. Apply updates their position and can recreate a deleted marker. A teammate's newer revision blocks stale saves, retirement, or deletion rather than overwriting their work.

## Reversed underground warnings

The mod also checks connected underground belts independently of the planner. If the ordinary belts immediately outside **both mouths** point against the underground pair's direction, stock hollow direction triangles mark the problem: strong orange arrows over both mouths, with smaller, muted arrows along the underground span. They point in the underground belt's **actual direction**, not the surrounding belts' direction.

The default overlay breathes softly over a 3.6-second cycle without blinking off. Only opacity changes; the orange hue stays fixed. Mouth warnings remain larger and stronger than the interior arrows.

Both controls are under **Settings → Mod settings → Per player**:

| Setting | Choices |
| --- | --- |
| **Map alerts for reversed underground belts** | **On by default**; disable clickable map alerts independently of the arrows. Existing saved choices are preserved. |
| **Underground warning overlay** | **Pulsing** (default), **Steady (no pulse)**, or **Off**. Changes apply without a restart and affect only your view. |

Hovering an underground entrance or exit hides **only that connection's span** in your view so Factorio's stock indicators remain clear. Ordinary belts, splitters, and unrelated underground mouths do not hide its arrows. Switching to another flagged pair restores the previous span and hides the new one. Mouth warnings stay visible, and a teammate's view is unaffected. Another mod's existing custom alert on the same belt is preserved.

The alert list deliberately has two short entries for each connection: **Reversed underground belt entrance** and **Reversed underground belt exit**. These are two clickable endpoints of the same problem.

Checks cover all four directions and belt tiers. Existing factories are surveyed when the mod is added or its configuration changes. Building, rotating, mining, or replacing belts queues only the affected neighborhood for the following simulation tick, including a pair's previous partner when it is disconnected or relinked. Correcting the flow clears both mouth overlays and their span promptly. Nothing is rotated automatically, and recipe-tag drafts are unaffected.

Background validation is spread across simulation ticks, with at most 64 queued mouth entries selected per tick. Up to 1,920 flagged connections can complete a validation cycle within 60 ticks; larger populations take longer rather than dropping checks. Map alerts retain their separate once-per-second renewal. Changes made silently by another script can therefore take a validation cycle plus an alert-renewal cycle to disappear from the map alert list.

This is a background-validation budget, not a blanket UPS guarantee: initial surveys, construction bursts, pulse rendering, and native alert renewal are separate work.

This is deliberately a narrow direction check, not a general belt validator: unpaired undergrounds, missing exterior belts, turns, and side-loading layouts without opposing belts at both mouths are not flagged. When enabled, map alerts cover your force's charted areas and its own space platforms.

## Requirements and installation

- Factorio **2.1**, build **2.1.20 or later**.
- [Factorio Library](https://mods.factorio.com/mod/flib) **0.17.2 or later**.
- Mod ID: `location-location-location`. Factory Planner is **not** required.
- Space Age is optional. Planet and platform navigation uses the surfaces available in your game.
- FactorioTest is optional and only needed for development tests.

For manual installation, put `location-location-location_<version>.zip` in Factorio's `mods` directory, install Factorio Library, and enable both mods. Use the version selected from the [Mod Portal](https://mods.factorio.com/mod/location-location-location); `info.json` declares the workspace version. The source repository is [slava-class/location-location-location](https://github.com/slava-class/location-location-location).

### Coming from Map Tag Generator

This is a separate mod, not an in-place upgrade. Both can remain enabled, but private storage from `map-tag-generator` does **not** transfer automatically. Back up an existing save before switching; there is no cross-ID recipe-tag migration. The old generic tag generator and eraser are not part of this mod.

The [Mod Portal listing](https://mods.factorio.com/mod/location-location-location) is published. [MOD_PORTAL.md](MOD_PORTAL.md) owns its long-form copy; `info.json` owns the title, summary, and release identity.

## Development

Run `mise run verify` with Mise, a C compiler, and Factorio 2.1.20 installed. It prepares pinned dependencies, uv-managed Python tooling, and detects the game; the complete suite also requires Space Age.

- `mise run verify`: run all checks and both headless suites.
- `mise run test-model`: run Lua model and producer/consumer lookup regressions without launching Factorio; does not verify the engine or native UI.
- `mise run test-ui -- en`: check the native UI and render screenshots.
- `mise run gallery -- en`: regenerate five native screenshot candidates at 1920 × 1080 with 125% UI scale on Nauvis. The published gallery uses only the full planner, then the source survey.
- `mise run package`: build and validate the release ZIP.
- `mise run release-prepare -- en`: verify the source, smoke-test the ZIP, regenerate native UI/gallery captures, and seal a local release bundle without publishing.
- `mise run release-status`: inspect live Portal metadata and compare the prepared release.
- Operational Portal readbacks bypass its 15-minute CDN cache; confirmed ZIP uploads are never resubmitted by the release flow.

Release publication is explicit: `release-publish`, `gallery-publish`, and `listing-publish` are publishing commands requiring scoped API credentials. See the developer guide for versioning, preparation, and partial-publication recovery; no release is uploaded by `verify`, `package`, or `gallery`.

See the [developer guide](mise-tasks/README.md) for setup overrides, individual commands, test profiles, and tooling details.

## Credits and license

Maintained by [slava-class](https://github.com/slava-class). Originally based on [Map Tag Generator](https://mods.factorio.com/mod/map-tag-generator) by majoca. Product/recipe picker code and styles are adapted from [Factory Planner](https://github.com/ClaudeMetz/FactoryPlanner) by Claude Metz.

[MIT licensed](license.txt), with original attribution preserved.
