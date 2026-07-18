# `state/` — renderer state (Phase 1+)

Placemarker only — no feature code yet.

One `zustand` store **per window**. It works outside React, so the audio-engine
singleton (a plain TS object) writes into it directly and React subscribes via
selectors. Do **not** build a cross-process synced store — the three state
tiers (persisted settings in main, live UI state here, high-frequency visuals
painted directly) stay deliberately separate (see the architecture plan).

Planned module:

- `store.ts` — the per-window zustand store and its IPC glue
  (`session:changed` subscription, own-echo suppression by `sourceWindowId`).
