# BookOrbit Sync 1.0.0

> **Made with AI, may contain errors.** This plugin was written together with an
> AI assistant and has had limited testing on real hardware (an Xteink X4 Pro and
> X3). See
> [KNOWN_ISSUES.md](https://github.com/Styxbleich/BookOrbit-Sync-for-Crosspoint/blob/main/KNOWN_ISSUES.md).

Reading sessions go to your BookOrbit server by themselves, and highlights now
sync both ways from one screen.

**New**
- **One Check book button.** It confirms BookOrbit has the exact file, then shows
  the book's highlights in three groups: in BookOrbit but not on the reader, on
  the reader but not in BookOrbit, and on both.
- **Add to reader.** Highlights made in BookOrbit's web reader, or on another
  device, can be added to the reader's own highlights for the book, so they show
  up in the book and in its highlights menu. Per highlight or all at once.
- **Send to BookOrbit.** Highlights that are only on the reader are sent with a
  real position in the book. Per highlight or all at once.
- **Delete from the reader.** BookOrbit is the source of truth, so highlights it
  does not have can be deleted from the reader, with a second click to confirm.
  BookOrbit is never changed by a delete.
- **/My Clippings.txt stays in step.** Highlights added by the plugin get entries
  in the reader's own format (the file is created if it is missing), and entries
  for deleted highlights are removed.
- Clearer messages, including a plain explanation when the page loses contact
  with the reader.

**Changed**
- The separate **Send highlights**, **Pull highlights** and **Save as text file**
  buttons are gone. Their jobs are done by the buttons in the Check book results.
- A shorter on-device README, and clearer Plugin Hub descriptions.

**Safety**
- Existing highlight records are copied byte for byte, and a file in a format the
  plugin does not recognise is left alone.
- A backup of the reader's highlight file and of `/My Clippings.txt` is saved in
  the plugin's folder before any change.
- Nothing is duplicated, and nothing is offered for deletion if BookOrbit has more
  highlights than could be listed.

**Notes**
- Highlights need the same file that BookOrbit has, and a computer or phone with
  the reader's Plugins page open.
- Needs a reader with a clock chip; the original Xteink X4 is not supported.
- Known problem (firmware): after a restart, sessions can be stamped in the
  future. See docs/FIRMWARE_CLOCK_ISSUE.md.

Install: Plugin Hub, or copy the contents of `bookorbit-sync.crosspoint-plugin/`
into a folder named `bookorbit-sync` on the SD card. Updating from 0.12.x should
keep your `config.json`; "Also send at sleep" resets to off.
