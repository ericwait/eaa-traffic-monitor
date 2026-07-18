# `youtube/` — YouTube live-feed grid (Phase 3)

Placemarker only — no feature code yet.

Tiles EAA's live channels via the YouTube IFrame Player API, with uniform and
emphasized layouts, plain-DOM identity overlays, and per-feed volume/mute.

Planned modules (see `docs/design/Video.md`):

- `iframeApi.ts` — one-time IFrame API script load per renderer.
- `player.ts` — per-tile player lifecycle and IFrame-API volume/mute control.

Honest limitation (document + tooltip in the UI): YouTube iframe audio cannot
be Web-Audio-analyzed or device-routed — it gets IFrame-API volume/mute only
and plays through the system-default output device.
