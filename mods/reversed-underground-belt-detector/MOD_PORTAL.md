# Reversed Underground Belt Detector

- **Category:** Utilities
- **License:** MIT
- **Source:** [slava-class/location-location-location](https://github.com/slava-class/location-location-location)

## Description

Underground belts can end up facing the wrong way while you're building or rearranging your factory. In a busy spaghetti base, a reversed connection is easy to overlook.

Reversed Underground Belt Detector marks these connections with orange direction arrows and adds a map alert so you can find and fix them. Alerts are on by default. The mod does not rotate or change your belts.

### Features

- Map alerts are **on by default**, with clickable entries for both ends of the connection. You can turn them off independently of the arrows.
- Orange arrows pulse by default, with **Steady** and **Off** options in your per-player settings.
- Checks your existing factory when added to a save and keeps watching as you build and rearrange belts.
- Works in all four directions and across available underground-belt tiers.
- Hovering either end hides that connection's span arrows in your view, so the game's own indicators stay clear.

### What it catches

The mod flags a connected underground pair when the ordinary belts immediately outside **both ends** point against the underground's actual direction.

This is a direction check, not a general belt validator. Unpaired ends, missing exterior belts, turns and side-loading arrangements without opposing belts at both ends are not flagged. Other mods' alerts are preserved.

### Requirements

Requires **Factorio 2.1.20 or later within 2.1**. Space Age is optional; neither LLL nor Factorio Library is required. English, German, French, Spanish, Russian and Simplified Chinese are included.

If Location Location Location is installed too, use **1.2.0 or later**, which retires its embedded detector. This mod has separate alert/overlay preferences; it does not import LLL's old choices or private state.

### Credits

Maintained by [slava-class](https://github.com/slava-class), extracted from the underground-warning feature developed in Location Location Location. MIT licensed, with original repository attribution retained. Uses Factorio's stock core arrow artwork.
