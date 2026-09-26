# Map Tag Generator — recipe source planner

Based on Majoca's [Map Tag Generator](https://mods.factorio.com/mod/map-tag-generator), under the MIT license. Install this fork instead of the upstream mod, not alongside it. Requires Factorio **2.1.19 or later** and Factorio Library.

## Planning ingredient sources

Open **Recipe source planner** from its top-left button, shortcut bar, or **Control-Shift-T**. The persistent left rail groups saved plans by their actual surface—planet, space platform, or modded surface. Select a plan to edit it beside the list, or use the green **+** button to create one on your current surface. Browsing another surface does not move your view or saved sources; travel there before creating a new plan or selecting sources.

The workspace uses native Factory Planner-style panels, subheaders, compact plan rows with aligned saved-assignment counts, and a separate suggested-location preview. The picker opens as a fixed-size modal over the editor, retaining the plan name and keeping its frame, search, and footer in place when filtering or choosing recipe alternatives. **Back to editor** returns to the same draft. Its grouped product grid and recipe-choice layout are adapted from [Factory Planner 2.1.15](https://github.com/ClaudeMetz/FactoryPlanner), under its MIT license. Choose an item or fluid from the category tabs and subgroup rows, or search by localized name in the titlebar. A product with one eligible recipe selects it directly; products with alternatives open the grouped recipe choices.

Each saved-plan row is one click target, including its right-aligned count. Recipe alternatives wrap at six choices per row and show only actual recipes—there are no empty placeholder slots. Both picker back actions are grouped on the left because selecting a recipe itself completes the choice.

Only researched recipes are included by default, using your force's enabled recipes and researched technology unlocks. Toggle **Show unresearched** to plan ahead; locked products have red slots and locked recipe choices have yellow slots. The preference and selected category are remembered per player. Hidden recipes and recipes without assignable ingredients are excluded. Alternatively, **Copy from machine** copies the recipe of one configured assembler, furnace, or silo. Factory Planner does not need to be installed.

Each compact ingredient row shows its source count or an amber **No source** status. Long ingredient lists scroll; there is no six-ingredient limit. Hover a truncated ingredient name to read it in full. Each ingredient offers:

- **Select:** manually assign any selectable entities as source anchors. Left-drag replaces, Shift-left-drag adds, and either right-drag gesture removes anchors. Overlapping selections are deduplicated by position.
- **Add closest:** add the nearest own-force machine whose configured recipe produces that ingredient. Existing anchors remain.
- **Find closest:** show that machine through a temporary native navigation pin, with its recipe icon, distance, and a directional arrow when off-screen. It works in world and remote view without moving the view or changing assignments. A new Find replaces the previous temporary pin; it expires after 30 seconds. Your own pins are untouched.
- **Clear:** remove all anchors for that ingredient.

Source lookup failures appear in a separate inset status bar below the ingredient list, with an **×** to dismiss them. The bar occupies space only while visible: dismissing it returns that space to the scrollable list. The list's top edge, dialog bounds, and footer remain fixed. Hover truncated text to read the full message. Retrying or editing sources clears the previous notice without discarding the draft.

Closest searches use your **current controller/view position**, including remote view—not your physical character's position. They search your force's explored area on the current surface, matching recipe outputs rather than inventory contents. Source selection must be on the plan's surface. Manual selection deliberately accepts belts, empty chests, ghosts, and other entities without checking their contents or suitability.

The suggestion averages each assigned ingredient's anchors, then gives those ingredient centers equal weight. More anchors for one ingredient do not increase its weight. Unassigned ingredients are excluded; the editor shows the assigned/total count, and an incomplete marker carries `[assigned/total]`. At least one anchor is required to save.

The preview remains centered on the suggested **Position** shown below it. Native chart-tag labels can overlap or clip at the minimap edge; the map is not offset to make those labels fit.

**Apply** saves the force-shared plan and creates or moves its recipe marker. Other edits are private drafts until Apply; **Unapplied changes** appears beside Apply when the draft differs from the saved plan. Sidebar counts continue to describe saved assignments. **X**, **Cancel**, or the normal close action closes directly; the rail's **Back to plans** button separately returns to the overview. Choosing another plan or browsing another surface discards unapplied edits. Changing the player's surface or force closes the editor.

## Highlights and retirement

Use the titlebar highlight toggle or **Highlight plan sources** shortcut to mark saved source positions across **all active plans in your force**, including plans on other surfaces. Its icon is white when inactive and black when active. Highlights are private to you, deduplicate shared positions, and remain anchored when original entities are removed. While editing an active saved plan, your highlights immediately preview its current source assignments, including Clear, replacement, and right-drag removal. Sources still used by another active plan remain highlighted. Apply commits the changes for your force; Cancel or closing without Apply restores the saved highlights. New unsaved plans are not highlighted.

The rail groups green **New plan**, **Retire/Reactivate**, and red **Delete** on the left; **Show retired plans** and **Back to plans** are grouped on the right. Hover an icon for its action; the archive icon is highlighted while retired plans are included. These controls are separate from the draft's Cancel/Apply footer. **Retire** keeps a plan and its existing marker but excludes its sources from highlights and hides it from the default list. Enable **Show retired plans**, then **Reactivate** to restore it. Retired rows are muted and explicitly labeled. Retirement takes effect immediately; it does not save unrelated draft edits.

Saved markers never move automatically. Deleted markers are recreated on the next Apply. Deleting a plan requires confirmation and removes only its own marker. A teammate's newer revision blocks stale saving, retirement, and deletion. Missing recipes or surfaces leave saved plans accessible for correction or deletion.

This is a geometric planning aid, not a production-rate, routing, collision, or terrain-feasibility calculator.

## Upgrading to 3.3.0

The planner now replaces the old generic generator and eraser completely, including their controls and settings. The internal mod name is unchanged. Existing chart tags and saved 3.1.0 recipe plans are preserved; old generator windows are removed. The planner's selection gestures never erase unrelated chart tags.

The former paginated recipe picker is replaced by Factory Planner's product/recipe flow, and saved plans now appear in a surface-based workspace. Old Find highlights and custom alerts are removed during migration; saved plans and their markers are retained. Surface navigation uses existing plan surface IDs and requires no plan-data conversion.

## Development

Install dependencies with `bun install --frozen-lockfile`, then set your Factorio executable in the ignored `.mise.local.toml`:

```toml
[env]
FACTORIO = "/absolute/path/to/Factorio.app/Contents/MacOS/factorio"
```

Run all checks:

```sh
mise run verify
```

This checks whitespace, checkpoint safety, and game behavior using [FactorioTest](https://github.com/GlassBricks/FactorioTest). `mise run test` runs only the game tests. The runner downloads its test dependencies using your Factorio Mod Portal credentials and keeps test saves, configuration, and results in `.factorio-test/`, separate from your saves and installed mods.

Tests run headlessly with either a standalone or Steam executable. They exercise real game state and GUI handlers, but do not validate rendered layout or normal chart visibility. If your installation needs an explicit data path, set `read-data` in `.factorio-test/config.ini` to the game's data directory.

## Verified checkpoints

```sh
mise run vac -- "Describe the completed change"
```

This verifies, stages **all non-ignored changes in this repository**, commits with the supplied message, and pushes the current branch to `origin`. Review your changes first: this is a publishing command, not just a check.

A nonblank message is required. Failed checks or files changing during verification prevent the commit. Push failure produces a warning and retains the local commit. This command does not install the mod or publish a Mod Portal release.
