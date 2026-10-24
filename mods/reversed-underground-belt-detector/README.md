# Reversed Underground Belt Detector

**See which way your underground belts actually run.**

When surface-belt flow conflicts with an underground connection, strong orange arrows mark both mouths. This includes nearby compatible mouths whose directions or entrance/exit roles prevent them from connecting. Arrows show each mouth's **actual direction**; smaller, muted arrows show the span only when Factorio actually connects the pair. Nothing is rotated or built automatically.

## Intentional caps and other false positives

Use **Manage underground warnings** in the shortcut bar (enable it in the shortcut list if hidden). It gives you a free selection tool; there is nothing to craft and no new keybind to learn.

- **Drag** over either mouth to mark that connection as intentional. Select several connections to acknowledge them together.
- **Shift-drag** to restore warnings. The on-screen hint follows your configured selection controls.
- While holding the tool, active warnings show steady arrows even if your normal overlay is off. Acknowledged connections show white check marks. Put the tool away to remove the hint/check marks and restore your normal overlay.

Acknowledgements clear both mouths' arrows and map alerts for your force and survive saving, loading and configuration changes. They apply only to the existing connection, never to a whole area or future warnings. Changing a mouth, counterpart, endpoint direction/role, force or relevant exterior-belt flow makes the connection eligible for warnings again. Item movement and unrelated nearby construction do not reset it.

## Preferences

Both settings are under **Settings → Mod settings → Per player**:

| Setting                                       | Choices                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Map alerts for reversed underground belts** | **On by default**; disable clickable map alerts independently of the arrows.                                         |
| **Underground warning overlay**               | **Pulsing** (default), **Steady (no pulse)**, or **Off**. Changes apply without a restart and affect only your view. |

The default overlay breathes over a 3.6-second cycle without blinking off. Only opacity changes; its orange hue stays fixed. Mouth warnings remain larger and stronger than interior arrows.

Hovering an underground entrance or exit hides **only that connection's span** in your view so Factorio's stock indicators remain clear. Mouth warnings remain visible. Ordinary belts, splitters and unrelated underground mouths do not hide the span; other players' views are unaffected.

Map alerts have separate clickable entries for both implicated mouths, labelled by their current **entrance** or **exit** role. Another mod's custom alerts are preserved. Alerts cover your force's charted areas and its own space platforms.

## What is checked

All four directions and the available belt tiers are supported. Existing factories are surveyed when the mod is added or its configuration changes. Building, rotating, mining or replacing belts queues the affected neighborhood for the following simulation tick, including a pair's previous partner after disconnection or relinking. Correcting the flow clears its warnings.

At least one ordinary belt must meet the exposed side of a mouth and point along the possible connection. Its direction supplies the intended flow; if both exterior belts are present, they must agree. Unconnected mouths must be aligned, of the same type and force, within native reach, and uniquely identify each other as the nearest plausible partner. A nearer compatible mouth blocks a farther candidate. Correctly paired mouths elsewhere, ambiguous candidates, perpendicular crossings and belts behind a hood are left alone. Being unpaired is not itself a fault.

Background validation selects at most **64 queued mouth entries per tick**, including acknowledged connections so changes are still detected. Up to 1,920 detected connections can complete a validation cycle within 60 ticks; larger populations take longer rather than losing checks. Map alerts retain a separate once-per-second renewal. Silent changes by another script can therefore take a validation cycle plus an alert-renewal cycle to appear in or disappear from the map alert list.

That is a background-validation budget, **not a blanket UPS guarantee**: installation/configuration surveys, construction bursts, pulse rendering and alert renewal are separate work.

## Requirements and installation

- Factorio **2.1**, minimum build **2.1.20**.
- Mod ID: `reversed-underground-belt-detector`.
- Neither Location Location Location nor Factorio Library is required.
- Space Age is optional. FactorioTest 3.1.0 or later is optional for development only.
- If Location Location Location is also enabled, it must be **1.2.0 or later**. Older versions embed another detector and are deliberately rejected.

For manual installation, put `reversed-underground-belt-detector_<version>.zip` in Factorio's `mods` directory and enable it.

### Moving from Location Location Location

LLL 1.2.0 retires its embedded detector while retaining planner data. Enable this separate mod to keep underground warnings. Its alerts and overlay mode are **new, separate preferences**: old LLL preferences and private detector state are not imported. Choose your preferred settings once; subsequent updates preserve the new mod's saved choices. Back up saves before changing installed mods.

## Development

Use the [shared developer guide](../../tools/README.md#setup) for explicit bootstrap and engine provisioning. From the repository root:

- `mise run verify -- reversed-underground-belt-detector`
- `mise run test -- reversed-underground-belt-detector --profile base`
- `mise run test -- reversed-underground-belt-detector --profile space-age`
- `mise run test-ui -- reversed-underground-belt-detector --language en`
- `mise run gallery -- reversed-underground-belt-detector --language en`
- `mise run package-smoke -- reversed-underground-belt-detector`
- `mise run release-prepare -- reversed-underground-belt-detector --language en`

Native scenes require the explicit standalone full client. Routine `test-ui` runs use Low graphics; pass `--graphics extreme` when fixing graphical issues or generating final thumbnail/pulse assets. Diagnostic captures from Low runs must not become presentation assets. Gallery and release preparation require Extreme in an isolated profile. Development tuners and fixtures are excluded from release archives. Local verification/preparation does not install into the normal game, commit or publish.

The [architecture notes](../../ARCHITECTURE.md#release-and-human-gates) retain the public-release gates, including real two-client multiplayer proof. [Product guidance](AGENTS.md) records implementation and regression constraints. A passing package-startup smoke alone does not prove detection or cleanup.

## Credits and license

Maintained by [slava-class](https://github.com/slava-class). Extracted from the underground-warning feature developed in Location Location Location. Original repository attribution is retained in [the MIT license](license.txt); this detector contains no Factory Planner picker or flib runtime dependency. Its arrow artwork comes from Factorio's stock core assets and is referenced, not redistributed.
