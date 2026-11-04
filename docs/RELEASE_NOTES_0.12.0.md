# BookOrbit Sync 0.12.0

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant and has had limited testing on real hardware. See
> [KNOWN_ISSUES.md](https://github.com/Styxbleich/BookOrbit-Sync-for-Crosspoint/blob/main/KNOWN_ISSUES.md).

Adds highlight syncing to the reading-session sync from 0.9.x.

**New**
- **Send highlights** to BookOrbit from the settings page. Each highlight gets a
  real position in the book, so BookOrbit's web reader opens it at the right spot.
  Only the selected book's highlights are sent, and highlights BookOrbit already
  has are skipped.
- **Pull highlights** from BookOrbit (including ones made in its web reader) and
  list them on the page. **Save as text file** writes
  `BOOK NAME - AUTHOR Highlights.txt` next to the book.
- **Check book** confirms BookOrbit has the exact file and lists the reader's
  highlights for it before you send.
- **Recent books** dropdown, filled from the reader's own recent-books list, so
  there is no path to type. "Another book" is still there for anything else.
- Colour-coded result box (green, orange for "nothing to send", red for problems).
- The plugin version is shown under the card's title when it is expanded.

**Changed**
- The card, and the plugin's name in the reader's plugin list, is now "BookOrbit
  Sync" (it was "BookOrbit Reading Log").

**Notes**
- Highlights need the same file that BookOrbit has, and a computer or phone with
  the reader's Plugins page open. See the README and KNOWN_ISSUES for details and
  limits.
- Known problem (firmware): after a restart, sessions can be stamped in the
  future. See docs/FIRMWARE_CLOCK_ISSUE.md.

Install: Plugin Hub, or copy the contents of `bookorbit-sync.crosspoint-plugin/`
into a folder named `bookorbit-sync` on the SD card. Updating from 0.9.x should
keep your `config.json` (the payload does not include one); "Also send at sleep"
resets to off.
