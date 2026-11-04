BookOrbit Sync

Made with AI, may contain errors. Written together with an AI assistant and
lightly tested on real hardware. See KNOWN_ISSUES.md in the project page.

Sends each reading session to your BookOrbit server so it shows up in the
reading log, streaks and stats, and syncs your highlights. Needs a CrossPoint
build that has the reader.session plugin event.

Setup (once, no file editing):
1. Settings > Connectivity > Plugins: on. Restart the reader.
2. Connect the reader to your network and open its web interface in a
   browser (the reader's file-transfer / web UI).
3. On the Plugins page, the BookOrbit Sync card is at the top. Click
   its title to open or collapse it (it starts collapsed once set up). Enter:
   Server URL   your BookOrbit address, e.g. http://192.168.1.50:3000
   Username     your BookOrbit KOReader-sync username
   Password     your KOReader-sync password (only its md5 is stored)
   Device name  any name: letters, digits, _ and - (default: crosspoint)
4. Press Test connection, then Save. Restart the reader if the plugin
   was just installed.
5. Settings > System > Plugins > BookOrbit Sync should list the
   reader.session event.

Manual alternative: copy config.example.json to config.json in this
plugin's folder and fill in server, user, key (md5 of the password), device_id.

Use: read as normal. Sessions are queued on the SD card and delivered the next
time the reader goes online. Your usual sync action does it: long-press
(if you mapped it to KOReader sync) or reader menu > Sync progress. The
reader saves the current session first, joins WiFi, and sends it. Without WiFi
nothing waits or retries.

Optional: tick "Also send at sleep" on the settings page to have the reader
join WiFi at sleep (up to 10 s) and send automatically. Restart afterward.
Updating the plugin resets this to the default.

The reader shows a "BookOrbit: session sent" popup after a delivery.

Highlights (from the settings card, in your browser):
- Recent books: pick the book (the reader's last opened EPUBs). "Another book"
  lets you type a path such as /Books/Author/Title.epub.
- Check book: confirms BookOrbit has this exact file and lists the reader's
  highlights for it. Nothing is sent.
- Send highlights: sends this book's highlights, each with a position so the
  BookOrbit web reader opens them at the right spot. Highlights BookOrbit already
  has are skipped, so it is safe to press again.
- Pull highlights: lists what BookOrbit has for the book (including highlights
  made in its web reader). Save as text file writes
  "BOOK NAME - AUTHOR Highlights.txt" next to the book. It does not change the
  reader's own highlights.
- The book must be the same file BookOrbit has. See KNOWN_ISSUES.md.

Notes:
- config.json holds your sync login (md5 of the password, which BookOrbit
  accepts as the key) on the SD card, and it is sent as headers. Use a trusted
  network (or https), and the KOReader-sync credentials rather than your
  BookOrbit login. Updating the plugin does not touch config.json.
- The web page runs on the reader's own interface, so only people on your
  network can reach it.
- The book must be in BookOrbit as the same file (download it from BookOrbit's
  catalog). Unknown books are ignored.
- Undelivered sessions queue on the SD card (4 KB, roughly a dozen
  sessions), then the oldest are dropped, so sync every so often.
- Session times come from the reader's own clock. Check Settings > Clock
  (time and timezone) if entries show up at the wrong time. Known firmware
  issue: after a restart the reader's session clock can stay ahead of real
  time for a while, which makes new sessions appear in the future.
