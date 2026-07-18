# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Greenfield project — no code, build system, or tests exist yet.
The only content is `README.md`, the requirements document.
There are no build/lint/test commands to run; add them to this file once a stack is chosen and scaffolded.

**Tech stack: undecided.** This must be settled with the user before implementation begins.
The requirements (multi-monitor pop-out windows, an embedded browser panel for a site that blocks iframes, many simultaneous audio/video streams) point toward a desktop shell (Electron/Tauri-class) rather than a plain web app, but the user has not committed to one.

## What This App Is

A unified dashboard for monitoring air traffic in and out of Oshkosh during the EAA AirVenture airshow.
Three integrated pillars (full details in `README.md`):

1. **ATC audio streams** — `.pls` stream URLs for tower/approach/departure.
   Simultaneous playback of multiple streams with per-stream volume and mute, visual activity indicators (so the user can tell *which* stream audio is coming from), and stream prioritization.
   The README calls this the most complex part: the core UX problem is overlapping radio calls across channels becoming unintelligible.
2. **YouTube live feeds** — EAA's live channels, tiled in a grid with emphasis/promote layouts, full-screen for any feed, per-feed audio control, stream-identity overlays, and pop-out windows for additional monitors.
3. **FlightRadar24 panel** — FlightRadar24 cannot be embedded via iframe, so it needs an embedded browser panel with full navigation.
   It must be resizable and emphasizable independently of the YouTube grid.

## Key Constraints

- Simultaneous multi-stream audio playback with per-stream activity detection is the hardest requirement; design the audio architecture around it.
- FlightRadar24's iframe restriction forces a browser-panel approach (e.g., Electron `WebContentsView`/webview or equivalent).
- Multi-window/multi-monitor support is a first-class requirement, not an afterthought.
- Performance with many concurrent audio + video streams must stay smooth; treat it as a design constraint from the start.

## Documentation Conventions

Markdown prose in this repo uses **semantic line breaks**: each sentence starts on its own line in the source, instead of being hard-wrapped at a fixed character count or crammed multiple-sentences-per-line.
Rendered output is unchanged — CommonMark collapses a single newline inside a paragraph into a space — but git diffs stay scoped to the sentence that actually changed instead of rewrapping a whole paragraph.
Rules: one sentence per line in prose; list bullets stay on one line if they're a single sentence, otherwise each sentence gets its own line with a 2-space hanging indent; tables, code fences, and mermaid diagrams are left untouched.
`CODE_OF_CONDUCT.md` is exempt — it's kept verbatim as the standard Contributor Covenant text.
