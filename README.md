# Factorio mod workshop

One workspace for independently packaged Factorio mods and their shared development toolkit. Each product owns its `info.json`, runtime, assets, locales, tests and player-facing documentation under `mods/<mod-id>/`. The toolkit is not shipped to players.

## Products

- [Location Location Location](mods/location-location-location/README.md): recipe-based map tags, factory surveying and build planning.
- [Reversed Underground Belt Detector](mods/reversed-underground-belt-detector/README.md): an independently packaged detector, with its own tests and appearance studio.
- [Pyanodons Polytechnic](mods/py-research-dossier/README.md): curated scientific dossiers and offline research/feedback audits. Its verification does **not** launch Factorio.

## Start developing

Bootstrap explicitly from this directory:

```sh
mise install
mise exec -- bun install --frozen-lockfile
mise run setup
mise run dependencies-provision -- --all
mise run modkit -- --help
```

Mise supplies pinned binaries; Bun owns the single root dependency installation. Shared orchestration uses Effect, boundary contracts use Effect Schema, and commands use Effect CLI. Packaging, archive inspection, Lua provisioning/type overlays and offline save readback run in Bun; Python, uv and a second schema validator are not required.

```sh
mise run mods
mise run format -- --all
mise run check -- --all
mise run verify -- location-location-location
mise run package -- location-location-location
```

Select a mod explicitly, or use `--all` where supported. `format` changes layout; `check` is read-only source-quality verification. Full `verify` adds each product's declared Lua, model, package and real-engine coverage. Provision a compatible engine and required content as described in the [developer guide](tools/README.md); graphics require an explicit standalone full client, not Steam launch-dialog automation.

Dependency provisioning follows the selected product's verification contract. Engine products receive their required runtime closure; offline products receive only the shared type-tooling libraries, with omitted runtime dependencies listed explicitly in the receipt. Polytechnic's pinned private description helper is provisioned by `setup`, not by downloading or starting the pY runtime stack.

Every owned subprocess announces its run ID and exact live-log command. Generated profiles, saves, logs, captures, receipts and local release bundles live under ignored `.factorio-test/`, separately from the normal game profile.

`mise run mods` is the offline fleet overview: declared capabilities, source freshness of the latest readable verification, actual profile coverage, prepared-release usability, blockers and exact next commands. It does not launch Factorio or contact the Portal; use explicit `release-status -- <mod>` when a live Portal readback is wanted.

## Licensing and attribution

The shared toolkit and original contributions are [MIT licensed](license.txt), with `slava-class` credited for those contributions.

LLL retains its Map Tag Generator ancestry and Factory Planner adaptations. Preserve upstream copyright and permission notices for their respective contributions, including when moving or editing derived code.

Each product's `license.txt` is included in its independent ZIP. All products use MIT; the Portal publisher supports MIT selection. A different product license requires an explicit licensing and tooling change.

Third-party dependencies, Factorio artwork, scientific publications and pY source retain their own terms; the root license does not relicense them. In particular, Polytechnic's separately licensed upstream Lua helper stays in a private development cache and is not vendored or packaged.

## Delivery boundaries

- Verification, packaging and release preparation do not install a mod into normal play, commit, push or publish.
- Normal-profile installation requires a separate explicit request and a save backup.
- `checkpoint` verifies all products and commits locally; `vac` additionally pushes source. Neither is a routine verification command.
- Portal publication selects one exact mod and prepared version with separate authorization. A local preparation or successful check is not publication authority.

Read the [developer guide](tools/README.md) for command contracts and recovery behavior, and [architecture notes](ARCHITECTURE.md) for design decisions, verification requirements and the remaining development checklist. Product attribution and licensing remain in each product's own documentation and package.
