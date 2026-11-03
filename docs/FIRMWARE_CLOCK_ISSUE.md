# Draft CrossPoint issue: `reader.session` timestamps can sit ahead of real time

> **Made with AI, may contain errors.** This write-up was produced with an AI
> assistant from reading the CrossPoint source (develop, commit `136c265`,
> 2026-11-02) and from observations on one reader. The code references are real,
> but the explanation of *why* it happens is a **hypothesis** that has not been
> confirmed with serial logs. Edit it before posting.

## Summary

On one reader, `reader.session` events (and `{event.ts}`) carried times that were
about 50 to 80 minutes **ahead** of real time, although Settings, Clock showed
the correct time and timezone. Two sessions read about 10 minutes apart had
`start_time` values only about 30 seconds apart. A plugin that forwards these
times to a server records the sessions in the future.

## Environment

- CrossPoint develop, commit `136c265` (2026-11-02).
- One reader with a working clock screen (a US timezone,
  Daylight Saving: Auto, 12-hour). Board and RTC details: _to fill in_.
- A plugin subscribed to `reader.session`.

## What was observed

1. Settings, Clock showed the correct local time (for example 10:18 AM while a
   computer next to it also read 10:18 AM).
2. A session read around 11:10 AM had `start_time` around 12:11 PM and `ts`
   around 12:15 PM in the queued `events.jsonl` line (same day, same timezone).
3. A second session read about 8 minutes later had `start_time` around 12:12 PM,
   so the stamp barely advanced although real time did.
4. The difference to real time shrank at about the pace of real time, which fits
   a value that is stuck while real time moves toward it.
5. Pressing Settings, Clock, Sync Clock Now and then reading did **not** help.

## Where the times come from (code references)

- `src/activities/reader/ReaderActivity.cpp`: `readerSession.onRenderComplete(
  millis(), trustedtime::trustedNow(), ...)`. The session start epoch is
  `trustedNow()`.
- `lib/TrustedTime/TrustedTime.cpp`:
  - `trustedNow()` returns `max(time(nullptr), ramFloor)`.
  - `init()` reads the floor from NVS and, if `time(nullptr) < floor`, calls
    `settimeofday(floor)`.
  - `note()` persists the floor when it advanced by at least 60 seconds (called
    at sleep entry and after SNTP sync).
  - `adopt()` refuses to rewind the clock below the floor.
- `lib/hal/HalClock.cpp`: `localTime()` and the Clock screen read the **RTC**
  (`_sdkRtc.now`), not `time(nullptr)`. So the screen can be right while the
  system clock is not.
- `src/main.cpp`: `silentRestart*()` calls `ESP.restart()` after network
  activities (the web server, `KOReaderSyncActivity`, and others), so `init()`
  runs again and re-applies the floor after each of them.

## Hypothesis

If the persisted floor is ever ahead of real time (for example after a bad clock
set or sync earlier), then on every boot `init()` sets the system clock to the
floor, ahead of the RTC. The Clock screen keeps showing the correct RTC time.
Sync Clock Now corrects the system clock for the moment, but the silent restart
that follows re-applies the floor. `note()` at sleep entry can persist the
ahead-running clock and move the floor further. The floor only stops mattering
once real time passes it.

## Impact

Anything consuming `reader.session` or `{event.ts}` gets future timestamps. For
a reading-log plugin this puts sessions in the wrong hour or day, and can break
streaks and time-based achievements. `trustedNow()` exists to protect date-based
book loans, but it is also used here for plain activity timestamps.

## Suggested directions (for the maintainers to judge)

1. On boards with an RTC, treat a valid RTC as the authority for the system
   clock, and do not let a persisted floor push the system clock more than a
   small tolerance ahead of it.
2. Stamp reading sessions (and `{event.ts}`) from the wall clock or RTC, and keep
   the monotonic floor for loan enforcement only.
3. Cap how far the floor may run ahead of an RTC or SNTP reading, and let a
   successful SNTP sync lower an implausibly high floor.
4. Provide a way to reset the floor (for example in Settings, Clock).

## How to reproduce (to be confirmed)

1. Get the persisted floor ahead of real time (how this happened on the reporter's
   reader is not known).
2. Restart the reader, read a few pages for a minute, then sleep it.
3. Look at the plugin's `events.jsonl` line: `start_time` and `ts` are ahead of
   the time shown in Settings, Clock.

Serial logs with the `CLK` and `TIME` tags around boot would show whether
`Clock restored to persisted floor` is logged.
