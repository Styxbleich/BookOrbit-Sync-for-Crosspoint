# CrossPoint Plugin: BookOrbit Reading Log Sync 0.9.0

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant and has had limited testing on real hardware. See
> [KNOWN_ISSUES.md](https://github.com/OWNER/REPO/blob/main/KNOWN_ISSUES.md).

First public release. Sends each reading session from CrossPoint to a
self-hosted BookOrbit server so it appears in the reading log, streaks and stats.

- Web settings card on the Plugins page: server URL, KOReader sync login, device
  name, Test connection, Save. Collapses once set up.
- Sessions are queued on the SD card and sent when the reader goes online (for
  example with your usual KOReader sync action). Optional "Also send at sleep".
- Needs a CrossPoint build with SD plugins and the `reader.session` event.

Known problem (firmware): after a restart, sessions can be stamped in the future.
See docs/FIRMWARE_CLOCK_ISSUE.md.

Install: Plugin Hub, or copy the contents of `bookorbit-sync.crosspoint-plugin/`
into a folder named `bookorbit-sync` on the SD card.
