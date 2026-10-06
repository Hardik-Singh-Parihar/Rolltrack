# Changelog

## [1.3.2] — Clear no longer deletes; extension off/on no longer leaves a dead widget
- **"Clear" on Recent Meetings now only empties that list.** Before, it deleted every meeting from storage
  and the files could not be opened any more. Now meetings are only hidden from the Recent list; they stay
  stored and open from the calendar. New meetings appear in Recent as usual.
- **Real deletion is explicit:** from a meeting's own page (as before) and, new, from the calendar's meeting
  list (trash icon, "Delete for good?" confirmation).
- **Extension turned off / reloaded while a meeting is open.** The page script no longer logs a warning with a
  stack trace. It stops all timers, dims the widget, disables its switch, shows "offline", marks itself dead and
  removes a dead Save popup. Transient connection errors (service worker restarting) no longer count as a dead
  extension.
- **Turning the extension back on reconnects the meeting page by itself.** Chrome leaves the old script running
  in open tabs with a dead connection and never injects a new one, and the new script used to skip creating a
  widget because the old one was still there ("widget reacts but nothing reaches the extension"). Now the
  background pings every meeting tab whenever it starts (and on install/update) and injects a fresh copy where
  nothing answers, and the fresh copy replaces the dead widget. No tab refresh needed. New permission:
  `scripting` (host access was already granted). A live copy is never duplicated or replaced.
- **Start tracking from the home page no longer starts with nobody.** When the meeting page did not answer, a
  session was seeded from stale data (people last seen minutes ago) and showed no attendees even though people
  were present. Now it brings the page script back, asks again for a fresh headcount, and only then falls back.
- **Stale entries are cleaned up** when the background starts: tabs that no longer exist are dropped, and a
  recording that was still ON in a tab that vanished while the extension was off is kept as a pending save
  (ending at the last time that tab was heard from) instead of being lost.

## [1.3.1] — Activity Log removed
- **Removed the Activity Log completely.** The live Active Log board and the "Activity events" card on the
  home page, the standby "Meeting Logs" panel, the Activity Log page and the "Activity Log" button on the
  Attendance page are gone, along with the routing to that page.
- **Nothing is recorded for it any more.** The background no longer logs join/leave/mic/cam/screen-share
  events, the meeting-page script no longer reads mic/cam/screen-share state, the events endpoint and its
  storage are gone, and the Save popup no longer shows an events figure. The heartbeat is back to 2 s.
- Kept: the People-panel/ID-based attendance, headcount check, diagnostic panel, on-page Save popup,
  multi-roster, duplicate warning, no-roster stop on Confirm and the date-driven calendar (all from 1.3.0).
- Meetings you already saved are untouched. They simply no longer show a log (saved meetings keep an empty
  `activityLog` field so older data loads).

## [1.3.0] — New workflow: on-page Save popup, multi-roster, raw-first matching, real calendar, Active Log
- **Turning tracking OFF from the meeting-page widget no longer opens or focuses the dashboard.**
  The Save Meeting popup appears directly on the meeting page. The session is frozen in the background at
  the moment of OFF (people, times, Active Log); the popup is only the UI. Save or Cancel from there. If the
  page is reloaded while the popup is open it comes back; if the tab is closed the session is handed to the
  dashboard. OFF from the dashboard still shows its prompt in the dashboard.
- **Saved meetings moved to `chrome.storage.local`** (so the on-page popup can save). Existing meetings are
  copied across once, merged with anything already saved from a page, and never re-imported.
- **No navigation after saving.** The save popup has no CSV checkbox any more (a save-time CSV had no roll
  numbers); export from the Attendance page.
- **Roster files**: any number can be active at once; the first file ever added becomes the roster
  automatically, and so does a single remaining file. Adding a file never replaces the current selection;
  tick "Set as roster file" to add it. Deleting a selected file never selects another silently. Existing
  users keep the roster that was active. Selection is available from Home ("Add List") and from the
  Attendance page ("Change roster files"). The Attendance page used to read rosters once and go stale.
- **Duplicates are warned about before matching**, never merged: exact (same name, division, roll no.) and
  possible (same name, different division or roll no.). Continue or change the selection.
- **Raw attendance first.** Saving never matches against a roster. Pressing Confirm with no roster file
  selected now says so immediately and stops: no matching, no confirmation. A confirmed meeting remembers
  which roster files it used and says when the selection has changed since.
- **Calendar is date-driven**: real month grid, month/year navigation, "Today" jump, and the current day is
  highlighted. Meeting dates are now the LOCAL date (they were UTC, so a 1 am meeting in India was filed
  under yesterday).
- **Active Log**: Joined / Left, Mic Open / Close, Cam Open / Close, Screen Share Open / Close, logged only when
  a real state changes (never repeated while unchanged). Five filters (All, Join/Leave, Mic, Cam, Screen
  Share) that cover past and new events, newest first, HH:MM:SS times, on both the live board (refreshed every
  second) and the saved-meeting page. "Hands raised" is gone. Heartbeat is 1 s so a 1-2 s mic blip is caught.
  Leaving needs about 12 s of absence (back-dated to the last sighting) and is not logged while people in the
  call are unidentified. Icon-based "no signal means open" is only trusted while the place that showed the
  mute icon is still on screen.
- **Known limit:** mic / cam / screen-share detection reads Meet's page and has not been calibrated on a live
  meeting. Use the diagnostic panel's "Copy report" to tune it. Join/Leave is the dependable part.

## [1.2.2] — Everyone present is registered: fresh headcount at ON/OFF, ID-based identity, diagnostic
- **ON now takes a fresh headcount.** Everyone on the page at that instant is registered from the
  ON moment, whether the teacher joined first or last. Before, anyone not seen in the previous 15 s
  (e.g. tile not drawn) was dropped from the session.
- **OFF takes a final headcount.** Everyone still present is closed out at the exact stop time.
  Late joiners between ON and OFF are registered from their own join time.
- **People are identified by the platform participant ID, not the display name.** Two students with
  the same name stay two people; a rename no longer splits one person into two. A drop + rejoin under
  a new ID is merged back into one person (times added up, gap not counted). Names seen under two
  IDs in the same look are kept separate and suffixed "(2)".
- **Names are read from text only, skipping icon glyphs** (`mic_off`, `more_vert`, ...), so an icon can
  no longer leak into a name. One-character names are kept. Only tiles ending in "(Presentation)" are
  ignored, not every name containing the word.
- **People panel is read in addition to tiles**, so people whose tile is not on screen are counted
  when the panel is open.
- **Headcount check.** Meet's own participant total is compared with the names identified: a `64/70`
  pill on the widget (amber when they differ), and the Save prompt says how many were not identified
  at start, at stop, and at peak. Optional "Unidentified participant" placeholder entries (0 min).
- **Diagnostic panel** (magnifier icon on the widget): shows every row found, its source, id and
  mic hint, Meet's count, and a "Copy report" button that includes sample HTML for calibration.
- Heartbeat 4 s -> 2 s.
- Not yet done from the new-workflow list: on-page Save popup, storage move, multi-roster,
  date-driven calendar, Active Log.

## [1.2.1] — Save prompt on widget OFF; timer no longer continues across sessions
- **Fixed: turning the on-page widget OFF now opens the Save Meeting prompt**,
  same as toggling OFF from the dashboard. The prompt used to live only inside
  the dashboard React page, so it never appeared when the dashboard wasn't open.
  `background.js` now freezes every finished ON->OFF span into a "pending save"
  (`chrome.storage.local`), opens/focuses the dashboard for widget OFFs, and
  `App.tsx` shows the prompt for each pending save (one at a time, exactly once).
- **Fixed: timer continued from the old session on re-ON.** Turning tracking ON
  reused the previous `trackingStartedAt` (`existing.trackingStartedAt || now`),
  and attendee first-seen times were never reset. Every ON now starts a fresh
  session: new start time, clean attendee windows (people already in the room
  are counted from that moment). OFF clears the live start time. Manual rooms
  also reset their clock on OFF/ON.
- **Fixed: saved duration/% was measured to "when Save was clicked".** The
  modal now uses the exact OFF time (`trackingEndedAt`).
- **Improved presence accuracy:** attendee time is accumulated per heartbeat
  (`presentMs`) so someone who left and rejoined isn't counted for the gap.
- **Fixed: service-worker restart could silently switch tracking off.**
  Handlers now wait for stored state to load before reading/writing it.
- Closing a meeting tab while tracking is ON keeps the recording as a pending
  save instead of discarding it.

## [1.2.0] — Fixed the "Download Extension" drift bug; removed demo/fake data
- **Root-cause of the timer-tracks-since-creation bug persisting after
  1.1.0**: the in-app "Download Extension" button (`zipDownloader.ts`) had
  its own hand-copied, stale duplicate of `background.js`/`content.js`
  from *before* 1.1.0's ON/OFF fix, so anyone using it ran old behavior.
  That button and `zipDownloader.ts` are now **removed entirely** — the
  extension is only ever loaded from `dist/` (or, later, distributed via
  the Chrome Web Store), so there is a single copy of the extension code.
  (`jszip` is no longer used and can be dropped from package.json.)
- **New: "Open dashboard" button on the on-page widget.** The floating
  widget now has a small home icon next to the ON/OFF toggle that opens
  (or focuses, if already open) the full RollTrack dashboard in its own
  tab, via a new `ROLLTRACK_OPEN_HOME` message handled in `background.js`.
- **Removed fabricated attendee data on save.** `SaveMeetingModal.tsx`
  previously saved every live meeting with 6 hardcoded fake attendees
  (e.g. "Samira Khan", "Amara Chen") and a fake activity log, regardless
  of who was actually detected. It now builds the saved attendee list and
  activity log entirely from the real names and timestamps `content.js`
  detected during that session; sessions with no detected attendees save
  with an honest empty list instead.
- **Removed the "Simulate Event" fake-name generator** and the fake
  "Host Organizer" / 3-participant seed on newly created manual/offline
  rooms (`LiveMeetingCard.tsx`). Manual rooms now start genuinely empty.
- **Removed the unused `DEFAULT_MASTER_ROSTER`** fake student roster
  (`rosterStorage.ts`) — dead code that was never actually loaded, but
  shipped fabricated names regardless.

## [1.1.0] — ON/OFF single source of truth; security fix
- **Security fix**: replaced the `xlsx` npm package (stuck at 0.18.5, with
  an unpatched high-severity prototype-pollution + ReDoS advisory — no fix
  available on npm because SheetJS's actual fix only ships via their own
  CDN, not the registry) with `sheetjs-ce-unofficial`, a faithful,
  unmodified republish of that fixed source (0.20.2). Same API, clean
  `npm audit`. See the comment in `src/utils/rosterStorage.ts` for details
  and the option to install directly from SheetJS's own CDN instead.
- **New: an on-page floating widget** (`public/content.js`) — didn't exist
  before; the content script was a silent scanner only. It shows live/off
  status, an elapsed-time readout, and an ON/OFF toggle.
- **The widget's ON/OFF is now the single source of truth for tracking.**
  `background.js` owns `trackingOn`/`trackingStartedAt`/`trackingEndedAt`
  per tab, set only via a `ROLLTRACK_SET_TRACKING` message — sent
  identically by the widget and by the popup's own toggle, so they can
  never disagree.
- **Fixed the timer bug**: elapsed time and all downstream duration/%
  math now use `trackingStartedAt` (the exact moment tracking was turned
  on) instead of `startedAt` (whenever the tab was first detected). Turning
  tracking on 10 minutes into a meeting no longer inherits those 10 minutes.
- **Removed the separate "Track this meeting" step.** A detected tab with
  `trackingOn: true` (from either the widget or the popup) now
  auto-creates its session — no manual promotion step first.
- Turning tracking OFF — from the widget, the popup, or anywhere else —
  opens the save-meeting prompt exactly once, from a single centralized
  place (`LiveMeetingCard.tsx`'s sync effect), regardless of which UI
  triggered it.
