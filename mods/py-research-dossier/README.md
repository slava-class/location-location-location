# Pyanodons Polytechnic

A field primer for the curious industrialist.

An unofficial educational companion for **Pyanodons (pY)**, the mod suite created by **pyanodon**. This companion is independently maintained, not an official project by the mod creator. The public name is **Pyanodons Polytechnic**; the stable Factorio mod ID, save identity and feedback directory remain `py-research-dossier`.

A Factorio 2.1 science-note companion for Pyanodons and the stock Factorio equipment used alongside it, with an in-game feedback logger. The notes were authored against the installed Py/Hardmode sources recorded in [game-sources.json](content/game-sources.json), not inferred from recipe names alone.

## What is included

**251 authored dossiers across 456 exact prototype targets**, covering coal and tar, mineral processing, early biology, boron chemistry, electronics, copper metallurgy, utilities, steam systems and logistics. Counts include future tiers and explicitly conditional families, not only currently unlocked content.

| Surface                                        | Annotated prototypes |
| ---------------------------------------------- | -------------------: |
| Recipes                                        |                  111 |
| Material items (not machine placement items)   |                   94 |
| Biological modules (fungi, plants and animals) |                    6 |
| Fluids                                         |                   25 |
| Machine and logistics entities                 |                  116 |
| Technologies                                   |                  104 |

Ordinary hovers show one regular-weight paragraph: a short topic followed by a concrete lesson. Disciplines (chemistry, physics, engineering, metallurgy, geology and biology) and the following basis labels live with the references in Factoriopedia:

- **Real principle:** a real-world property or mechanism, not certification of every surrounding game mechanic.
- **Simplified:** an identifiable real-world analogue with omitted conditions, variable compositions or fixed game yields.
- **Game abstraction:** a substitution or bundled operation that should not be mistaken for a literal industrial process.
- **Fictional species; real-world analogue:** real biology used to explain a Py organism or biological process, not a claim that the alien species exists or has verified anatomy. The lesson identifies the fictional analogy.

Budgets include the topic: materials allow 28 words / 200 characters, recipes 32 / 230, machines 30 / 220 and technologies 44 / 320. These are editorial limits, not engine limits or a guarantee of rendered height at every UI scale. A machine's entity is the sole annotation owner: its placement item remains unchanged, preventing duplicate notes when Factorio combines their tooltips. References include titles, section locators and URLs in **Factoriopedia-only** fields, not in ordinary hovers.

Early ingredients include raw coal and coal, ash, kerogen, coal dust, limestone, lime, soil, sand and washed sand. Biology covers fawogae and its spores/substrate, ralesia and seeds, wood and seedlings, moss, native flora, ulrics and cubs, vrauks and cocoons, and auogs and pups. Iron and zinc grade notes explain their opposite processing directions rather than inventing a universal quality ranking.

The 0.5.0 expansion includes all configured inserter/crane tiers, basic through express belts/undergrounds/splitters, optional AAI loaders, their capacity and batch-production research, the borate-to-boron material chain, electrolysis products, glassworks, stock furnaces and all high-pressure furnace tiers. Middle oil teaches boiling fractions; gasoline teaches octane rating. Coalification is kept on raw coal, while the shared coal/charcoal fuel item gets its own explanation.

The 0.6.0 pass adds electronics components, circuit boards and assembly equipment; copper preparation, extraction and casting; poles, pipes, boilers and heat exchangers; 31 source-reviewed distilator/tar-category processes; and related research and upstream materials. It distinguishes copper preparation grades from assay percentages, resistor power ratings from resistance, and steam temperature from pressure. Hidden helpers and a recipe moved to the cracker category are explicitly excluded from the distilator family.

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

The local 0.6.0 audit applies this contract to all nine logged flags, carrying forward the earlier Diborane work. Its inventory preserves the full current/future scope, exact IDs, prerequisite edges, recovered unlock packages, upgrade choices and remaining gaps. Player-specific reports under `audits/0.6.0-before/` and `audits/0.6.0-after/` are intentionally excluded from Git; run the workflow against your own profile to generate a local review. Automated `review-required` dispositions are not silently converted into scientific approval or log acknowledgements.

## Repeatable corpus and feedback workflow

Run these from the monorepo root. [tooling.ts](dev/tooling.ts) registers product-owned Effect CLI commands; [audit.ts](dev/audit.ts) and the bounded [save reader](dev/read-save.ts) run in Bun + Effect with canonical Effect Schema contracts. Native tools use the shared supervised-process boundary. No Polytechnic development task launches Factorio, changes the installed mod, writes to the profile, or acknowledges/deletes player feedback.

| Task                                                  | Result                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise run project -- py-research-dossier -- corpus`   | Budgets, citations, target validity and generated-file freshness; corpus inventory, duplicate-body and editorial review signals.                                                                                                             |
| `mise run project -- py-research-dossier -- flags`    | Exact typed records, original notes, line/byte identities and a checksum receipt. No corpus or save prerequisite.                                                                                                                            |
| `mise run project -- py-research-dossier -- progress` | Latest save selected by timestamp; saved mod versions, researched technologies, enabled recipes and exact save identity.                                                                                                                     |
| `mise run project -- py-research-dossier -- scope`    | Corpus check, fresh saved progression and flag intake; related families, net-positive producers in the reviewed index, full recovered unlocking packages, recursive prerequisites, runtime upgrade choices and qualified coverage inventory. |

Default output is `.factorio-test/projects/py-research-dossier/audits/`: `corpus.json`, `flags.json`, `progress.json`, `scope.json` and `scope.md`. `--out` is relative to this product's ignored output root, or an absolute path inside it; aliases and profile destinations are rejected. Use a named output directory to retain a review separately:

```sh
mise run project -- py-research-dossier -- scope --out audits/my-review
mise run project -- py-research-dossier -- flags --since-report .factorio-test/projects/py-research-dossier/audits/my-review/flags.json
```

`--since-report` selects only appended records by a verified **byte prefix**, not a maximum tick: save reloads can move ticks backwards, and repeated flags must not disappear. It does not close earlier findings or consume the source log. Changed/truncated prefixes, malformed records and incomplete final lines fail explicitly. Original records and the selection receipt remain in the report. Without this option, every log record is considered.

`--profile PATH`, `--log PATH` and `--save PATH` select explicit inputs; `--save latest` is the default. Save readback supports the validated **2.1.21-11** format, normal player/enemy/neutral forces and the saved Factory Planner mod-version table. It validates unique prototype mappings and adjacent recipe/research vectors within the first nine level chunks. An unfamiliar or ambiguous layout fails rather than reusing an old result. Availability is point-in-time saved state, not a claim about the running game.
The save reader uses the shared ZIP integrity/ownership boundary and native zlib. Each of the first nine numbered level chunks is bounded to 16 MiB before and after its nested inflation; `script.dat` is bounded to 128 MiB, inside the shared archive limits. These are explicit resource ceilings, not a claim to decode every Factorio save. Header/version ambiguity, duplicate IDs or saved mods, invalid UTF-8, unsupported flags/triggers, malformed framing and changing source identity fail closed. Save timestamps retain the established UTC/microsecond readback format; source-change checks retain nanosecond precision.

### Reviewed relationship inputs

- [content/reference-context.json](content/reference-context.json) freezes the source-identified recipe graph, technology prerequisites, runtime upgrade packages, native identities, source visibility rules and explicit native-index omissions recovered during the source audit. This curated structural reference retains capture hashes and provenance but excludes personal paths and player progression. A newer progression read does **not** turn it into a new engine capture.
- [content/audit-families.json](content/audit-families.json) records source-reviewed family members, relevant processes, upgrade research, evidence and exclusions. Family membership is not guessed from name similarity. Placement items resolve through their actual product-card entity relationship; recipe/material identities stay distinct. Net catalyst returns are not counted as producers.
- A new flag without a reviewed family remains an explicit evidence issue. Inspect its sources, update the relevant family or add a justified one, then rerun `mise run project -- py-research-dossier -- scope`. Review reference data deliberately when gameplay mods or native prototype identities change. Do not refresh version labels or checksums merely to make a check pass.

Scope compares all recorded mod versions, except the explicitly documented descriptions/feedback-only Dossier version, and checks the new save's native recipe/technology universe. Matching versions are a compatibility check, not a replacement for source review. Unresolved prerequisites, upgrade recipes, native subtypes, player forces and version differences are retained in `issues`; scope exits **2** for incomplete evidence. Unsupported input structure fails before a successful scope result.

The JSON preserves every selected flag and reason, per-recipe inclusion reasons, recovered current/future packages, ingredients/products, process/product cards, exact target ownership and existing paragraphs needing review. Coverage distinguishes no note, product-only, process-only, process-and-product and unverified creation conditions. Unobserved startup/feature conditions are **not** counted as active notes. Every expand/missing/change request remains `review-required`: nonempty text is not editorial approval.

After the mechanical pass, review scientific accuracy, specificity, wording and duplication across the entire merged scope; record fixes and unresolved findings in an authored audit. Editorial signals are prompts for review, not a word ban or an automatic rewrite. Keep essential distinctions between real science and abstraction without unnecessary game-name narration.

Authored reviews and their mechanical inventories stay together under ignored `audits/<review-name>/` directories. Earlier local reviews remain historical evidence, not release source. Raw feedback, saved progression, save ZIPs and installation receipts must not be committed.

Corpus/flag work and saved-progression readback use this same product CLI; `mise run project -- py-research-dossier -- progress` is the canonical progression command. The source code, not copied shell snippets or remembered binary offsets, owns the implementation.

## Text boundary and compatibility

[info.json](info.json) declares the required Py modules, `flib` and minimum reviewed versions. Hardmode, Fusion Energy, Industry, High Tech, Alternative Energy, AAI Loaders and the floating-pole mod have explicit optional ordering. `data-final-fixes.lua` runs after those dependencies and uses **Py's existing `py.add_to_description` helper** to append native `custom_tooltip_fields`.

Original names, `localised_description` values, warnings and existing custom fields remain unchanged. A shallow copy isolates each tooltip array before appending, so notes cannot leak into another prototype sharing that array. No ingredients, results, times, unlocks, productivity, fuel values, machine statistics or visibility flags are changed.

Targets are qualified by prototype type and exact name. Catalogue schema 3 permits explicit `when` conditions for an owning `mod`, a Boolean `startup` setting or a `featureFlag`; all declared conditions must hold. Mod/feature gates are evaluated before a potentially unavailable startup setting. The data stage and feedback logger use the same generated catalogue factory, so flags do not claim an inactive note exists. Missing **active** targets still fail with an explicit qualified ID before any annotation is applied; prototype absence is never used as a silent fallback. Later Py versions are not automatically verified just because they satisfy dependency minimums. Bespoke mod widgets do not necessarily display native tooltip fields.

The API design follows checksum-pinned official Factorio **2.1.21** references: `Prototype.custom_tooltip_fields`, `CustomTooltipField` and `LocalisedString`. The primary schema is [Factorio's prototype API JSON](https://lua-api.factorio.com/2.1.21/prototype-api.json). Shared Bun + Effect orchestration, Effect Schema contracts, Effect CLI commands, language tools and deterministic ZIP packaging live at the monorepo root. This product explicitly declares **offline verification**; it does not inherit another mod's engine-launching tasks or maintain another installer.

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

From the monorepo root:

```sh
mise install
mise exec -- bun install --frozen-lockfile
mise run setup
mise run project -- py-research-dossier -- generate
mise run format -- py-research-dossier
mise run verify -- py-research-dossier
mise run package -- py-research-dossier
```

`setup` verifies the pinned toolchain, provisions the shared locked Python/Lua tools and official API documents, and fetches the reviewed pypostprocessing **3.1.6** source at commit `bce772c5015de62aee26e7e63725ec8173936166`. Archive, source-file and extracted-function hashes are checked. The actual `py.add_to_description` implementation is cached privately; annotation tests do not substitute a mock. The upstream helper is **CC-BY-NC-ND-4.0**, not this mod's MIT code, and is not packaged or vendored. See [upstream Portal metadata](https://mods.factorio.com/api/mods/pypostprocessing/full) and [the license](https://creativecommons.org/licenses/by-nc-nd/4.0/).

Ordinary setup/verification does not read an installed mod set, Steam installation, sibling repository or player save. Full source provenance review is a separate explicit operation: `mise run project -- py-research-dossier -- review-sources --mods /absolute/mod-archives --base /absolute/data/base`. It validates the recorded archive/base-file identities and writes `source-manifest.json` under this product's ignored output root; it never launches Factorio.

Content validation resolves the shared checksum-pinned prototype API cache for the product's declared minimum version. Item/entity types follow that schema, and native prototype names retain their case and underscores; dossier IDs remain lowercase kebab-case. Help and invalid command syntax neither provision dependencies nor allocate engine work.

After editing content, run the product `generate` command; after editing source, run the shared `format` command. Generated Lua emits explicit record/target lines and passes the same pinned StyLua formatter with its AST-preservation check; `check` compares canonical formatted bytes without rewriting source. Full `verify` adds shared source-quality checks, content budgets/citations/targets, relationship-reference validation, generated-file freshness, Luacheck, minimum-version API typing with positive/negative controls, offline model regressions and deterministic packaging. The fake Lua API environments in `dev/fixtures/` are exercised, not presented as native API type or engine proof. Updating reviewed Py pins requires deliberate source review, not a checksum-only refresh.

Packaging writes a unique directory under `.factorio-test/projects/py-research-dossier/packages/`, containing the canonical `py-research-dossier_<version>.zip` and a source-bound manifest. Only runtime/data-stage Lua, locale, metadata, changelog and license files are shipped; development tools, type declarations, tests, audit inventories, upstream archives and replay data are excluded. ZIP members have fixed timestamps, stable order and byte-for-byte verification against source.

Every supervised subprocess prints an exact run ID and `logs` command. Readers can follow it live or inspect sealed diagnostics afterward without controlling the producer. In-process saved-progression readback reports the exact save/hash and fails directly through the same CLI; it no longer launches a Python helper. Installation remains a separately authorized operation through the shared local-mod workflow; do not manually edit the profile or select an old save by assumption.

## Verification evidence and limits

For 0.6.0, the exercised offline checks cover:

- Content generation: 251 dossiers, 456 unique qualified targets, 98 scientific source locators and no corpus editorial-review signals.
- Actual data-stage entrypoint replay: all 456 annotations, 116 placement-item/entity pairs and 797 covered Crafting recipe routes. Original fields remain unchanged except appended tooltip fields; every locale reference resolves. Each composed product card has at most one research note, and process notes are not copied into product cards.
- All 31 regression tests pass, with zero Lua lint warnings/errors and a passing formatting check. Feedback tests exercise enabled/disabled optional-mod, startup-setting and feature-flag contexts, exact recipe identity and item/entity note ownership using an offline API boundary model. The added Lua byte-roundtrip case covers ASCII controls, escape/digit boundaries and non-ASCII UTF-8.
- Saved-progression audit: 38 of 39 current family Crafting routes have verified process/product coverage; the remaining crane route has an unverified startup condition, not an invented coverage claim. Across the larger prerequisite-package slice, 124 of 343 current Crafting recipes have a verified lesson, 218 have none and one is conditional. This reduces no-note routes from 268 on the same save; it does not claim comprehensive coverage of every upstream recipe.

Regression coverage includes creation-condition combinations, absent optional settings, shared-array isolation, atomic missing-target failure, duplicate ownership, typed feedback identities, crafting visibility/unlock transitions, translated search, delayed translations, pagination, a recipe disabled while the dialog is open, draft preservation and the 0.3.0 draft migration. These are offline API/annotation tests, not native UI tests.

The replay input is **historical Factorio 2.1.19**, captured **2026-09-17T18:18:10.879Z**. It contains older Py versions and no player research state. Replay explicitly enables the source-conditional families; this is not a recovery of that capture's startup settings. Its 456 selected annotation targets contain 53 explicit descriptions but no existing custom tooltip fields; preservation of custom fields is exercised separately with the real current helper. Fully annotated prototype classes need no invented unselected sentinel. The 797 routes are potential covered hovers across the historical graph, **not 797 unlocked recipes in the current save**. Current availability is assessed separately from the saved 2.1.21 state and documented in the audit.

Reproduce the existing-capture smoke without launching the game:

```sh
mise run project -- py-research-dossier -- replay \
  --raw /absolute/reviewed-capture/script-output/data-raw-dump.json \
  --snapshot /absolute/reviewed-capture/snapshot.json
```

The runner checks the recorded capture identity and input digest, executes the actual data-stage entrypoint with the pinned real Py helper, compares complete selected prototypes and writes `.factorio-test/projects/py-research-dossier/historical-replay.json`. The original capture may be supplied from any explicit path; no sibling project is required. `py-helper.json` records setup provenance; the optional explicit `review-sources` operation records full inspected-source fingerprints in `source-manifest.json`. These local receipts and upstream source bytes are not shipped.

The user's 0.1.0 screenshots established that native machine tooltips combined the item and entity notes, and that the headings/paragraphs were too prominent. Version 0.2.0 removes the duplicate ownership and uses shorter, regular-font notes. The offline composition checks model that observed behaviour; they are not screenshots.

The failed Diborane flag attempt produced no JSONL record, so its exact native hover-event payload is unknown. The revised dialog removes widget readback as the authority for hovered identity and provides an explicit crafting-recipe selector; it does not claim a reproduced engine bug.

**Factorio was not launched by these development checks.** Native dialog/tooltip rendering, wrapping at the user's UI scale, real-engine input delivery/file writing and the current modpack's complete final data stage remain untested. The flag smoke uses an explicit offline API model, not a native screenshot or current-engine run. Developer tasks must not launch Factorio, including headless/export commands, to close this gap. Profile installation is a separate, backed-up operation through the shared canonical installer and requires the game to be saved and closed.

MIT; see [license.txt](license.txt). Scientific publications and Py mods retain their own licenses. Release history: [changelog.txt](changelog.txt).
