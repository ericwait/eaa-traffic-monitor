# `audio/` — ATC audio engine (Phase 2)

Placemarker only — no feature code yet.

The core value of the app lives here: simultaneous, self-healing ATC streams
with per-stream volume / mute / pan, priority ducking, solo, device routing,
and activity lights that match what the operator hears even on muted streams.

Planned modules (see `docs/design/Audio.md` and the architecture plan):

- `engine.ts` — the singleton engine, 50 ms VAD tick (`setInterval`, never rAF).
- `streamPlayer.ts` — per-stream Web Audio graph, reconnect state machine, `setSinkId`.
- `vad.ts` — **pure** voice-activity math; first vitest guardian target.
- `ducking.ts` — **pure** priority-ducking matrix; second vitest guardian target.
- `devices.ts` — output-device enumeration and match-by-label routing.

Load-bearing rules (do not violate — see `CLAUDE.md`):
the VAD analyser taps **pre-gain**; mute is a **gain node to 0**, never
`element.muted`; the tick is `setInterval`, never `requestAnimationFrame`.
