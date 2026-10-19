# Mod Portal listing — Reversed Underground Belt Detector

Local listing copy for the initial independent release; availability and ownership must be checked before any separately authorized publication. `info.json` owns the current title, summary, homepage and version.

## Listing fields

- **Mod ID:** `reversed-underground-belt-detector`
- **Title:** Reversed Underground Belt Detector
- **Author:** slava-class
- **Category:** Utilities
- **Tags:** none
- **Release:** declared in `info.json`; not published by local preparation
- **Factorio:** 2.1, minimum build 2.1.20
- **Required mod:** base only
- **Optional:** Space Age; FactorioTest 3.1.0 or later for development; Location Location Location 1.2.0 or later if enabled
- **License:** MIT
- **Source:** [slava-class/location-location-location](https://github.com/slava-class/location-location-location)

## Description

**See which way your underground belts actually run.**

If the ordinary belts immediately outside both mouths point against a connected underground pair, orange arrows show the underground's actual direction. Strong mouth arrows and smaller span arrows make the problem visible without rotating anything.

### Features

- Checks all four directions and available underground-belt tiers.
- Surveys existing factories on installation/configuration change, then responds to local construction, rotation, removal and replacement events.
- Pulsing arrows by default, with per-player **Steady** and **Off** modes.
- Hovering either mouth hides only that connection's span in your view, leaving stock indicators clear and other players unaffected.
- Optional per-player map alerts, **on by default**, with separately clickable entrance and exit entries.
- Bounded background validation: at most 64 queued mouths per tick. Initial surveys, construction bursts, animation and alert renewal have separate costs.

This is a narrow direction check, not a general belt validator. Unpaired mouths, missing exterior belts, turns and side-loading arrangements without opposing belts at both mouths are not flagged. Other mods' custom alerts are preserved.

### Requirements

Requires **Factorio 2.1.20 or later within 2.1**. Space Age is optional; neither LLL nor Factorio Library is required. English, German, French, Spanish, Russian and Simplified Chinese are included.

If Location Location Location is installed too, use **1.2.0 or later**, which retires its embedded detector. This mod has separate alert/overlay preferences; it does not import LLL's old choices or private state.

### Credits

Maintained by [slava-class](https://github.com/slava-class), extracted from the underground-warning feature developed in Location Location Location. MIT licensed, with original repository attribution retained. Uses Factorio's stock core arrow artwork.
