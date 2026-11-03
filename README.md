# CrossPoint Plugin: BookOrbit Reading Log Sync

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant (Claude, by Anthropic) and tested mostly against mock servers, the
> BookOrbit source code and a desktop browser, with limited testing on one real
> reader. Expect rough edges. Read the [known issues](KNOWN_ISSUES.md) and review
> the code before you trust it with your BookOrbit login. You use it at your own
> risk, and bug reports and fixes are welcome.

A [CrossPoint](https://github.com/crosspoint-reader/crosspoint-reader) SD-card
plugin that sends each reading session to a self-hosted
[BookOrbit](https://github.com/bookorbit/bookorbit) server, so reading on the
device shows up in BookOrbit's reading log, streaks and stats. No relay, extra
service or firmware build is needed.

Not affiliated with CrossPoint or BookOrbit.

## Why this exists

CrossPoint's KOReader sync (KOSync) only moves your reading *position*. BookOrbit
builds its reading log, streaks and stats from per-page events
(`POST /api/v1/koreader/plugin/page-stats`), which KOSync never sends.
CrossPoint can now give plugins a `reader.session` event (start time, active
duration, start and end progress, and the book's partial-MD5). This plugin's
request template turns each session into two page events and posts them
straight to BookOrbit.

## Requirements

- A CrossPoint build that has SD plugins and the `reader.session` plugin event.
  At the time of writing that is the develop branch, not a stable release (see
  crosspoint-reader issue #2612).
- A BookOrbit server you can reach from the reader's WiFi, and a **KOReader sync**
  login for it (BookOrbit: Settings, Devices & Sync, KOReader). This is separate
  from your BookOrbit web login.
- The book on the reader must be the same file BookOrbit has (same partial-MD5).
  Books downloaded from BookOrbit's catalog match.

## Install

**Plugin Hub:** search for "BookOrbit Reading Log" and install it.

**Manually:** copy the *contents* of `bookorbit-sync.crosspoint-plugin/` into a
folder named exactly `bookorbit-sync` on the SD card, for example
`/.crosspoint/plugins/bookorbit-sync/` or `/plugins/bookorbit-sync/`.
Do not keep the `.crosspoint-plugin` suffix on the SD card: the firmware only
queues plugin events for folder names of 23 bytes or fewer, and
`bookorbit-sync.crosspoint-plugin` is 32.

Then:

1. Turn on Settings, Connectivity, Plugins on the reader, and restart it.
2. Connect the reader to your network and open its web interface in a browser.
3. On the **Plugins** page, open the **BookOrbit Reading Log** card (it is
   shown first). Enter your server URL, KOReader sync username and password, and
   a device name. Press **Test connection**, then **Save**. This writes
   `config.json` next to the plugin; only the md5 of the password is stored.
4. Read. Sessions are queued on the SD card and sent the next time the reader
   goes online, for example with your usual KOReader sync action (long-press or
   reader menu, Sync progress). Optionally tick **Also send at sleep** on the
   card to send automatically when the reader sleeps.

Prefer files? Copy `config.example.json` to `config.json` and fill it in.

## How it behaves

- The firmware decides what counts as reading: forward page turns held for at
  least 2 seconds, at least 10 active seconds per summary, idle gaps removed.
- Sessions are delivered whenever the reader goes online, by any route (any WiFi
  join, the web interface, the KOReader sync action, or sleep if enabled). The
  plugin cannot limit it to one of them.
- Redelivery is safe: BookOrbit ignores events it already has. Unknown books are
  accepted and silently ignored by the server.
- The progress scale is 10000 (basis points). Session time, streak and session
  progress should be exact; per-page statistics may use the raw scale.
- BookOrbit lists the reader as its own device (the device name you chose).

## Known issues

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). The most important one is a **firmware**
clock problem that can stamp new sessions in the future after a restart; see
[docs/FIRMWARE_CLOCK_ISSUE.md](docs/FIRMWARE_CLOCK_ISSUE.md). The plugin cannot
fix it.

## Security

- `config.json` holds your KOReader sync login on the SD card: the md5 of the
  password, which BookOrbit accepts as the key. Anyone with the card can use it
  against BookOrbit's KOReader sync endpoints. Use a dedicated sync login you can
  change, and prefer https or a trusted network, because it is sent as headers.
- The settings page runs inside the reader's web interface without a sandbox, so
  review `plugin.js` before installing any browser plugin, this one included.
- Never commit your own `config.json` (it is in `.gitignore`).

## Repository layout

- `bookorbit-sync.crosspoint-plugin/`: the installable payload (Plugin Hub reads
  only this folder).
- `tests/`: development tests. Run them with
  `python3 -m unittest discover -s tests -v` and
  `node --test tests/test_plugin_js.mjs`. They render `device.json` the way the
  firmware does and send it to a mock BookOrbit that mirrors the server's
  validation, dedupe and session derivation; they check the settings page
  against a fake DOM, and check the Plugin Hub manifest rules. The generated
  events were also run through BookOrbit's own `deriveKoreaderSessions`.
- `docs/`: the firmware clock issue write-up, release notes and publishing steps.

## License

MIT, see [LICENSE](LICENSE).
