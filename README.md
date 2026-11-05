# BookOrbit Sync

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant (Claude, by Anthropic) and tested mostly against mock servers, the
> BookOrbit source code and a desktop browser, with limited testing on two real
> readers (an Xteink X3 and an X4 Pro) and one BookOrbit server. Expect rough
> edges. Read the [known issues](KNOWN_ISSUES.md) and review the code before you
> trust it with your BookOrbit login. You use it at your own risk, and bug
> reports and fixes are welcome.

A [CrossPoint](https://github.com/crosspoint-reader/crosspoint-reader) SD-card
plugin that connects the reader to a self-hosted
[BookOrbit](https://github.com/bookorbit/bookorbit) server. No relay, extra
service or firmware build is needed.

Not affiliated with CrossPoint or BookOrbit.

## What it does

- **Reading sessions.** Every reading session on the reader is sent to BookOrbit,
  so the reading log, streaks and stats update. This happens by itself, with no
  button to press.
- **Two-way highlight sync.** Highlights go both ways: the reader's to BookOrbit
  (**Send highlights**) and BookOrbit's to the reader (**Add to reader**).
  Nothing is duplicated, and both run when you press the button on the settings
  page, not in the background.
- **BookOrbit is the source of truth.** After a pull, any highlight that is on
  the reader but not in BookOrbit is listed, with a button to delete it from the
  reader (one at a time, or all of them). BookOrbit is never changed by this.
- **Send highlights.** Highlights you make on the reader are sent to BookOrbit,
  each with a real position in the book, so BookOrbit's web reader opens the
  highlight at the right spot ("Open at this page") instead of showing "Anchor
  lost".
- **Pull highlights.** Highlights that BookOrbit holds for a book, including ones
  made in its web reader or on another device, are listed on the settings page
  and can then be added to the reader.
- **Add to reader.** After pulling, **Add to reader** puts those
  highlights into the reader's own highlights for the book, so highlights made in
  BookOrbit's web reader or on another device show up in the book on the device.
  Highlights already on the reader are never changed.
- **Choose a book from a list.** The settings page offers the books you opened
  recently on the reader, so you do not need to type a path.

Everything is set up from one card on the reader's **Plugins** web page.

## Why this exists

CrossPoint's KOReader sync (KOSync) only moves your reading *position*. BookOrbit
builds its reading log, streaks and stats from per-page events
(`POST /api/v1/koreader/plugin/page-stats`), which KOSync never sends.
CrossPoint can give plugins a `reader.session` event (start time, active
duration, start and end progress, and the book's partial-MD5). This plugin's
request template turns each session into two page events and posts them
straight to BookOrbit.

Highlights need more than a template can do (they have to be read from files and
searched for inside the book), so they run in the plugin's settings page, in
your browser, when you press a button. See [Highlights](#highlights).

## How this fits with CrossPoint's KOReader sync

These are separate features, and you can use any or all:

- **CrossPoint's built-in KOReader sync (KOSync)** keeps your reading position
  (page and percentage) in sync with BookOrbit. This plugin does not do that.
- **This plugin** sends your reading sessions (time, duration, progress) so
  BookOrbit's reading log, streaks and stats update, and it syncs highlights.
  It does not need KOSync to be turned on.

For position, stats and highlights, set up KOSync in CrossPoint's settings **and**
install this plugin. They use the same BookOrbit KOReader sync login, but each is
configured separately: KOSync in the reader's settings, the plugin on its web
settings card.

## Requirements

- CrossPoint firmware 2.0 or newer, which has SD plugins and the
  `reader.session` plugin event. Older firmware ignores the event and nothing is
  sent.
- A reader with a clock chip: **Settings has a Clock option** (for example the
  Xteink X3 and X4 Pro). Readers without one, such as the original Xteink X4, are not supported;
  see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- A BookOrbit server you can reach from the reader's WiFi, and a **KOReader sync**
  login for it (BookOrbit: Settings, Devices & Sync, KOReader). This is separate
  from your BookOrbit web login. Turning on CrossPoint's own KOReader sync is
  optional and only adds position sync; see "How this fits with CrossPoint's
  KOReader sync" above.
- The book on the reader must be the **same file** BookOrbit has (same
  partial-MD5). Books downloaded from BookOrbit's catalog match. If you later
  change the file's metadata inside BookOrbit, the copy on the reader no longer
  matches until you download it again.
- For highlights: a computer or phone on the same network as the reader, with a
  browser that has the reader's Plugins page open.

## Install

**Plugin Hub:** search for "BookOrbit Sync" and install it.

**Manually:** copy the *contents* of `bookorbit-sync.crosspoint-plugin/` into a
folder named exactly `bookorbit-sync` on the SD card, for example
`/.crosspoint/plugins/bookorbit-sync/` or `/plugins/bookorbit-sync/`.
Do not keep the `.crosspoint-plugin` suffix on the SD card: the firmware only
queues plugin events for folder names of 23 bytes or fewer, and
`bookorbit-sync.crosspoint-plugin` is 32.

Then:

1. Turn on Settings, Connectivity, Plugins on the reader, and restart it.
2. Connect the reader to your network and open its web interface in a browser.
3. On the **Plugins** page, open the **BookOrbit Sync** card (it is shown first;
   click its title to expand it, and the version is shown just below the title).
   Enter your server URL, KOReader sync username and password, and a device name.
   Press **Test connection**, then **Save**. This writes `config.json` next to the
   plugin; only the md5 of the password is stored.
4. Read. Sessions are queued on the SD card and sent the next time the reader
   goes online, for example with your usual KOReader sync action (long-press or
   reader menu, Sync progress). Optionally tick **Also send at sleep** on the
   card to send automatically when the reader sleeps.

Prefer files? Copy `config.example.json` to `config.json` and fill it in.

## Reading sessions

- The firmware decides what counts as reading: forward page turns held for at
  least 2 seconds, at least 10 active seconds per summary, idle gaps removed.
- Sessions are delivered whenever the reader goes online, by any route (any WiFi
  join, the web interface, the KOReader sync action, or sleep if enabled). The
  plugin cannot limit it to one of them.
- Redelivery is safe: BookOrbit ignores events it already has. Unknown books are
  accepted and silently ignored by the server.
- The progress scale is 10000 (basis points). Session time, streak and session
  progress should be exact; per-page statistics may use the raw scale.
- The device name is an ID the plugin sends, to keep readers apart. It appears
  next to highlights in BookOrbit (Highlights tab, shown as "KOReader" plus the
  name), but not in BookOrbit's KOReader device list; that list comes from KOSync
  position sync, where CrossPoint always reports itself as "CrossPoint".

## Highlights

Open the **Highlights** section of the card. Highlights are done by you, from the
browser, when you want them; the reader cannot do it by itself in the
background.

1. **Recent books.** Pick the book. The list is the reader's own recent-books
   list (up to its 10 latest EPUBs, newest first, finished books drop off). The
   newest is selected for you. For any other book choose **Another book (type its
   path)** and enter its path on the SD card, for example
   `/Books/Author/Title.epub`.
2. **Check book.** Confirms BookOrbit has this exact file, and lists the
   highlights the reader has for the book so you can look them over. Nothing is
   sent.
3. **Send highlights.** Sends every highlight the reader has for the selected
   book, and only that book. Highlights BookOrbit already has are skipped, so
   pressing it again is safe. The result tells you how many were new, how many
   were found in the book, and whether any matched text that appears more than
   once.
4. **Pull highlights.** Lists the highlights BookOrbit has for the book, sorted
   by page, with chapter, page and notes, split into the ones not on the reader
   yet (what **Add to reader** will add) and the ones already on the reader and
   in BookOrbit. Pulling does not change anything on the reader.

5. **Add to reader.** Available after a pull. Adds the pulled highlights to the
   reader's own highlight file for the book, and writes matching entries to
   `/My Clippings.txt` in the reader's own format (creating it if it is
   missing). Anything on the reader that BookOrbit
   does not have is then listed, so you can delete it from the reader: a button
   per highlight and **Delete all**, each needing a second press to confirm.

The list on the page clears when you press any other button or choose another
book; **Add to reader** keeps it.

**Colours of the result box:** green is success, orange means nothing was wrong
but nothing was sent (for example everything is already in BookOrbit, or the
book has no highlights), red is a problem.

### How highlight sending works

- The reader exports your highlights to `/My Clippings.txt`. The plugin reads
  that file and picks the highlights whose book title matches the selected book
  (the title inside the EPUB, or the one in the reader's recent list). If nothing
  matches, nothing is sent.
- BookOrbit's web reader needs a KOReader-style position for each highlight. The
  reader does not store one in that form, so the plugin reads the EPUB through
  the reader's web server, finds the highlighted text in the book, and builds the
  position from where it sits in the book's markup. This can take a while on a
  large book. If a quote appears several times, the plugin prefers the chapter
  named in the highlight; if it still cannot tell, it uses the first match and
  says so. A highlight that cannot be found is still sent, but shows "Anchor
  lost" in BookOrbit's web reader.
- Highlights are only accepted for the exact file BookOrbit has. The result says
  so if the file differs.
- Deleting from the reader removes the highlight from the same file. BookOrbit
  is not touched. Before the plugin changes that file it saves a copy of it as
  `backup-epub_<number>.bin` in the plugin's folder (one copy per book, replaced
  each time). A highlight is treated as being in BookOrbit when its text matches,
  allowing for small differences in spacing or quotes. The reader's
  `/My Clippings.txt` only ever grows when you delete on the reader itself, so
  Send highlights ignores anything that is no longer in the reader's own
  highlights; a deleted highlight is not sent again. When this plugin deletes a
  highlight it also removes that book's matching entries from
  `/My Clippings.txt` (a copy is saved as `backup-My Clippings.txt` first).
- Add to reader writes the reader's own highlight file for the book,
  `/.crosspoint/clippings/epub_<number>.bin`, where the number is a hash of the
  book's path that the plugin works out the same way the firmware does. Each
  highlight is placed by its chapter and by how many characters of the chapter's
  text come before it. The plugin uses BookOrbit's own position when it gives one
  that really covers the highlighted text, and otherwise searches the book. A
  highlight is skipped if its text is not found, or appears more than once with no
  exact position, so it is never put in a guessed place. Existing highlights in the
  file are copied as they are, and nothing is written when there is nothing new.
  The reader holds at most 256 highlights per book (more on some models).
- Pulling uses BookOrbit's KOReader annotation exchange, as if the reader were an
  empty copy of the book that asks for everything. Each page of results is
  acknowledged so the next page follows.

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
- Highlights and book files pass through your browser and the reader's web
  server; the plugin only talks to the reader and to the BookOrbit address you
  entered.
- Never commit your own `config.json` (it is in `.gitignore`).

## Repository layout

- `bookorbit-sync.crosspoint-plugin/`: the installable payload (Plugin Hub reads
  only this folder).
- `tests/`: development tests. Run `npm install` once, then
  `python3 -m unittest discover -s tests -v` and
  `node --test tests/test_plugin_js.mjs`. They render `device.json` the way the
  firmware does and send it to a mock BookOrbit that mirrors the server's
  validation, dedupe and session derivation; they check the settings page
  against a fake DOM (including finding highlights inside real EPUB files), and
  check the Plugin Hub manifest rules. The generated events were also run through
  BookOrbit's own `deriveKoreaderSessions`.
- `docs/`: the firmware clock issue write-up and release notes.

## License

MIT, see [LICENSE](LICENSE).
