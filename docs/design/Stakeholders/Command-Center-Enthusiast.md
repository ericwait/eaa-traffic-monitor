> Status: draft | Audience: anyone designing a feature that touches this role | See also: [../Personas.md](../Personas.md)

# Command-Center Enthusiast

_This persona is the alpha's north star: the app is built to serve them first, and the curated defaults every other persona sees were built by watching this role's hand-arranged prototype (see [Personas.md](../Personas.md))._
_However, this role does not need to be completed by the end of this week._
_We will do our best to get the alpha to a usable state for this role, but if we have to cut scope, this role is the one that will be cut first._

The aviation enthusiast running a multi-monitor command center for the whole of AirVenture week, tracking the airport's full motion at once — arrivals over Ripon and Fisk, runway operations on the webcams, every tower and approach frequency simultaneously.
The app's primary operator, not a passive viewer of it.

## Domain of awareness

- The live state of every configured audio stream — connecting, live, reconnecting, or in error — and which one(s) are active right now.
- How the current priority ranking is resolving conflicts: which stream is ducking, which is holding the floor, whether a solo is engaged.
- Per-stream settings: volume, mute, stereo position, output device.
- The video grid's current layout and which feed, if any, is emphasized or full-screen.
- The flight-tracking panel's (FlightRadar24) current view and login state.
- The full window arrangement across every monitor in use, including any pop-out windows.
- The contents and structure of the text config file, since this role edits it directly to add streams, change priorities, or tune detection thresholds (decision 2026-07-18: alpha ships with no in-app management UI for this — the config file is the only way).

## Data this role keeps current

- The config file itself: stream addresses and labels, priority ranks, detection-threshold tuning.
- Everything the app persists between sessions on this role's behalf: per-stream volume/mute/pan/device/priority, window bounds and monitor assignment, video layout, pop-out placement, and the flight-tracking panel's last view and login.
- In effect, this role is the source of truth for what a good AirVenture-week setup looks like — the curated defaults every other role relies on were built by watching this role's own hand-arranged prototype (see the two-monitor setup referenced from [Personas.md](../Personas.md)).

## Value this role receives

- One application that remembers its own arrangement across restarts, in place of a setup hand-rebuilt every session from six separate audio players and a row of browser tabs.
- Priority ducking, stereo separation, and activity lights aimed squarely at the hardest problem this role has: overlapping radio calls across channels becoming unintelligible.
- One-click solo to snap focus onto a single channel instantly.
- Per-stream output device routing — for example, Tower on headphones while everything else plays over the room's speakers.
- Pop-out windows for every monitor on the desk, each with its own feed selection and layout.
- A flight-tracking panel that keeps its login and last-viewed position, resizable and emphasizable independently of the video grid.

## Not expected to

- Write code, or build and sign a personal copy of the app — beta ships runnable, unsigned builds this role only needs to open.
- Keep the video feed list current by hand beyond an on-demand refresh — no automatic polling is expected of, or done for, this role.
- Recover a crashed audio session gracefully — closing the main window ends the whole app by design, on every platform; relaunching is the expected recovery.
- Carry a phone or a second device to control the app remotely — initally project has no remote-control surface.

## Open questions

- Hand-editing the config file is acceptable to this role, but is it acceptable mid-show, at 6 a.m., when all they want is to swap one feed?
  A parse error falls back to defaults with a banner rather than a crash, but that is a safety net, not a fast path.
  - Answer: This persona needs a UI for config management, but it is not alpha's priority.
    The alpha's goal is to get the app running and stable for the week, with a config file that can be edited by hand if necessary.
    A management UI is planned for post-alpha.
- This role will notice audio pumping or false triggering on detection thresholds before anyone else does, during the one week it matters most — does tuning those thresholds need a faster loop than "edit the config file and relaunch," sooner than post-alpha?
- Per-stream device routing is expected to feel instantaneous regardless of how it is built underneath — if the underlying approach changes during alpha, will switching speed or reliability visibly change for this role?
