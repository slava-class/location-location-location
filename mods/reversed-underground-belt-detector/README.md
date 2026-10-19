# Reversed Underground Belt Detector

**See which way your underground belts actually run.**

When the ordinary belts immediately outside both mouths point against a connected underground pair, strong orange arrows mark its mouths and smaller, muted arrows mark its underground span. The arrows point in the underground belt's **actual direction**. Nothing is rotated or built automatically.

## Preferences

Both settings are under **Settings → Mod settings → Per player**:

| Setting                                       | Choices                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Map alerts for reversed underground belts** | **On by default**; disable clickable map alerts independently of the arrows.                                         |
| **Underground warning overlay**               | **Pulsing** (default), **Steady (no pulse)**, or **Off**. Changes apply without a restart and affect only your view. |

The default overlay breathes over a 3.6-second cycle without blinking off. Only opacity changes; its orange hue stays fixed. Mouth warnings remain larger and stronger than interior arrows.

Hovering an underground entrance or exit hides **only that connection's span** in your view so Factorio's stock indicators remain clear. Mouth warnings remain visible. Ordinary belts, splitters and unrelated underground mouths do not hide the span; other players' views are unaffected.

Map alerts have separate clickable **entrance** and **exit** entries for each connection. Another mod's custom alerts are preserved. Alerts cover your force's charted areas and its own space platforms.

## What is checked

All four directions and the available belt tiers are supported. Existing factories are surveyed when the mod is added or its configuration changes. Building, rotating, mining or replacing belts queues the affected neighborhood for the following simulation tick, including a pair's previous partner after disconnection or relinking. Correcting the flow clears its warnings.

This is deliberately a narrow direction check, not a general belt validator. Unpaired undergrounds, missing exterior belts, turns and side-loading layouts without opposing belts at both mouths are not flagged.

Background validation selects at most **64 queued mouth entries per tick**. Up to 1,920 flagged connections can complete a validation cycle within 60 ticks; larger populations take longer rather than losing checks. Map alerts retain a separate once-per-second renewal. Silent changes by another script can therefore take a validation cycle plus an alert-renewal cycle to disappear from the map alert list.

That is a background-validation budget, **not a blanket UPS guarantee**: installation/configuration surveys, construction bursts, pulse rendering and alert renewal are separate work.

## Requirements and installation

- Factorio **2.1**, minimum build **2.1.20**.
- Mod ID: `reversed-underground-belt-detector`.
- Neither Location Location Location nor Factorio Library is required.
- Space Age is optional. FactorioTest 3.1.0 or later is optional for development only.
- If Location Location Location is also enabled, it must be **1.2.0 or later**. Older versions embed another detector and are deliberately rejected.

For manual installation, use `reversed-underground-belt-detector_<version>.zip` in Factorio's `mods` directory. This checkout prepares the initial 1.0.0 release locally; it does not imply a published Portal listing or release.

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

Native scenes require the explicit standalone full client. Presentation captures, including thumbnail and pulse frames, use Extreme in an isolated profile. Development tuners and fixtures are excluded from release archives. Local verification/preparation does not install into the normal game, commit or publish.

The [migration checklist](../../MONOREPO_MIGRATION_PLAN.md#b-extract-detector-and-retire-llls-implementation) records completed and pending acceptance, including upgrade, exact-package behavior, performance and multiplayer limits. A passing package-startup smoke alone does not prove detection or cleanup.

## Credits and license

Maintained by [slava-class](https://github.com/slava-class). Extracted from the underground-warning feature developed in Location Location Location. Original repository attribution is retained in [the MIT license](license.txt); this detector contains no Factory Planner picker or flib runtime dependency. Its arrow artwork comes from Factorio's stock core assets and is referenced, not redistributed.
