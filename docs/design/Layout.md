> Status: draft | Audience: anyone designing or building the panel layout | See also: [Audio.md](Audio.md), [Video.md](Video.md), [Tracking.md](Tracking.md), [Weather.md](Weather.md), [../development/TechStack.md](../development/TechStack.md)

# Layout

This document covers the main window's panel layout: how the operator arranges ATC audio, field weather, flight tracking, and the live video feeds against each other, and how that arrangement is saved and restored.
It is written in product terms; where a mechanism is load-bearing it links to [../development/TechStack.md](../development/TechStack.md) rather than naming the machinery here.
For what each panel shows once it is on screen, see [Audio.md](Audio.md), [Video.md](Video.md), [Tracking.md](Tracking.md), and [Weather.md](Weather.md).

## Intent

*VSCode-style modularity, not three fixed columns.*
Earlier in the app's life the window was three hard-coded regions — ATC audio, flight tracking, a video grid — separated by two drag dividers.
That shape works for one arrangement and fights every other one: an operator who wants weather next to the video feeds, or flight tracking maximized while a video plays in the corner, had no path there.

The layout instead treats every pane — ATC audio, field weather, flight tracking, and each individual video feed — as a first-class, independently addressable **panel**.
Panels tile the window edge-to-edge with no gaps and no overlaps, can be split, resized, closed, reopened, swapped, and dragged into a new position, and the whole arrangement can be saved as a named layout and switched back to on demand.
The goal is an operator who sets up the exact view they want for a show — once — and can return to it, or a different saved view, in a couple of clicks.

## Features

- **Panels tile the window; there are no tabs.**
  Every open panel occupies its own rectangle of screen; panels never stack behind each other or share a slot via a tab strip.
  This is a deliberate v1 boundary: tabs hide content behind a click, and the whole point of this layout is that everything the operator has open stays visibly on screen at once.

- **Arbitrary splits, not a fixed grid.**
  Any panel can be split into two, in either direction, and either half can be split again — the arrangement is a tree of splits, not a fixed number of rows and columns.
  Dividers between panels drag to resize their neighbors, with a sensible minimum size for every panel kind so a resize can never squeeze a panel down to nothing.

- **Panels close and reopen without losing their place.**
  Closing a panel simply removes it from the tiling; every other panel reflows to fill the space.
  Reopening a closed panel (from a menu) puts it back in a sensible spot — joining the video feeds if it's a video panel, rather than landing wherever there happens to be room.

- **Panels move by drag or by an explicit command.**
  Grabbing a panel's header and dragging it onto another panel offers a live preview of where it will land: drop it in the middle to swap the two panels outright, or drop it against an edge to split that panel and dock alongside it — including dragging all the way to a window edge, to dock as a new full-height or full-width column or row.
  Every drag-driven move is also reachable through an explicit "move panel" command that names a target panel and a placement in words — the same underlying move, for anyone who prefers not to (or cannot) drag, and for repeatable, scripted arrangement.

- **Maximize, without losing anything running underneath.**
  Any panel can be maximized to fill the whole window and restored again (a header control, or a keyboard shortcut to back out).
  Maximizing never stops what the other panels are doing: a video feed keeps playing, and — notably — an ATC stream that is unmuted keeps being audible, even though its panel is hidden.
  Audibility and visibility are independent, the same principle [Audio.md](Audio.md) and [Video.md](Video.md) apply to muting a single stream or tile.

- **Snap layouts: both ready-made templates and the operator's own named views.**
  A small gallery of ready-made arrangements (for example, an even 2×2 grid, or one large pane with several smaller ones alongside it) can be applied in one step, with the operator choosing which panel goes in which slot.
  Beyond the templates, the operator's own arrangements can be saved under a name, applied again later, renamed, or deleted — "my show-day layout," "diagnostics view," as many as wanted.
  Switching between templates or saved layouts is instant and never interrupts a feed that is present in both the old and new arrangement — a video panel that stays open across the switch keeps playing exactly as it was, it just moves to its new position on screen.

- **Per-video fit and fill.**
  Independent of the panel-tiling layout, each video feed's own panel has a simple display choice: fit the whole picture inside the panel (may letterbox) or fill the whole panel with the picture (may crop the edges).
  This is a per-feed, remembered preference — see [Video.md](Video.md) for the full video-panel behavior this sits alongside.

- **Pop-outs stay outside the tiling — and combine through one explicit control.**
  Sending a video feed to its own window (for a second monitor) removes it from the main tiling the same way closing a panel does, and it rejoins the main tiling in a sensible spot if that pop-out window is closed.
  Two separate pop-out windows combine only through an explicit "merge into…" control naming the other window — never by dragging one window onto another, which the desktop platform this app runs on cannot reliably detect as a drop.
  See [Video.md](Video.md) § Pop-outs and restore for the full pop-out story.

- **The whole arrangement restores on relaunch.**
  Panel positions and sizes, which panels are open, any saved named layouts, per-feed fit/fill choices, and every pop-out window all come back exactly as they were left (decision 2026-07-18; see [Video.md](Video.md)) — the operator arranges once for the week, not once per session.

## Risks and known limitations

- **No tabs means screen space is the hard limit.**
  Every open panel needs its own visible rectangle; there is no way to have more panels "open" than comfortably fit on screen the way a tab strip would allow.
  Closing panels that aren't needed right now, or moving some to a pop-out on another monitor, is the intended way to manage that, not a workaround.

- **A maximized-but-audible panel can be surprising the first time.**
  An operator who maximizes flight tracking while an unmuted ATC stream keeps talking in the background may not expect to keep hearing it with its panel out of view.
  This is intentional (see Features above), but it is worth calling out anywhere the behavior is first introduced.

- **A saved layout is a snapshot of panel identities, not a guarantee every panel in it still exists.**
  If a saved layout names a video feed that has since been removed from the feed list, applying that layout simply omits it rather than failing to apply — a graceful, not silent-failure, degradation.

## Expected outcomes

- The default arrangement on first launch mirrors today's known-good layout — audio and weather on the left, flight tracking and the video feeds on the right — so nothing regresses for an operator who never touches the layout at all.
- Dragging a panel onto another panel's edge splits it and docks the moved panel there, with a live preview showing exactly where it will land before the drop.
- Switching between two saved layouts that both include a given video feed never restarts that feed's stream.
- Maximizing a panel and pressing the restore shortcut brings back the exact prior arrangement.
- Relaunching the app after an arrange-heavy session reproduces every panel's position, size, and open/closed state unattended.

These are the observable exit criteria for the layout system; see [../Implementation-Plan.md](../Implementation-Plan.md) for current status.
