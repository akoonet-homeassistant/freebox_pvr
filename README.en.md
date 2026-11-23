# Freebox PVR

[🇫🇷 Français](README.md) | 🇬🇧 English

Schedule TV recordings on your Freebox (Revolution, Mini 4K, Delta, Pop, Ultra) from Home Assistant, straight from the [Programme TNT FR](https://github.com/cyclope205/programme-tnt-fr) TV guide.

> Free flags the Freebox OS recording (PVR) API as "unstable": it may change without notice.

## Features

- `freebox_pvr.record` action: records the current, next, prime time or second-part program of a Programme TNT FR sensor, or a program given by hand (channel, title, start, end).
- `freebox_pvr.cancel` action: cancels a scheduled recording, by ID or by program.
- Automatic Freebox channel lookup from the guide name (accents, "+", "HD"… handled), with optional manual matches.
- Adjustable margins before and after, selectable stream quality.
- No duplicates: a second call for the same program returns the existing recording.
- A program that has already started is recorded from now on.

## Installation

1. HACS → Integrations → ⋮ → Custom repositories → `https://github.com/akoonet-homeassistant/freebox_pvr` (category Integration).
2. Install **Freebox PVR** and restart Home Assistant.
3. Settings → Devices & services → Add integration → **Freebox PVR**.

## Setup

1. Enter the Freebox address. For the first setup, use the local address `mafreebox.freebox.fr` (port 443): a new app can only be authorized from the local network.
2. Click **Submit**, then within a minute press the **right arrow** on the Freebox Server screen.
3. In Freebox OS → **Freebox settings → Access management → Applications**, open "Home Assistant - Freebox PVR" and grant the **TV recording (PVR)** permission.
4. Back in Home Assistant, click **Submit** again.

### Options

| Option | Default | Purpose |
|---|---|---|
| Margin before | 5 min | Minutes recorded before the start |
| Margin after | 10 min | Minutes recorded after the end |
| Quality | Automatic | Automatic, HD, SD or low definition |
| Channel matches | empty | One per line: `Guide name = Freebox name` (or `uuid-webtv-…`) |

## Entities

Entity IDs follow the Home Assistant language; in English:

| Entity | Description |
|---|---|
| `sensor.freebox_pvr_scheduled_recordings` | Number of upcoming or running recordings; `records` attribute with the list (id, title, channel, start, end, state, conflict) |
| `sensor.freebox_pvr_next_recording` | Start time of the next recording (margin included) |
| `binary_sensor.freebox_pvr_recording_in_progress` | On while recording |

## Actions

### `freebox_pvr.record`

| Field | Description |
|---|---|
| `entity_id` | Programme TNT FR sensor (e.g. `sensor.programme_tnt_fr_tf1`) |
| `slot` | `current`, `next`, `prime_time` or `second_part` |
| `channel_name`, `title`, `subtitle`, `start`, `end` | Instead of the sensor (or to override a value) |
| `channel_uuid` | Freebox channel ID, skips name matching |
| `margin_before`, `margin_after`, `quality` | Override the options for this recording |

Response: `record_id`, `already_programmed`, `channel_name`, `start`, `end`, `conflict`.

```yaml
action: freebox_pvr.record
data:
  entity_id: sensor.programme_tnt_fr_france_2
  slot: prime_time
```

### `freebox_pvr.cancel`

By ID (`record_id`) or by program (`entity_id` + `slot`, or `channel_name` + `start`).

### `freebox_pvr.refresh_channels`

Reloads the Freebox channel list (done automatically every 6 hours).

## Dashboard example

Until the Programme TNT FR card gets a "Record" button in its program view:

```yaml
type: button
name: Record France 2 prime time
icon: mdi:record-rec
tap_action:
  action: perform-action
  perform_action: freebox_pvr.record
  data:
    entity_id: sensor.programme_tnt_fr_france_2
    slot: prime_time
  confirmation:
    text: Schedule the recording on the Freebox?
```

## Security

- The app token is stored in `.storage/freebox_pvr/` (like the official Freebox integration). It is deleted when the integration is removed; also revoke the app in Freebox OS.
- Traffic uses HTTPS with certificate verification (system certificates + Freebox authority).
- Only the TV recording (PVR) permission is needed: you can remove the other permissions granted by default.
