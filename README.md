# Pyanodon Polytechnic

A field primer for the curious industrialist.

An unofficial educational companion for Pyanodon. The public name is **Pyanodon Polytechnic**; the stable Factorio mod ID, save identity and feedback directory remain `py-research-dossier`.

A Factorio 2.1 science-note companion for the Py Coal Processing / Petroleum Handling / Raw Ores / Alien Life stack, with an in-game feedback logger. The notes were authored against the installed Py/Hardmode sources recorded in [game-sources.json](content/game-sources.json), not inferred from recipe names alone.

## What is included

**121 authored dossiers across 204 exact prototype targets**, covering coal and tar, ore processing, early biology, boron chemistry, electrolysis, glass, furnaces, inserters and conveyor logistics. Counts include future tiers and explicitly conditional families, not only currently unlocked content.

| Surface | Annotated prototypes |
| --- | ---: |
| Recipes | 43 |
| Material items (not machine placement items) | 42 |
| Biological modules (fungi, plants and animals) | 6 |
| Fluids | 13 |
| Machine and logistics entities | 66 |
| Technologies | 34 |

Ordinary hovers show one regular-weight paragraph: a short topic followed by a concrete lesson. Disciplines (chemistry, physics, engineering, metallurgy, geology and biology) and the following basis labels live with the references in Factoriopedia:

- **Real principle:** a real-world property or mechanism, not certification of every surrounding game mechanic.
- **Simplified:** an identifiable real-world analogue with omitted conditions, variable compositions or fixed game yields.
- **Game abstraction:** a substitution or bundled operation that should not be mistaken for a literal industrial process.
- **Fictional species; real-world analogue:** real biology used to explain a Py organism or biological process, not a claim that the alien species exists or has verified anatomy. The lesson identifies the fictional analogy.

Budgets include the topic: materials allow 28 words / 200 characters, recipes 32 / 230, machines 30 / 220 and technologies 44 / 320. These are editorial limits, not engine limits or a guarantee of rendered height at every UI scale. A machine's entity is the sole annotation owner: its placement item remains unchanged, preventing duplicate notes when Factorio combines their tooltips. References include titles, section locators and URLs in **Factoriopedia-only** fields, not in ordinary hovers.

Early ingredients include raw coal and coal, ash, kerogen, coal dust, limestone, lime, soil, sand and washed sand. Biology covers fawogae and its spores/substrate, ralesia and seeds, wood and seedlings, moss, native flora, ulrics and cubs, vrauks and cocoons, and auogs and pups. Iron and zinc grade notes explain their opposite processing directions rather than inventing a universal quality ranking.

The 0.5.0 expansion includes all configured inserter/crane tiers, basic through express belts/undergrounds/splitters, optional AAI loaders, their capacity and batch-production research, the borate-to-boron material chain, electrolysis products, glassworks, stock furnaces and all high-pressure furnace tiers. Middle oil teaches boiling fractions; gasoline teaches octane rating. Coalification is kept on raw coal, while the shared coal/charcoal fuel item gets its own explanation.

This is deliberately curated coverage, **not every unlocked Py recipe**. English content only. No runtime AI generation, gameplay advice, real-world operating instructions, balance changes or settings. Runtime code provides a local feedback dialog and translated recipe search, not gameplay mechanics.

### E → Crafting is the primary reading surface

Process explanations belong to the **recipe card**. Material and equipment explanations belong to the **product cards shown beside it**, with placement equipment still owned only by its entity. This follows Factorio's [native tooltip separation](https://factorio.com/blog/post/fff-318); copying the same paragraph onto a recipe and its product would repeat it in that hover. [Recipe custom fields have been supported since 2.0.69](https://forums.factorio.com/viewtopic.php?t=131044), before our minimum engine version.

Coverage and smoke checks explicitly include machine-only and fluid-output recipes. Diborane has a distinct process note and fluid-bonding note; Mechanical inserter and Transport belt have one equipment note each. The mod does not unlock recipes or alter which recipes Factorio displays.

## Flag something while playing

1. Hover a recipe or item and press **Ctrl+Shift+K**. When Factorio supplies a supported hovered prototype, its exact typed identity is retained independently of picker widgets. Fluids, entities, technologies and tiles are also supported.
2. Check the displayed target and optionally write a note.
3. Click **Expand explanation**, **Missing flavour text**, or **Request a change**.

The pencil shortcut-bar button opens the searchable **Recipe** list. If hovering “Diborane (recipe)” does not capture it, open the pencil, search **Diborane**, select `recipe/diborane`, and choose a reason. **Fluid → diborane** is a different target.

The recipe list uses the force's enabled, non-hidden recipes that are visible in player crafting. Machine-only recipes, fluid-only products and recipes without ingredients are included; signal-picker visibility is not a filter. Search accepts displayed names and internal IDs, with eight results per page. While translations are preparing, the dialog explicitly offers internal-ID search. This reuses LLL's `flib.dictionary` pattern.

The key binding is configurable under Controls. Changing target type clears the previous selection; an empty target cannot be submitted. Reopening the dialog preserves an unfinished draft, including across controller reloads. The 0.3.0 widget-owned draft is migrated when updating. Escape or Cancel closes the dialog without logging.

Every submitted flag immediately appends one JSON line to:

```text
~/Library/Application Support/factorio/script-output/py-research-dossier/flags.jsonl
```

The file is created on the first flag. It records the exact qualified prototype ID and subtype, reason, optional note, tick/player/force/surface context, active mod versions and any matching dossier note. For a placement item, its entity identity and entity-owned note are recorded separately without replacing what you actually flagged. This makes identical recipe/item names and biological module types unambiguous.

Nothing is transmitted or generated by AI in-game. In multiplayer the file is written only on the flagging player's computer. The append-only log is outside the save, so earlier flags remain when you reload a save. An assistant can read this file directly; no console command or manual export is required.

### Flag-driven audit contract

**A flag is an audit seed, not a one-prototype ticket.** This applies to all three reasons and to existing log records, not only flags submitted after this policy. Fixing the seed's paragraph does not close the wider audit.

For each flag:

1. **Resolve the actual target and family.** Preserve recipe/item/fluid/entity identities. Identify the related process or equipment family from inspected recipe relationships, placement targets, upgrade links and grouping—not name similarity or a broad type such as “all fluids.” Review equivalent variants and upgrade tiers, including stock Factorio members used by this modset.
2. **Review the whole unlocking technology package.** Find the actual technology or technologies unlocking the target's recipe(s), including production recipes for flagged materials or equipment. Audit the technology explanation, all its recipe unlocks, and their relevant products/equipment. Do not assume a same-named recipe is the sole producer.
3. **Walk prerequisites recursively to the roots.** Audit every prerequisite technology and its unlock package, deduplicating shared ancestors. “Upstream” means the prerequisite-technology chain, not an unbounded traversal through arbitrary ingredient loops. Starting content without an unlocking technology still receives the family audit; do not invent a parent technology.
4. **Separate scope from progression.** Audit the identified family and prerequisite closure in full. Mark current availability separately and prioritise what the player can encounter now; future upgrade tiers must be visible as future scope, not silently omitted or counted as covered.
5. **Review quality as well as presence.** Check related existing notes for missing concepts, insufficient explanations, incorrect chemistry/game comparisons and duplicated Crafting cards. Apply the original expand/missing/change reason across the relevant scope rather than merely counting nonempty strings. Keep each resulting lesson specific, sourced and compact.
6. **Report the whole disposition.** Record qualified targets, why each belongs, unlocking/prerequisite evidence, progression status, coverage findings, fixes and unresolved gaps. Merge overlapping flags into one audit while retaining their original targets/reasons; never rewrite the append-only player log. Do not claim completion from the seed fix alone or silently defer findings.

Use the flag's recorded mod versions and inspected current overrides. Historical prototype captures help discover relationships but cannot establish the current resolved graph or research state. If an edge or unlock state cannot be verified, mark that uncertainty rather than assuming it.

Examples of the expected scope—not claims that these wider audits are already complete:

- **Mechanical inserter:** the inserter family and its upgrade technologies, their full unlock packages and prerequisite chains—not just `inserter/burner-inserter`.
- **Transport belt:** belts, underground belts and splitters across the relevant upgrade family, plus their unlocking technologies and prerequisites—not just the basic belt.
- **Diborane:** the related boron-processing family, its actual unlocking technology package and prerequisite chain, keeping the synthesis recipe and fluid explanation distinct.

The local 0.5.0 family audit applies this contract to both logged flags and the reported Diborane attempt. Its inventory preserves the full current/future scope, exact IDs, prerequisite edges, recovered unlock packages, upgrade choices and remaining gaps. Player-specific audit files under `audits/` are intentionally excluded from Git; run the workflow against your own profile to generate a local review.

## Repeatable corpus and feedback workflow

Run these from this repository. [audit.mjs](mise-tasks/audit.mjs) is the single Bun Shell command boundary; it reuses the existing content validator and invokes the version-scoped Python save reader through `uv`. No task launches Factorio, changes the installed mod, writes to the profile, or acknowledges/deletes player feedback.

| Task | Result |
| --- | --- |
| `mise run corpus:check` | Budgets, citations, target validity and generated-file freshness; corpus inventory, duplicate-body and editorial review signals. |
| `mise run flags:read` | Exact typed records, original notes, line/byte identities and a checksum receipt. No corpus or save prerequisite. |
| `mise run audit:progress` | Latest save selected by timestamp; saved mod versions, researched technologies, enabled recipes and exact save identity. |
| `mise run audit:scope` | Corpus check, fresh saved progression and flag intake; related families, net-positive producers in the reviewed index, full recovered unlocking packages, recursive prerequisites, runtime upgrade choices and qualified coverage inventory. |

Default output is `.factorio-test/audits/`: `corpus.json`, `flags.json`, `progress.json`, `scope.json` and `scope.md`. For a durable review, use a named repository output directory:

```sh
mise run audit:scope -- --out audits/my-review
mise run flags:read -- --since-report audits/my-review/flags.json
```

`--since-report` selects only appended records by a verified **byte prefix**, not a maximum tick: save reloads can move ticks backwards, and repeated flags must not disappear. It does not close earlier findings or consume the source log. Changed/truncated prefixes, malformed records and incomplete final lines fail explicitly. Original records and the selection receipt remain in the report. Without this option, every log record is considered.

`--profile PATH`, `--log PATH` and `--save PATH` select explicit inputs; `--save latest` is the default. Save readback supports the validated **2.1.21-11** format, normal player/enemy/neutral forces and the saved Factory Planner mod-version table. It validates unique prototype mappings and adjacent recipe/research vectors within the first nine level chunks. An unfamiliar or ambiguous layout fails rather than reusing an old result. Availability is point-in-time saved state, not a claim about the running game.

### Reviewed relationship inputs

- [content/reference-context.json](content/reference-context.json) freezes the source-identified recipe graph, technology prerequisites, runtime upgrade packages, native identities, source visibility rules and explicit native-index omissions recovered during the source audit. This curated structural reference retains capture hashes and provenance but excludes personal paths and player progression. A newer progression read does **not** turn it into a new engine capture.
- [content/audit-families.json](content/audit-families.json) records source-reviewed family members, relevant processes, upgrade research, evidence and exclusions. Family membership is not guessed from name similarity. Placement items resolve through their actual product-card entity relationship; recipe/material identities stay distinct. Net catalyst returns are not counted as producers.
- A new flag without a reviewed family remains an explicit evidence issue. Inspect its sources, update the relevant family or add a justified one, then rerun `audit:scope`. Review reference data deliberately when gameplay mods or native prototype identities change. Do not refresh version labels or checksums merely to make a check pass.

Scope compares all recorded mod versions, except the explicitly documented descriptions/feedback-only Dossier version, and checks the new save's native recipe/technology universe. Matching versions are a compatibility check, not a replacement for source review. Unresolved prerequisites, upgrade recipes, native subtypes, player forces and version differences are retained in `issues`; scope exits **2** for incomplete evidence. Unsupported input structure fails before a successful scope result.

The JSON preserves every selected flag and reason, per-recipe inclusion reasons, recovered current/future packages, ingredients/products, process/product cards, exact target ownership and existing paragraphs needing review. Coverage distinguishes no note, product-only, process-only, process-and-product and unverified creation conditions. Unobserved startup/feature conditions are **not** counted as active notes. Every expand/missing/change request remains `review-required`: nonempty text is not editorial approval.

After the mechanical pass, review scientific accuracy, specificity, wording and duplication across the entire merged scope; record fixes and unresolved findings in an authored audit. Editorial signals are prompts for review, not a word ban or an automatic rewrite. Keep essential distinctions between real science and abstraction without unnecessary game-name narration.

Authored reviews and their mechanical inventories stay together under ignored `audits/<review-name>/` directories. Earlier local reviews remain historical evidence, not release source. Raw feedback, saved progression, save ZIPs and installation receipts must not be committed.

The managed `py-research-dossier` skill routes corpus/flag work here; `factorio-offline-research-readback` routes saved-progression work to the same `audit:progress` task. The source code, not copied shell snippets or remembered binary offsets, owns the implementation.

## Text boundary and compatibility

[info.json](info.json) declares the required Py modules, `flib` and minimum reviewed versions. Hardmode, Fusion Energy and AAI Loaders have explicit optional ordering. `data-final-fixes.lua` runs after those dependencies and uses **Py's existing `py.add_to_description` helper** to append native `custom_tooltip_fields`.

Original names, `localised_description` values, warnings and existing custom fields remain unchanged. A shallow copy isolates each tooltip array before appending, so notes cannot leak into another prototype sharing that array. No ingredients, results, times, unlocks, productivity, fuel values, machine statistics or visibility flags are changed.

Targets are qualified by prototype type and exact name. Catalogue schema 3 permits explicit `when` conditions for an owning `mod`, a Boolean `startup` setting or a `featureFlag`; all declared conditions must hold. Mod/feature gates are evaluated before a potentially unavailable startup setting. The data stage and feedback logger use the same generated catalogue factory, so flags do not claim an inactive note exists. Missing **active** targets still fail with an explicit qualified ID before any annotation is applied; prototype absence is never used as a silent fallback. Later Py versions are not automatically verified just because they satisfy dependency minimums. Bespoke mod widgets do not necessarily display native tooltip fields.

The API design follows the generated Factorio **2.1.21** references in the sibling `factorio-llm-docs` project: `Prototype.custom_tooltip_fields`, `CustomTooltipField` and `LocalisedString`. The primary schema is [Factorio's prototype API JSON](https://lua-api.factorio.com/2.1.21/prototype-api.json). The development workflow follows `location-location-location`: pinned mise tools, Bun-driven Lua checks, local lint tooling and deterministic, byte-verified ZIP packaging. It intentionally excludes LLL's engine-launching tasks and does not duplicate its local-mod installer.

## Content and evidence

- [content/catalog.json](content/catalog.json): canonical authored paragraphs, classifications, exact targets, scientific citations and game-source references.
- [content/sources.json](content/sources.json): scientific titles, section locators and URLs. Sources include DOE/NETL, EPA, FAO, EIA, UAF, AISI, Sepro, USGS, USDA, NOAA, MIT, OpenStax and the Smithsonian. General scientific references are distinguished from evidence of a specific Py recipe.
- [content/game-sources.json](content/game-sources.json): reviewed mod/base identities, archive and base-file SHA256 pins, source paths and the historical replay identity. Diborane includes Raw Ores' current water-to-hydrogen/category override, not just Coal Processing's initial definition.
- [dossier/apply.lua](dossier/apply.lua): the sole data-stage annotation implementation.
- `dossier/catalog.lua` and `locale/en/py-research-dossier.cfg`: generated from the content files; do not hand-edit them.
- [dossier/flags.lua](dossier/flags.lua): canonical typed target resolution and local JSONL records; [dossier/flag-gui.lua](dossier/flag-gui.lua) is the native event/dialog boundary.
- [dossier/recipes.lua](dossier/recipes.lua): crafting visibility, translated search and recipe ordering; GUI tags hold the canonical selected type/name.

A new dossier needs both scientific support and inspected game-source evidence. Name similarity is insufficient. Teach one specific concept before discussing a necessary limitation; do not fill the paragraph with generic disclaimers. Do not invent a balanced reaction, purity, temperature, catalyst mechanism or alien anatomy from game quantities. Keep references out of the hover body and preserve the distinction between separation and chemical conversion. Target the resolved prototype type: several Py organisms are `module` prototypes, not `item` prototypes.

## Local development

From this directory:

```sh
mise install
mise run setup
mise run generate
mise run verify
mise run package
```

`setup` installs the frozen Bun dependency and checksum-pinned Lua lint tools. Preparation reads the exact reviewed mod ZIPs and installed base Lua sources without changing them or launching the engine. It extracts the actual Py description helper with a Lua parser; annotation tests do not substitute a mock helper. Source overrides are explicit: `mise exec -- bun mise-tasks/prepare.mjs --mods /path/to/mods --base /path/to/data/base`. Defaults are the normal macOS profile and Steam install.

Content validation reads `../factorio-llm-docs/llm-docs/2.1.21/prototype-api.json`. Item/entity types follow that canonical schema, and native prototype names retain their case and underscores; dossier IDs remain lowercase kebab-case.

After editing content, run `generate`; after editing authored Lua, run `format`. `verify` checks content budgets, citation/target validity, generated-file freshness, Lua formatting, Luacheck and regression tests. Updating reviewed Py source pins requires a deliberate source review, not a checksum-only refresh. Pins describe reviewed inputs, not automatic discovery of the currently enabled mod set.

Packaging writes `dist/py-research-dossier_0.5.0.zip`, its SHA256 sidecar and `.factorio-test/package-manifest.json`. Only runtime/data-stage Lua, English locale, metadata, changelog and license files are shipped; development tools, tests, audit inventories, source archives and replay data are excluded. ZIP members have fixed timestamps, stable order and byte-for-byte verification against source.

Installation is separate. Use LLL's existing canonical local-mod workflow when installation is explicitly requested; do not manually edit the profile or select an old save by assumption.

## Verification evidence and limits

For 0.5.0, the exercised offline smoke checks cover:

- Content generation: 121 dossiers, 204 unique qualified targets, 51 scientific source locators.
- Actual data-stage entrypoint replay: all 204 annotations, 66 placement-item/entity pairs and 515 covered Crafting recipe routes. Original fields remain unchanged except appended tooltip fields; every locale reference resolves. Each composed product card has at most one research note, and process notes are not copied into product cards.
- Actual feedback module with the generated catalogue: ten records across enabled/disabled optional-mod, startup-setting and feature-flag contexts. Recipe identity and item/entity note ownership are preserved. This uses the offline API boundary model and does not write the user's log.
- Saved-progression audit: all 11 current family Crafting recipes have a process or product lesson. Across their much larger prerequisite-package slice, 75 of 341 current Crafting recipes have a lesson; the other 266 remain explicitly recorded gaps, not claimed coverage.

Regression coverage includes creation-condition combinations, absent optional settings, shared-array isolation, atomic missing-target failure, duplicate ownership, typed feedback identities, crafting visibility/unlock transitions, translated search, delayed translations, pagination, a recipe disabled while the dialog is open, draft preservation and the 0.3.0 draft migration. These are offline API/annotation tests, not native UI tests.

The replay input is **historical Factorio 2.1.19**, captured **2026-09-17T18:18:10.879Z**. It contains older Py versions and no player research state. Replay explicitly enables the source-conditional families; this is not a recovery of that capture's startup settings. Its 204 selected annotation targets contain 37 explicit descriptions but no existing custom tooltip fields; preservation of custom fields is exercised separately with the real current helper. Fully annotated prototype classes need no invented unselected sentinel. The 515 routes are potential covered hovers across the historical graph, **not 515 unlocked recipes in the current save**. Current availability is assessed separately from the saved 2.1.21 state and documented in the audit.

Reproduce the existing-capture smoke without launching the game:

```sh
mise run smoke -- \
  --raw "$HOME/workspace/factorio-llm-docs/.work/factoriopedia-VoWe9g/script-output/data-raw-dump.json" \
  --snapshot "$HOME/workspace/factorio-llm-docs/.work/factoriopedia-VoWe9g/snapshot.json"
```

The runner checks the recorded capture identity and input digest, executes the actual data-stage entrypoint, compares complete selected prototypes and writes `.factorio-test/smoke-report.json`. `.factorio-test/source-manifest.json` records the 66 inspected source-file fingerprints and the helper digest. These generated local receipts are not shipped.

The user's 0.1.0 screenshots established that native machine tooltips combined the item and entity notes, and that the headings/paragraphs were too prominent. Version 0.2.0 removes the duplicate ownership and uses shorter, regular-font notes. The offline composition checks model that observed behaviour; they are not screenshots.

The failed Diborane flag attempt produced no JSONL record, so its exact native hover-event payload is unknown. The revised dialog removes widget readback as the authority for hovered identity and provides an explicit crafting-recipe selector; it does not claim a reproduced engine bug.

**Factorio was not launched by these development checks.** Native dialog/tooltip rendering, wrapping at the user's UI scale, real-engine input delivery/file writing and the current modpack's complete final data stage remain untested. The flag smoke uses an explicit offline API model, not a native screenshot or current-engine run. Developer tasks must not launch Factorio, including headless/export commands, to close this gap. Profile installation is a separate, backed-up operation through LLL's canonical installer and requires the game to be saved and closed.

MIT; see [license.txt](license.txt). Scientific publications and Py mods retain their own licenses. Release history: [changelog.txt](changelog.txt).
