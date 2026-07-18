# `components/` — React UI (Phases 1–4)

Placemarker only — no feature code yet.

Planned components (see the architecture plan and the design docs):

- `LayoutShell` — the three-panel resizable layout (`react-resizable-panels`).
- `AudioPanel`, `StreamStrip`, `ActivityLight`, `StatusChip` — the ATC surface.
- `Fr24Panel` + `Toolbar` — the FlightRadar24 `WebContentsView` host and its nav.
- `YouTubeGrid`, `VideoTile` — the live-feed grid.

High-frequency visuals (activity lights) paint from engine state directly via
rAF/CSS variables; only the post-hysteresis `active` boolean flows through the
zustand store.
