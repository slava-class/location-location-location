# Location Location Location

*Recipe-based map tags for factory surveying and build planning.*

Originally based on [Map Tag Generator](https://mods.factorio.com/mod/map-tag-generator), with UX inspired by [Factory Planner](https://github.com/ClaudeMetz/FactoryPlanner).

Mod ID: `location-location-location`. Requires Factorio **2.1.19 or later** and Factorio Library. Its prototypes, controls, GUI roots, locale keys, and saved state use a separate namespace so Map Tag Generator can remain enabled alongside it. Original code and adapted Factory Planner components retain their MIT attribution.

## Planning ingredient sources

Open **Location Location Location** from its top-left button, shortcut bar, or **Control-Shift-L**. The persistent left rail groups saved recipe tags by their actual surface—planet, space platform, or modded surface. Select a recipe tag to edit it beside the list. The green **+** immediately opens the product/recipe picker for a new private draft on your current surface. Browsing another surface does not move your view or saved sources. Source selection, closest lookup, copying from a machine, and marker placement automatically enter the tag's surface in remote view before continuing; your physical character and saved plan remain unchanged. New recipe tags are still created on your current surface.

The workspace uses native Factory Planner-style panels, subheaders, compact recipe-tag rows with aligned saved-assignment counts, and a separate **Tag location** preview. The picker opens as a fixed-size modal over the editor, preserving the draft and keeping its frame, search, and footer in place when filtering or choosing recipe alternatives. Its heading identifies the selection step without a redundant draft-context line. **Back to editor** returns to the same draft. Its grouped product grid and recipe-choice layout are adapted from [Factory Planner 2.1.15](https://github.com/ClaudeMetz/FactoryPlanner), under its MIT license. Choose an item or fluid from the category tabs and subgroup rows, or search by localized name in the titlebar. A product with one eligible recipe selects it directly; products with alternatives open the grouped recipe choices.

Each saved recipe-tag row is one click target, including its right-aligned count; both its title and count follow the same selection and hover colours. Long saved-tag lists scroll inside a full-width frame, keep the selected tag in view after edits, and use the full row width when no scrollbar is needed. **Back to recipe tags** is disabled when no saved tag or new draft is open. Recipe alternatives wrap at six choices per row and show only actual recipes—there are no empty placeholder slots. Both picker back actions are grouped on the left because selecting a recipe itself completes the choice.

Product categories wrap six per row and scroll after three rows, keeping the product grid and footer in place. Opening the picker, searching, and returning from recipe alternatives bring the selected category into view. The native search field and magnifier button use Factorio's popup-search styling. The magnifier is selected only while the search filter is nonempty; opening an unfiltered picker or clearing its query leaves it inactive. Click the magnifier or press your configured **Search** shortcut to focus and select the current query in either picker view; the tooltip follows your actual key binding.

Category and product panes share a viewport and scrollbar alignment; the product background fits exactly ten slots without a partial extra column.

Only researched recipes are included by default, using your force's enabled recipes and researched technology unlocks. Toggle **Show unresearched** to plan ahead; locked products and recipe choices both use yellow slots. The preference and selected category are remembered per player. Hidden recipes and recipes without assignable ingredients are excluded. Alternatively, **Copy from machine**, available in both the editor and Select product footer, reads one configured assembler, furnace, or silo into the same private draft. Factory Planner does not need to be installed.

Assignment progress sits at the right of the **Ingredient sources** header in the full editor and beside the recipe name when pinned. Each compact ingredient row shows its source count or an amber **No source** status. Long ingredient lists scroll; there is no six-ingredient limit. Hover ingredient icons for native item or fluid details, or the recipe icon or name for native recipe details in either editor layout. Truncated ingredient names retain their full-name tooltip. Each ingredient offers:

- **Select:** manually assign any selectable entities as source anchors. Click **Selecting** again to pause without losing edits, or select another ingredient to switch directly. Left-drag replaces, Shift-left-drag adds, and either right-drag gesture removes anchors. Overlapping selections are deduplicated by position.
  Hover **Select** or **Selecting** for the bound-control instructions in either layout; there is no standalone source-selection instruction row.
- **Add closest:** add the nearest own-force machine whose configured recipe produces that ingredient. Existing anchors remain.
- **Find closest:** show that machine through a temporary native navigation pin, with its recipe icon, distance, and a directional arrow when off-screen. On the tag's surface it does not move the view or change assignments; from another surface it first opens the tag's surface in remote view. A new Find replaces the previous temporary pin; it expires after 30 seconds. Your own pins are untouched.
- **Clear:** remove all anchors for that ingredient.

Source lookup feedback appears in a separate native status bar below the ingredient list, with an **×** to dismiss it. Informational results such as no matching producer use a neutral frame; blocked operations such as a stale Apply use a red frame. The bar occupies space only while visible. In the full editor, dismissing it returns that space to the scrollable list while the list's top edge, dialog bounds, and footer remain fixed; the compact panel instead grows to fit feedback. Hover truncated text to read the full message. Retrying or editing sources clears the previous notice without discarding the draft.

Closest searches use your **current controller/view position**, including remote view—not your physical character's position. Cross-surface actions first focus the tag's marker or the native remote-view position when it has no marker. They search your force's explored area on the tag's surface, matching recipe outputs rather than inventory contents. Manual selection deliberately accepts belts, empty chests, ghosts, and other entities without checking their contents or suitability.

The suggestion averages each assigned ingredient's anchors, then gives those ingredient centers equal weight. More anchors for one ingredient do not increase its weight. Unassigned ingredients are excluded; the editor shows the assigned/total count, and a named incomplete marker carries `[assigned/total]`. You can save immediately after choosing a recipe, without assigning any sources. A source-free recipe tag remains in the list; its map marker appears when sources or an explicit marker position are assigned.

The minimap automatically fits assigned source positions and the suggested or chosen marker, zooming closer for small groups. Marker coordinates are in the **View location** tooltip in both editor modes, not a separate position row. Native chart-tag labels can still overlap or clip at the minimap edge.

**Choose marker location** lets you left-drag an area in the world to use its center as the recipe tag's marker position. It does not select sources, place machines, or create a blueprint. The manual position stays fixed as you edit sources. **Reset to automatic** clears it and returns to the source-based calculation. Both operations remain private until Apply.

**View location** pins the draft and focuses remote view on its marker position, including across surfaces. It does not move your physical character or save the draft.

**Apply** saves the force-shared recipe tag and creates, moves, or removes its owned marker according to the draft's position. While dirty, it turns amber and reads **Apply N changes**: the net differences in recipe, custom name, label visibility, marker placement, and each ingredient's source set. Reverting an edit reduces the count. Sidebar counts continue to describe saved assignments.

**Discard changes** restores the latest saved version in place without closing the editor, including in pinned mode. For a new unsaved draft, it returns to the recipe-tag list. It also stops source/marker selection and restores saved highlights. **X** closes without saving; the normal close action also closes the full editor. The rail's **Back to recipe tags** returns to the overview. Choosing another recipe tag or browsing another surface discards unapplied edits. Ordinary player surface or force changes close the editor; View location preserves its draft.

**No label** is enabled by default for new recipe tags, making their map markers icon-only without name or assignment-count text. It disables the Name input but preserves its value for re-enabling. Existing saved tags retain their setting. Changes stay private until Apply and are restored by Discard changes.

### Pinned drafting

Use the small pin before the title to switch between the full workspace and a compact, non-modal editor. It becomes available after opening or creating a recipe tag and choosing a recipe; its disabled tooltip explains this prerequisite. The pin stays at the same screen position when switching modes, including after dragging either window. Its active and hovered glyph is black on amber, and clicking it again expands the same private draft.

The compact panel leaves the world interactive while you walk, select sources, or choose a marker location. It keeps the recipe's assigned count in the header, scrolls long ingredient lists, and offers Select, a small **+** for Add closest, Find, Clear, marker controls, and the same Discard changes/Apply footer. Coordinates remain available in the View location tooltip. Expand to edit the name or label visibility, change recipe, or see the minimap. Closing another game window does not dismiss the pinned panel.

All action icons use Factorio's native artwork, including its sideways pin. Recipe and item artwork is unchanged; no custom action image assets are required.

## Highlights and retirement

Use the titlebar highlight toggle or **Highlight recipe-tag sources** shortcut to mark saved source positions across **all active recipe tags in your force**, including those on other surfaces. Both use the same native glyph: white when inactive, black when hovered or active. Highlights are private to you, deduplicate shared positions, and remain anchored when original entities are removed. While editing an active saved recipe tag, highlights immediately preview its current source assignments, including Clear, replacement, and right-drag removal. Sources still used by another active recipe tag remain highlighted. Apply commits the changes for your force; Discard changes or closing without Apply restores the saved highlights. New unsaved recipe tags are not highlighted.

The rail orders actions as **+**, **Delete**, a spacer, **Retire/Reactivate**, **Show retired recipe tags**, and **Back to recipe tags**. Delete becomes an inline amber **Confirm** button on the first click; click it again to delete, or click the adjacent **×** to cancel deletion without changing the draft. Editing the draft also disarms confirmation. Hover an icon for its action; Show retired uses a dark native glyph and is highlighted while enabled. These immediate actions are separate from Discard changes/Apply. Retire keeps a recipe tag and its marker but excludes its sources from highlights and hides it from the default list. Enable Show retired, then Reactivate to restore it. Retired rows are muted and explicitly labeled. Retirement does not save unrelated draft edits.

Saved markers never move automatically. Deleted markers are recreated on the next Apply when the draft has a position. Clearing the last source without a manual position removes the owned marker on Apply, but keeps the saved recipe tag. Deleting a recipe tag requires confirmation and removes only its own marker. A teammate's newer revision blocks stale saving, retirement, and deletion. Missing recipes or surfaces leave saved recipe tags accessible for correction or deletion.

This is a geometric planning aid, not a production-rate, routing, collision, or terrain-feasibility calculator.

## Upgrading to 3.3.0

The product now uses the new mod ID `location-location-location`. Factorio treats this as a different mod: saved private mod storage from `map-tag-generator` does not transfer automatically. Keep a backup before switching an existing save; this release does not include a cross-ID recipe-tag migration.

The editor replaces the old generic generator and eraser, including their controls and settings. Its selection gestures never erase unrelated chart tags. The former paginated picker is replaced by the Factory Planner-inspired product/recipe flow, and saved recipe tags appear in a surface-based workspace.

## Development

`location_location_location/gui/appearance.lua` is the shared boundary for custom GUI colours, icon states, and data-stage styles. Planner and picker use its policy rather than defining independent variants.

Close and search titlebar buttons inherit Factorio's stock `frame_action_button` geometry, padding, sounds, and automatic sprite inversion without local size overrides. Close uses `utility/close` and the native `gui.close-instruction` tooltip in modal windows; pinned and world-selection modes use `gui.close` without advertising unavailable keyboard dismissal. Search uses `utility/search` and `search_popup_textfield`. The full editor and picker participate in the native `player.opened` / [`on_gui_closed`](https://lua-api.factorio.com/latest/events.html#on_gui_closed) lifecycle, while the pinned editor deliberately remains non-modal.

Pin, highlight, and researched-filter toggles also use native sprite inversion rather than separate black sprite copies, while retaining their compact sizes and amber selected states. Ingredient and recipe details use native `elem_tooltip` values; inline notices use `neutral_message_frame` and `negative_message_frame`.

Factorio exposes GUI primitives, not an embeddable search/titlebar component. Search reuses [`focus()` and `select_all()`](https://lua-api.factorio.com/latest/classes/LuaGuiElement.html#focus), and a [`linked_game_control`](https://lua-api.factorio.com/latest/prototypes/CustomInputPrototype.html#linked_game_control) follows the player's Search binding. Filtering, the nonempty-query indicator, and draft cleanup remain mod-owned. A native [`choose-elem-button`](https://lua-api.factorio.com/latest/concepts/GuiElementType.html) can provide an engine-owned prototype picker, but using it would replace the current product-to-recipe workflow rather than embed that workflow and its custom footer.

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
