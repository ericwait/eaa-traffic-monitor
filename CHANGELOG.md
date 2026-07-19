<!--
Policy: every release updates this file, under the section for that version,
with whichever of the six subsections apply. This is not a request — the release
flow gates on it mechanically: a release whose diff doesn't touch this file
fails the preflight. Keep entries terse and user-facing; implementation detail
belongs in commit messages, not here.

Format: Keep a Changelog (https://keepachangelog.com/en/1.1.0/).
Versioning: SemVer, computed from git history — never hand-edited here.
-->

# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- ATC audio core: the eight curated KOSH LiveATC feeds play simultaneously from
  an editable `config.json`, each with its own volume, mute, and stereo pan.
  Muting drops a channel to silence but keeps watching it, so a muted channel's
  activity light still shows when it is talking.
- Per-channel activity lights driven by adaptive, squelch-aware voice detection
  (it learns each channel's noise floor and bridges the gaps between words), kept
  distinct from a connection status chip (connecting / live / reconnecting /
  error) so a live-but-silent frequency never reads as a fault.
- Automatic, indefinite reconnection: a dropped or stalled stream re-resolves
  onto a fresh host and self-heals with exponential backoff, unattended.
- A "Reload config" button applies edits to `config.json` live; an invalid file
  falls back to the built-in defaults and shows a banner naming the file and the
  error rather than failing to start.
- Live Video panel: a YouTube grid tiling the curated EAA cams (Warbirds,
  Ultralights, Seaplane Base, Green Dot, Vintage, Boeing Plaza, and the
  opening-weekend featured stream), in a uniform grid or an emphasized
  one-big-tile-plus-rail layout.
  Every tile carries an always-visible name and LIVE/OFFLINE badge, an
  on-hover volume slider and mute toggle, and explicit emphasize/demote and
  fill-panel controls alongside the double-click gesture (a real YouTube
  embed can swallow clicks landing on its own picture, so the buttons are the
  guaranteed-reliable path).
  Fill-panel mode replaces the whole video panel with one feed; Escape
  returns to the grid.
  Offline or errored feeds show a labeled placeholder naming the feed, the
  videoId, and what to do, never a black tile.
  Per docs/design/Video.md's honest audio boundary, per-feed audio is
  IFrame-API volume/mute only, on the system default output device — YouTube
  audio cannot join the ATC engine's ducking, pan, or device routing.
- Three-panel resizable walking-skeleton layout (react-resizable-panels): ATC
  audio (left), flight tracking (top right), live video (bottom right), with a
  Help/About dialog.
- Embedded FlightRadar24 browser panel: a native `WebContentsView` on a
  persistent `persist:fr24` session (login and passed Cloudflare challenges
  survive relaunch), a plain-Chrome user agent, back / forward / reload / home
  navigation with a read-only address and loading indicator, pop-up blocking with
  external links opening in the system browser, and last-URL restore so the map
  reopens where it was left.
- Native view bounds track the flight-tracking region gap-free (rAF-throttled),
  and the view hides beneath overlays (the z-order rule) so dialogs are never
  trapped behind it.
- Typed IPC contract (`src/shared/ipc.ts`) shared across main, preload, and
  renderer, exposed to the renderer as a typed `window.api`.
- Project scaffold: electron-vite + TypeScript + React substrate (main / preload
  / renderer, strict TypeScript, three tsconfigs).
- Privileged `app://` custom scheme serving the packaged renderer from a secure,
  non-`file://` origin.
- Seed-kit toolchain adoption: justfile task verbs, pre-commit hooks
  (gitleaks / eslint / prettier), tiered GitHub Actions CI, GitVersion, and the
  developer docs home (`Getting-Started.md`, `Testing.md`).
- Test substrate: vitest unit tier and a Playwright-for-Electron launch smoke.

### Changed

### Fixed

### Deprecated

### Removed

### Known Issues

- Alpha artifacts are unsigned — macOS Gatekeeper and Windows SmartScreen show
  first-launch warnings (documented in `docs/development/TechStack.md`).
