# Known issues and limitations

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant. Treat everything below as the best understanding at the time of
> writing, not a guarantee, and tell us if something is wrong.

## How well is it tested?

- Tested against: a mock BookOrbit built from the server's source, BookOrbit's
  own session-derivation code, fake-DOM tests of the settings page, and a
  desktop browser.
- Tested on real hardware: an Xteink X4 Pro and an Xteink X3, one BookOrbit
  server, a short period. Session delivery to BookOrbit worked on both. The
  highlights features were tried on the X4 Pro with a few highlights in one
  book (sending, the position opening correctly in BookOrbit's web reader,
  pulling, saving the text file and the recent-books list). Other models
  (X4 and others) are untested. The X4C has no clock chip and is not supported. Several details below were worked out by
  reading CrossPoint's source and have **not** been confirmed on hardware.
- Not tested: other readers or firmware builds, Plugin Hub updates from an older
  version, very long sessions, many books over a long time, books with hundreds of
  highlights, and highlight edits or deletions made after sending.

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
**Update:** on the X4 Pro, the future-dated sessions were seen early in testing and later stopped, with no change in firmware version. That fits the suspected cause below (a saved clock value that was ahead of real time and stopped mattering once real time passed it), but it has not been confirmed. It may be specific to one unit, or it may come back after a restart.
| Xteink X4C | reported as ESP32-C3 rev4 by its owner | No clock chip (no Clock option in Settings). Not supported, see issue 2 |
| Xteink X4 | ESP32-C3 | Not tested. If it has no clock chip, see issue 2 |

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

## 2. Needs a reader with a clock chip

The firmware only records a reading session when it has a valid time. Readers
with a battery-backed clock chip (the Xteink X3 and X4 Pro have one; you can tell
because **Settings has a Clock option**) keep time while powered off. Readers
without one, such as the Xteink X4C, have no Clock option and rely on internet
time, which is lost at power-off. On those readers sessions may not be recorded
at all, or may carry a stale time, so this plugin is **not supported** on them.
This comes from reading the firmware source plus one owner's report that the X4C
has no clock; it has not been tested end to end. Reports are welcome.

## 3. Needs firmware with the `reader.session` event

SD plugins and the `reader.session` event are part of CrossPoint 2.0. Older
firmware ignores the event and nothing is sent.

## 4. Delivery cannot be limited to the sync action

The firmware sends queued plugin events whenever the reader goes online: any WiFi
join, starting the web interface, the KOReader sync action, and sleep if
"Also send at sleep" is on. A plugin cannot choose among these, and there is no
way to hold sessions back. That also means `events.jsonl` (the queue) is usually
already empty by the time you look at it.

## 5. Credentials on the SD card

`config.json` stores the md5 of your KOReader sync password. BookOrbit accepts
that md5 as the key, so it works like a password for those endpoints, and it is
sent as a header on every request. Plugins cannot use the firmware's own
protected credential storage, so it cannot be encrypted or obscured. Use a
dedicated KOReader sync login, and https or a trusted network.

## 6. Setup is through the web interface or a JSON file

There is no on-reader setup screen, because plugins cannot add text entry to the
reader. A plugin also cannot add its own tab to the web interface's top bar; the
settings card lives on the Plugins page.

## 7. Book matching

BookOrbit matches the book by its partial-MD5, so the file on the reader must be
the same file BookOrbit has. If it is not, the server returns success but
ignores the session, and you get no warning.

## 8. Statistics based on pages

Each session is sent as two points with `totalPages: 10000` (progress in basis
points). Session time, streaks and progress percentages are derived from this
and should be right. Any BookOrbit statistic that counts pages may use the raw
10000 scale. This has not been checked in detail.

## 9. Queue limits and updates

- Each plugin's queue holds about 4 KB (roughly a dozen sessions); beyond that
  the oldest are dropped. Sync now and then.
- Updating the plugin from Plugin Hub replaces `device.json`, which resets
  "Also send at sleep" to off. `config.json` is not part of the payload, so it
  should be left alone, but this has not been tested.
- If the plugin folder on the SD card is named `bookorbit-sync.crosspoint-plugin`
  (a manual copy of the repository folder), the firmware never queues events for
  it because the name is longer than 23 bytes. Rename it to `bookorbit-sync`.

## 10. It relies on BookOrbit's KOReader plugin API

This uses the same endpoints as BookOrbit's own KOReader plugin. They are not a
public, versioned API for third parties and could change.

## 11. Small things not verified on hardware

The "BookOrbit: session sent" popup, the sleep-time delivery path on current
firmware, and the behaviour on devices without a battery-backed clock.

## 12. Highlights

The highlights feature runs from the settings page in your browser when you press
a button; it is not automatic, because plugin events cannot read files.

- **Same file required.** BookOrbit only accepts highlights for the exact file it
  has. If you changed the file's metadata inside BookOrbit, the copy on the reader
  no longer matches and the result says the file differs. Download it again.
- **Matched by book title.** The plugin sends the highlights in `/My Clippings.txt`
  whose title matches the selected book's title (from the EPUB or the reader's
  recent list). If the reader wrote a different title, nothing is sent and the box
  says so. It never sends another book's highlights.
- **Finding the spot.** BookOrbit needs a position inside the book, which the
  reader does not store in that form, so the plugin searches the EPUB for the
  highlighted text. A quote that appears more than once is placed in the chapter
  named in the highlight, or else at its first match (the result box warns when
  that happens). Text that cannot be found (for example a highlight spanning
  something unusual in the markup) is still sent, but shows "Anchor lost" in the
  web reader. Highlights that are only partly found are flagged as approximate.
  The reader also stores the section number and paragraph for each highlight,
  which could make this exact; the plugin does not use them yet.
- **Slow on big books.** The EPUB is read through the reader's web server, one
  chapter at a time in your browser, so large books can take a while.
- **Recent books only.** The dropdown is the reader's list of its last 10 opened
  EPUBs; finished books drop off it. Use "Another book (type its path)" for any
  other book.
- **One way, and no clean-up.** Sending adds highlights to BookOrbit. Editing or
  deleting a highlight on the reader afterwards does not change BookOrbit, and
  edits or deletions in BookOrbit do not change the reader. Pulling does not put
  highlights into the reader's own highlight list; it only shows them and saves a
  text file.
- **How pulling works.** BookOrbit's plugin login has no plain "list highlights"
  call, so pulling uses its device sync exchange: it presents the book as an empty
  copy and acknowledges each page of results. It keeps its own sync record per
  book copy on the server. Nothing odd has been seen, but long-term effects on
  BookOrbit's sync state have not been studied.
- **Text file limit.** The reader accepts files up to about 250 KB from a plugin.
  If a book has more highlights than fit, the first ones that fit are saved and the
  box says how many.
- **Highlight times.** The time of a highlight comes from the reader's own clock,
  so a reader with a wrong clock (see issue 1) can show wrong times.
- **Highlight limits on the reader.** CrossPoint itself caps the number of
  highlights per book (256 on ESP32-C3 readers, 1024 on ESP32-S3 readers, from its
  source).
