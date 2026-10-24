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
- A selection tool lets you mark deliberate caps and other false positives as intentional, individually or in bulk, without hiding future warnings.

### What it catches

The mod looks for an underground connection whose direction or entrance/exit arrangement conflicts with an attached surface belt. It can also catch aligned mouths that should connect but face the wrong way—even before Factorio pairs them. One attached belt is enough to indicate the intended flow; if belts at both ends disagree, the mod does not guess.

This is a direction check, not a general belt validator. A lone unpaired mouth is not an error. Possible partners must be nearby, compatible and unambiguous; perpendicular crossings and mouths already connected elsewhere are left alone. Arrows show the mouths' actual directions, and an underground span is drawn only for a real connection. Other mods' alerts are preserved.

### Intentional connections

Choose **Manage underground warnings** from the shortcut bar. Drag over either end of a highlighted connection to mark it as intentional; **Shift-drag** restores its warnings. You can select several connections at once. Nothing is crafted, rotated or removed.

While holding the tool, acknowledged connections have white check marks and active warnings have steady arrows. Put it away to return to your usual overlay. Acknowledgements are shared by your force and saved with the game. They apply to that arrangement—not an area—and are reconsidered when the connection or its relevant surface-belt flow changes.

### Requirements

Requires **Factorio 2.1.20 or later within 2.1**. Space Age is optional; neither LLL nor Factorio Library is required. English, German, French, Spanish, Russian and Simplified Chinese are included.

If Location Location Location is installed too, use **1.2.0 or later**, which retires its embedded detector. This mod has separate alert/overlay preferences; it does not import LLL's old choices or private state.

### Credits

Maintained by [slava-class](https://github.com/slava-class), extracted from the underground-warning feature developed in Location Location Location. MIT licensed, with original repository attribution retained. Uses Factorio's stock core arrow artwork.
