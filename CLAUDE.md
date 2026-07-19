# CLAUDE.md

Guidance for Claude Code and other agents working in this repository.
Follow these instructions; they override default behavior.

## What this app is

A cross-platform Electron desktop dashboard for monitoring airshow air traffic (built first for EAA AirVenture) — three pillars: simultaneous ATC audio streams, a YouTube live-feed grid, and an embedded FlightRadar24 browser panel.
Stack is locked: Electron + TypeScript (strict) + React, built with electron-vite, packaged with electron-builder — see [docs/development/TechStack.md](docs/development/TechStack.md).

## Commands

Everything runs through `just` (run `just` alone to list all verbs):

- `just dev` — install if needed, then run the app with HMR.
- `just up` — build and preview the production app (loads over `app://`).
- `just test` — vitest unit suite. `just e2e` — build, then Playwright-Electron smoke.
- `just lint` — eslint, check-only. `just fmt` — prettier, writes in place. `just typecheck` — tsc, all tsconfigs, check-only.
- `just version` — git-computed SemVer (CI is authoritative). `just reset` — DESTRUCTIVE clean (asks first).
- `down` / `migrate` / `health` print "n/a for a desktop app" — this app has no server, datastore, or health endpoint.

Run `just lint`, `just typecheck`, `just fmt`, and `just test` clean before every commit.

## Repository map

- `src/main/` — main process: `index.ts` (lifecycle, `app://` scheme registration), `protocol.ts` (scheme handler). FR24, IPC, config, session, resolvers land here in later phases.
- `src/preload/` — contextBridge; `index.ts` + `index.d.ts`. contextIsolation ON, nodeIntegration OFF.
- `src/renderer/src/` — React UI. Seeded module folders: `audio/`, `youtube/`, `components/`, `state/` (each has a README placemarker).
- `src/shared/` — code compiled by all three processes; import via `@shared/*`. The typed IPC contract will live here. Keep it free of Electron and DOM APIs.
- `tests/unit/` (vitest), `tests/e2e/` (Playwright-Electron). `docs/` — split design/ (what & why) vs development/ (how); `decisions/` indexes inline decision stamps.

## Key conventions

- **Semantic line breaks** in all markdown prose: one sentence per line in the source; list bullets stay on one line if a single sentence, else one sentence per line with a 2-space hanging indent; leave tables, code fences, and mermaid untouched.
  `CODE_OF_CONDUCT.md` is exempt (verbatim Contributor Covenant).
  Prettier does NOT format markdown (see `.prettierignore`) precisely to protect this — do not remove that exclusion.
- **Decision stamps:** record a decision inline where it's made, stamped `(decision YYYY-MM-DD)`, AND add a one-line row to [docs/decisions/README.md](docs/decisions/README.md) **in the same commit**. A stamp without a row, or a row without a stamp, is half-done.
- **Docs split:** `design/` is implementation-agnostic (what & why); `development/` names tools (how). If a `design/` sentence names a library or tool beyond a brief parenthetical, it belongs in `development/`.
- **Merge commits only — NEVER squash or rebase-merge.** GitVersion reads merge history to compute the version; squashing destroys that signal.
- Commit subjects are plain imperative ("Add the audio engine"), not Conventional Commits. Match `git log`.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Key gotchas (each is an instruction)

- **Packaged renderer loads from a loopback HTTP server (`http://127.0.0.1:<port>`), never `file://` — with `app://` as a logged fallback.** The YouTube IFrame API validates the embedding origin and rejects `app://` with error 153 (verified Phase 3), so the packaged renderer is served from a tiny 127.0.0.1 http server (`src/main/rendererServer.ts`); a real http origin also stays a secure context for `enumerateDevices`/`setSinkId`. Dev uses the electron-vite dev server; if the loopback bind fails the app falls back to the still-registered `app://` scheme and logs that YouTube tiles will be blank (decision 2026-07-19; see `src/main/index.ts`).
- **LiveATC rejects non-browser user agents.** Every `.pls` resolve and stream fetch from the main process must send a browser-like `User-Agent`, and resolved URLs must be cached (resolve only on connect/reconnect) — never hammer with a bare/bot UA.
- **ATC mute is a gain node set to 0, never `element.muted`.** Activity lights must keep working on muted streams; muting the element kills the signal the analyser reads.
- **The VAD analyser taps PRE-gain.** Tapping post-duck creates a measurement feedback loop and oscillating ducking. Put the analyser parallel off the source, before the gain chain.
- **Never use requestAnimationFrame in the audio engine.** rAF freezes when the window is hidden. Use `setInterval` (50 ms tick) and keep `backgroundThrottling: false` on the main window (already set).
- **`WebContentsView` (FR24) paints ABOVE all DOM.** An HTML modal cannot cover it. Set `overlayOpen` → `fr24:setVisible(false)` under overlays/modals; use native Electron menus for anything dropping over the FR24 region.
- **Git LFS + legacy Pages serves pointer files** until the Phase 5 Actions-based site build. Images on the published docs site stay broken until then; GitHub's own markdown rendering is fine. Leave `.gitattributes` alone — it routes png/jpg/mp3/wav/icns/ico through LFS.
- **`ELECTRON_RUN_AS_NODE`** leaks from some IDE terminals and forces Electron into Node mode (no window). The justfile strips it; prefer running through `just`. Raw commands: prefix `env -u ELECTRON_RUN_AS_NODE`.

## Boundaries

- Never push to `main`. Never create tags or releases. Work on `feature/*` (or `fix/*`, `docs/*`) branches; PRs target `develop`.
- Do not change GitHub settings or branch protection.
- Ask before adding a new dependency — the Phase 0 dependency set is deliberate and version-pinned for interop (Vite 7 caps, not 8; classic TypeScript, not the 7.x port). New feature deps (zustand, zod, electron-store, react-resizable-panels) arrive with the phase that needs them.
- Do not edit files under `docs/` prose with a formatter; they are semantic-line-break, human-owned.
