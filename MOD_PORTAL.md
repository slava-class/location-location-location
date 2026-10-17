# Mod Portal listing — Location Location Location

The listing is [Location Location Location](https://mods.factorio.com/mod/location-location-location), owned by **arrayjam**. Version **1.0.0** was first published on 3 October 2026 UTC (4 October in Melbourne); its downloadable archive was verified. This file owns the long description and the listing fields below. `info.json` is canonical for the current title, summary, homepage, and release version; use `mise run release-status` for live publication state.

## Listing fields

- **Mod ID:** `location-location-location`
- **Title:** Location Location Location
- **Author:** slava-class
- **Portal owner:** arrayjam
- **Category:** Utilities
- **Tags:** none
- **Release:** declared in `info.json`; live state is read by `release-status`
- **Factorio:** 2.1, minimum build 2.1.20
- **Required mod:** Factorio Library (`flib`) 0.17.2 or later
- **Optional:** Space Age; FactorioTest 3.1.0 or later for development tests
- **License:** MIT
- **Source:** [slava-class/location-location-location](https://github.com/slava-class/location-location-location)

## Description

**Find a place for your next production line.**

You have a production site in mind, but its inputs and destinations are scattered across the factory. Location Location Location helps you plan several recipes together, survey their ingredient sources and output destinations, and save a production-site plan before laying belts, pipes, or rails.

### Make your first plan

1. Open the planner with **Control-Shift-L** (default), its shortcut, or its top-left button.
2. Click **+** and select products and recipes. Keep selecting to add more, click again to remove, then return to the editor. Search by name, show unresearched recipes, or **Copy from machines** to add the distinct recipes of selected assemblers, furnaces, or silos.
3. Assign ingredient sources and output destinations with **Select** or **Add closest**. Pin the editor to keep the world interactive while surveying.
4. Review the suggested site, or use **Choose marker location** and drag an area to place the marker at its center.
5. Click **Apply** to save the recipe tag for your force.

You can save a plan without connections. It stays in the list; a map marker appears once you assign an input source or output destination, or choose a marker position.

### Features

- Combine several recipes in one site plan, with shared ingredients and outputs listed once per side.
- Add the closest configured producer for an input or consumer for an output, or find either with a temporary navigation pin.
- Suggest a site from assigned input and output centers, or choose the marker position yourself.
- Pin the editor, highlight connections, and browse plans across available surfaces.
- Keep drafts private until Apply; reopen, retire, or delete shared plans.

This is a geometric planning aid; it does not calculate throughput or build your factory. Internal flows between selected recipes are not automatically cancelled; leave those connections unassigned to exclude them from the location suggestion. Existing single-recipe plans are preserved on update.

### Requirements

Requires **Factorio 2.1.20 or later within 2.1** and **Factorio Library 0.17.2 or later**. Space Age is optional. The interface includes English, German, French, Spanish, Russian, and Simplified Chinese.

### Credits

Maintained by [slava-class](https://github.com/slava-class). Based on [Map Tag Generator](https://mods.factorio.com/mod/map-tag-generator) by majoca; picker and styles adapted from [Factory Planner](https://github.com/ClaudeMetz/FactoryPlanner) by Claude Metz. MIT licensed.
