# Known issues and limitations

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant. Treat everything below as the best understanding at the time of
> writing, not a guarantee, and tell us if something is wrong.

## How well is it tested?

- Tested against: a mock BookOrbit built from the server's source, BookOrbit's
  own session-derivation code, fake-DOM tests of the settings page, and a
  desktop browser.
- Tested on real hardware: an Xteink X4 Pro and an Xteink X3, one BookOrbit
  server, a short period. Delivery to BookOrbit worked on both. Other models
  (X4, X4 Classic) are untested. Several details below were worked out by
  reading CrossPoint's source and have **not** been confirmed on hardware.
- Not tested: other readers or firmware builds, Plugin Hub installs and updates,
  very long sessions, and many books over a long time.

## 1. Sessions can be stamped in the future after a restart (firmware)

**Symptom:** a session read on the reader shows up in BookOrbit hours or minutes
ahead of when you really read it ("last read: in 2 hours"), even though the
reader's Settings, Clock screen shows the correct time. This affects daily
totals, streaks and time-of-day achievements.

**Which devices:**

| Device | Chip | Result |
|---|---|---|
| Xteink X3 | ESP32-C3 | Correct times (tested) |
| Xteink X4 Pro | ESP32-S3 | Sessions stamped ahead of real time (tested) |
| Xteink X4 Classic (X4C) | ESP32-S3 | Not tested. Same board and build family as the X4 Pro, so it may be affected |
| Xteink X4 | ESP32-C3 | Not tested. Same chip family as the X3, so it may be fine |

This is one person's testing on one unit of each model that was tested, so
treat it as a clue, not a diagnosis. If you try another model, please say what
you saw, ideally in an issue on this repo.

**Cause (suspected, not confirmed):** the plugin sends the firmware's
`start_time`. The firmware takes it from a "trusted time" clock that never goes
backward and is restored from flash on every boot, and the reader restarts
itself quietly after WiFi activity. If the saved value ever got ahead of real
time, every restart puts the system clock ahead again, while the Clock screen
keeps showing the correct hardware clock. Details and code references:
[docs/FIRMWARE_CLOCK_ISSUE.md](docs/FIRMWARE_CLOCK_ISSUE.md).

**Why the X3 may not show it:** the X3 behaves correctly with the same plugin
and the same Plugin Hub install, so the plugin's own handling of times is not the
cause. The X4 Pro and X3 differ in chip and board, and the saved clock value is
stored per device, so it is either a bad saved value on that one unit or
something specific to the S3 models. This has not been narrowed down.

**What the plugin can do:** nothing. A plugin only receives the values the
firmware chooses to provide, and the request template cannot do arithmetic. The
other time value it receives (`ts`) comes from the same clock.

**Workarounds:** the stuck value stops mattering once real time passes it, so
waiting can fix it by itself. Delete the affected sessions in BookOrbit with the
trash icon in the Reading Log.

## 2. Needs firmware with the `reader.session` event

SD plugins and the `reader.session` event are not in a stable CrossPoint release
at the time of writing. Older firmware ignores the event and nothing is sent.

## 3. Delivery cannot be limited to the sync action

The firmware sends queued plugin events whenever the reader goes online: any WiFi
join, starting the web interface, the KOReader sync action, and sleep if
"Also send at sleep" is on. A plugin cannot choose among these, and there is no
way to hold sessions back. That also means `events.jsonl` (the queue) is usually
already empty by the time you look at it.

## 4. Credentials on the SD card

`config.json` stores the md5 of your KOReader sync password. BookOrbit accepts
that md5 as the key, so it works like a password for those endpoints, and it is
sent as a header on every request. Plugins cannot use the firmware's own
protected credential storage, so it cannot be encrypted or obscured. Use a
dedicated KOReader sync login, and https or a trusted network.

## 5. Setup is through the web interface or a JSON file

There is no on-reader setup screen, because plugins cannot add text entry to the
reader. A plugin also cannot add its own tab to the web interface's top bar; the
settings card lives on the Plugins page.

## 6. Book matching

BookOrbit matches the book by its partial-MD5, so the file on the reader must be
the same file BookOrbit has. If it is not, the server returns success but
ignores the session, and you get no warning.

## 7. Statistics based on pages

Each session is sent as two points with `totalPages: 10000` (progress in basis
points). Session time, streaks and progress percentages are derived from this
and should be right. Any BookOrbit statistic that counts pages may use the raw
10000 scale. This has not been checked in detail.

## 8. Queue limits and updates

- Each plugin's queue holds about 4 KB (roughly a dozen sessions); beyond that
  the oldest are dropped. Sync now and then.
- Updating the plugin from Plugin Hub replaces `device.json`, which resets
  "Also send at sleep" to off. `config.json` is not part of the payload, so it
  should be left alone, but this has not been tested.
- If the plugin folder on the SD card is named `bookorbit-sync.crosspoint-plugin`
  (a manual copy of the repository folder), the firmware never queues events for
  it because the name is longer than 23 bytes. Rename it to `bookorbit-sync`.

## 9. It relies on BookOrbit's KOReader plugin API

This uses the same endpoints as BookOrbit's own KOReader plugin. They are not a
public, versioned API for third parties and could change.

## 10. Small things not verified on hardware

The "BookOrbit: session sent" popup, the sleep-time delivery path on current
firmware, and the behaviour on devices without a battery-backed clock.
