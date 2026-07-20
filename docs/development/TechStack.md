> Status: draft | Audience: contributors evaluating or extending the stack | See also: [../README.md](../README.md) (docs index), [../Implementation-Plan.md](../Implementation-Plan.md) (forward work), [../design/Audio.md](../design/Audio.md), [../design/Video.md](../design/Video.md), [../design/Tracking.md](../design/Tracking.md) (the three pillar design docs)

# Tech stack

Airshow Traffic Monitor is built as an Electron + TypeScript + React desktop app, not a web app and not a from-scratch native build.
Two of the app's three pillars force that call: FlightRadar24 refuses to be embedded in any browser page at all, and per-stream ATC audio needs OS-level output-device routing plus real multi-window support that a browser tab can't provide.
The whole toolchain — shell, build, state, testing, governance — was locked with the user on 2026-07-18 in one pass, so a usable alpha could ship by the Monday 2026-07-20 show open.
This document covers what's in the stack, why, what it costs, and what's worth revisiting once the show-week deadline stops driving every call.

## The stack

Locked as one decision (decision 2026-07-18) rather than assembled piecemeal.

| Layer | Choice | Role |
| --- | --- | --- |
| Desktop shell | Electron | One Chromium + Node runtime hosting all three pillars; native multi-window |
| Language | TypeScript (strict) | One typed language across main, preload, and renderer |
| UI library | React | Component model for panels, grid tiles, and controls |
| Dev/build | electron-vite | Dev server (HMR) and production bundling for main/preload/renderer |
| Packaging | electron-builder | 3-OS packaging (macOS/Windows/Linux) → GitHub Releases, unsigned for alpha |
| Renderer state | zustand | Per-window store; works outside React so the audio-engine singleton can write into it directly |
| Layout | In-house split-tree canvas (no dependency) | A serializable panel-layout tree, one absolutely-positioned canvas render, custom splitters + header drag-to-dock — see § Panel layout system below |
| Config validation | zod | Validates `config.json` (feed defs, VAD/duck params) on load |
| Session persistence | electron-store | `session.json` — window bounds, panel layout, per-stream settings, popouts — via atomic writes |
| Unit testing | vitest | Pure-function coverage: VAD, ducking, `.pls` parser, config schema, bounds validator |
| E2E testing | Playwright for Electron | Launch + smoke tests against the built app |
| Task runner | just | Verb vocabulary: `dev`, `test`, `e2e`, `lint`, `fmt`, `typecheck`, `version`, `up`, `reset` (+ `site`, `site-preview` from Phase 5) |
| Repo hygiene | pre-commit + gitleaks | Blocks committed secrets locally, mirrored in CI |
| Binary assets | Git LFS | Images and audio fixtures are LFS objects from first commit (decision 2026-07-18); git history carries only pointers |
| Versioning | GitVersion | Computed SemVer from GitHubFlow history (`develop` → `-alpha.N`); merge-commits-only |
| CI | GitHub Actions (tiered) | Fast tier (lint/typecheck/unit) on PRs; full gate (+ e2e, `npm audit`) into main |
| Docs site | MkDocs Material | Generates the public GitHub Pages site from `docs/` (Phase 5); site machinery lives in `website/`, content stays in `docs/`. A Python toolchain in a TypeScript repo is the accepted tradeoff for its docs UX (decision 2026-07-18) |

Electron is the pivot; see "Why this stack" below for the requirement that makes a full browser engine plus native window/process control non-negotiable.
Everything else follows from having made that call: electron-vite and electron-builder are the standard scaffold/packaging pair for it; zustand and zod are small libraries that each solve one problem rather than a framework that solves all of them (the panel layout itself is in-house — no layout dependency at all, see § Panel layout system below); and the testing/governance layer — vitest, Playwright, just, pre-commit + gitleaks, GitVersion, tiered GitHub Actions — is adapted wholesale from `project-seed-kit` rather than designed from scratch, so the alpha starts with a working CI/release pipeline instead of building one under a five-day deadline.
The phased build order this stack enables — audio engine first, an early FR24 walking skeleton because bounds-sync is the biggest layout risk, YouTube grid third — is tracked in [../Implementation-Plan.md](../Implementation-Plan.md).

## Why this stack

Three feasibility probes run by curl on 2026-07-18 settled the shape of the app before any code existed:

- **ATC audio — no proxy needed.**
  LiveATC's `.pls` targets resolve through Icecast to `audio/mpeg` streams that send `access-control-allow-origin: *` on both redirect hops.
  A `<audio>` element's `MediaElementAudioSourceNode` can feed a Web Audio graph directly from the renderer — nothing needs to sit between the stream and the activity-detection analyser.
  This is what makes the per-stream VAD/ducking/pan graph in [../design/Audio.md](../design/Audio.md) possible without a backend service.
- **YouTube grid — embeddable as designed.**
  EAA's live channels return `200` on oEmbed, confirming the IFrame Player API can embed them with per-feed control (volume, mute, layout).
  See [../design/Video.md](../design/Video.md) for the grid/emphasis behavior this enables.
- **FlightRadar24 — needs a real browser, not a web page.**
  FR24 sends `x-frame-options: SAMEORIGIN` and Cloudflare-challenges anything that doesn't look like a browser.
  No `<iframe>` and no plain page fetch gets past that; the panel needs its own browser context with full navigation, which is what Electron's `WebContentsView` provides.
  See [../design/Tracking.md](../design/Tracking.md).

None of the three strictly requires Electron on its own — a browser page could satisfy the first two alone.
It's the third that rules out a plain web app outright, and once a desktop shell is required anyway, the rest of the requirements stop being separate problems:

- **One Chromium, one behavior surface.**
  The same rendering/media engine handles ATC `<audio>` elements, the YouTube IFrame grid, and the FR24 `WebContentsView`, on all three target OSes — one set of quirks to learn instead of three (Safari, Chrome, Edge/WebView2).
- **`AudioContext.setSinkId` gives per-stream output-device routing** (decision 2026-07-18) — headphones for Tower, speakers for everything else — inside the same renderer process, with no OS-level routing tool required.
- **Multi-window is a first-class, mature API.**
  Pop-out `BrowserWindow`s for the video grid, per-window bounds/display persistence, and session restore across monitors are well-trodden Electron territory, not something bolted on.
- **One typed IPC contract.**
  TypeScript spans main, preload, and renderer; `src/shared/ipc.ts` is the single contract all three compile against, so a bounds-sync or config-shape change is a compile-time error everywhere it's used, not a runtime surprise in one process.
- **The RAM tradeoff is accepted, not ignored.**
  Electron's multi-process model costs real memory next to a single native binary.
  Weighed against what it replaces — six standalone VLC instances, a separate FR24 browser window, and dozens of YouTube tabs across two monitors — the prototype this app retires was never light either.

## Session restore and pop-outs (Phase 4)

Full session restore is backed by a single `session.json` written through `electron-store` (decision 2026-07-19).
The main process holds the session state authoritatively in memory: every `session:patch` merges into that live object immediately — so a read right after a write is consistent, which the audio engine relies on — and schedules a trailing-debounced (~500 ms) atomic flush to disk.
Coalescing a slider drag's storm of patches into one write is the point of the debounce; a guaranteed flush on `will-quit` means a last-second change still inside its debounce window is never lost.
The merge, the defensive sanitizer, and the pop-out bookkeeping are a pure module (`src/shared/session.ts`) so they are unit-tested without the store or a window.
The restored surface is window bounds and display, the panel layout (the split tree, maximize state, per-feed fit/fill, and any named layout profiles — see § Panel layout system below), per-stream volume/mute/pan, the video layout, every pop-out, and the FR24 last URL.

Per-stream volume, mute, and pan are session-restored, but priority is deliberately NOT (decision 2026-07-19): `config.json` is priority's live tuning surface, so it is re-derived from config on every launch rather than pinned in the session, where a stale value would silently override an edited config.

A window's saved bounds are validated against the displays that exist at launch by a pure, Electron-free function (`src/shared/windowBounds.ts`, decision 2026-07-19): a sufficiently-visible window is left where it was, and one that is off-screen — a disconnected monitor, a display resized smaller — is recentred (and shrunk to fit) onto its last display if it survives, else the primary.
This is what makes the Phase 4 exit criterion hold: a pop-out saved on a second monitor reappears on the primary when that monitor is unplugged, never off-screen and invisible.

Pop-outs are grid-only windows that load the SAME renderer bundle at `?window=popout&id=N` (decision 2026-07-19); the preload reads that query to mount a video-only view (no ATC engine, no FR24 view) for a subset of feeds.
The main process owns every pop-out `BrowserWindow` and its session slice — bounds/display, feeds, layout, per-feed volumes — with bounds tracked main-side and layout/volumes persisted by the pop-out renderer through the `windows:*` channels.
Opening a pop-out hands its feeds off the main grid (a broadcast of the open set drives the hide/return in every window) and closing it returns them; quitting the app preserves the pop-out slices for next-launch restore, while a user closing one pop-out forgets it.

## Panel layout system

The main window's panel arrangement (see [../design/Layout.md](../design/Layout.md) for the operator-facing behavior this implements) is a small, in-house piece of machinery rather than a layout library, built and landed across a dedicated six-PR sequence (`feature/panel-layout-core` through `feature/panel-drag-dock`).

- **A serializable split tree, not an opaque layout string.**
  The arrangement is a plain data structure — splits with an orientation and percentage sizes, leaves naming a panel id (`src/shared/panelLayout.ts`) — stored as `session.panelLayout` (decision 2026-07-19) and shared verbatim between the live store and the persisted session, so there is nothing to serialize/deserialize beyond ordinary JSON.
  A never-throw sanitizer degrades any hand-edited or corrupt tree to the built-in default rather than blocking a relaunch.
- **One single-container canvas render, not nested layout components.**
  A pure function maps the tree plus the container's pixel size onto a flat list of leaf rectangles and splitter segments (a guillotine partition — every leaf and splitter tiles the container exactly, no gaps or overlaps).
  Every open panel renders as an absolutely-positioned sibling inside ONE container, always in a fixed order sorted by panel id — never by tree position — so rearranging, snapping to a different template, or maximizing a panel is purely a restyle: React never reorders or reparents the panel DOM, which is what lets a video feed's embedded player survive every one of those operations without reloading (decision 2026-07-19).
- **Custom splitters.**
  A small pointer-capture-driven divider component (pure clamp math, a per-panel-kind minimum pixel floor, `role="separator"` plus arrow-key resizing) replaces what a layout library's own divider would otherwise provide.
- **Header drag-to-dock via pure hit-testing, not `elementFromPoint`.**
  Dragging a panel by its header hit-tests the pointer position against the SAME computed leaf rectangles the canvas already renders from — never `elementFromPoint`, which a live YouTube iframe or the FR24 native view would simply swallow.
  `setPointerCapture` on the canvas container makes this reliable even while the pointer is directly over one of those hosts (decision 2026-07-20; see [../decisions/README.md](../decisions/README.md)).
  A native-menu "Move panel…" command and an accessible on-screen dialog reach the exact same move operation without a pointer gesture, and landed first as the dependency-free, e2e-deterministic fallback.
- **Native menus, not DOM overlays, for anything that must sit above the map.**
  The FR24 panel is the one `WebContentsView` in the app and paints above all DOM (see Known limitations below); anything that needs to present controls over that region — closing/reopening a panel, picking a saved layout — uses a native application menu (`src/main/menu.ts`) synced from the renderer over a small typed IPC pair, rather than an HTML overlay that the native view would simply paint over.
- **Snap layouts: templates and named profiles, both just tree values.**
  A small catalog of ready-made template shapes, and any number of the operator's own named, saved trees, are both stored and applied exactly like the live tree itself — switching between them is a single tree replacement, so a panel present in both the old and new arrangement never remounts.

This replaced `react-resizable-panels` (decision 2026-07-20; the dependency is fully removed from `package.json`): that library's Group component is uncontrolled with its own in-lifetime layout cache, which fights a tree that needs to be replaced wholesale on every template/profile switch and reopen — see the exploration notes in the panel-system planning doc for the specific mechanisms that motivated building this in-house instead. Pop-outs never used it (they keep a plain CSS grid) and are unaffected by its removal.

## Versioning and releases

The version is computed from git history, never hand-edited (decision 2026-07-18) — `package.json` stays at `0.0.0` on purpose.
GitVersion reads the GitHubFlow history: every commit on `develop` is an `-alpha.N` pre-release (for example `0.1.0-alpha.7`), and the real major/minor/patch is decided only when `develop` is released to `main` and tagged.
CI is the authoritative computer of that version — the `version` job in [ci.yml](https://github.com/ericwait/airshow-traffic-monitor/blob/main/.github/workflows/ci.yml) runs GitVersion on a full-history checkout, and `just version` is a local convenience that prints the same SemVer and degrades to an install hint when GitVersion is absent.
Releases are cut by pushing a `v` + SemVer tag (for example `v0.1.0`): [release.yml](https://github.com/ericwait/airshow-traffic-monitor/blob/main/.github/workflows/release.yml) gates on a matching `CHANGELOG.md` section, builds the unsigned three-OS installers, stamps the tag's version onto the artifacts, and publishes them to a GitHub Release.
A tag carrying a pre-release identifier (the `-` in `v0.1.0-alpha.1`) publishes as a GitHub pre-release; a clean `v0.1.0` publishes as a full release.

## Known limitations

- **YouTube audio is volume/mute only.**
  The IFrame Player owns its media element across an origin boundary; it can't be handed to the Web Audio graph for analysis, and it can't be routed to a specific output device with `setSinkId`.
  Every YouTube tile plays through the OS default output device — a hard cross-origin limitation, not a missing feature.
- **The packaged renderer is served over a loopback HTTP origin, not a custom scheme (decision 2026-07-19).**
  The YouTube IFrame Player API validates the origin embedding its player and rejects the `app://` custom scheme with error 153 — verified in Phase 3, where the grid loaded from the electron-vite dev server but went blank from a packaged `app://` build.
  The fix is a tiny loopback HTTP server bound to `127.0.0.1` on an ephemeral port, serving the built renderer from `out/renderer` (`src/main/rendererServer.ts`); the main window loads `http://127.0.0.1:<port>/index.html` instead of `app://`.
  A `127.0.0.1` origin is still a secure context, so `enumerateDevices`/`setSinkId` and the postMessage handshakes keep working, and nothing is exposed off-host.
  The `app://` scheme stays registered as a logged, degraded fallback used only if the loopback socket fails to bind (YouTube tiles are then blank, but audio and FR24 are unaffected).
  This supersedes the earlier plan to serve the packaged renderer from `app://`; the once-blank-in-packaged-builds YouTube grid now plays.
- **The FR24 panel paints above all DOM (z-order law).**
  `WebContentsView` composites above the page, not inside it — an HTML modal or overlay cannot cover it.
  Anything that needs to appear over the FR24 region must call `fr24:setVisible(false)` first; anything transient over it should use native Electron menus instead of DOM overlays.
- **Electron's RAM footprint.**
  The main window, any pop-outs, and the `WebContentsView` each carry Chromium overhead; total memory use is higher than an equivalent native app's.
  See the tradeoff note above.
- **Git LFS vs the legacy Pages build.**
  Binary assets are LFS-tracked (decision 2026-07-18), and the current branch-based Pages build serves LFS *pointer files* — so images on the published docs site stay broken until the Phase 5 Actions-based site build (LFS-aware checkout) replaces it.
  GitHub's own rendering of the repository's markdown is unaffected.
- **MkDocs 2.0 breaks the docs toolchain; pinned to 1.x.**
  MkDocs 2.0 is a from-scratch rewrite that removes the plugin system and rewrites theming with no 1.x migration path, breaking Material for MkDocs and with it this site's `custom_dir` overrides (the home-page advertisement and social-card meta) and the pymdownx extensions.
  `website/pyproject.toml` therefore pins `mkdocs<2` — mkdocs-material 9.x does not cap the core itself, so without this a lockfile refresh could silently pull 2.0 once it ships (decision 2026-07-20).
  The Material team has stopped development in favor of Zensical, a 1.x-compatible successor, which is the eventual migration path (see the Implementation-Plan backlog).
- **Alpha artifacts are unsigned.**
  `electron-builder` runs with `CSC_IDENTITY_AUTO_DISCOVERY=false` for the alpha pipeline — no signing certificate exists yet.
  macOS Gatekeeper requires a right-click → Open on first launch; Windows SmartScreen shows an "unrecognized app" warning requiring "More info → Run anyway."
  Both are cosmetic, not functional.
  Resolved post-show — see Future explorations.
- **Bluetooth output lags wired output by 150–300 ms.**
  This is an OS/Bluetooth-stack characteristic, not something the app compensates for; a time-critical stream routed to a Bluetooth device reads as slightly delayed against the same traffic on a wired stream.
- **Chromium-version coupling.**
  Media behavior — codec support, autoplay policy, hardware-decode paths — is whatever ships with the bundled Electron version, not independently upgradable.
  Known live risk: pre-M3 Apple Silicon Macs may fall back to software AV1 decode across five simultaneous YouTube tiles, a CPU cost worth checking (`chrome://gpu`) rather than assuming away; the mitigation is smaller tiles or fewer concurrent feeds.
- **LiveATC blocks non-browser user agents.**
  Every `.pls` resolve and stream fetch from the main process must send a browser-like `User-Agent`; a bare or bot UA is refused outright.
  Handled today in `plsResolver.ts`, but it constrains any future code path touching LiveATC — it can never be a plain server-side fetch with default headers.
- **Field weather is sourced from a free, keyless NOAA aviation-weather data API (decision 2026-07-19).**
  Current conditions and a short-range forecast for the tracked airfield (see [../design/Weather.md](../design/Weather.md)) are fetched from `aviationweather.gov`'s Data API — `GET /api/data/metar?ids=<station>&format=json` and `GET /api/data/taf?ids=<station>&format=json` — a public US-government service that needs no API key and publishes no rate limit.
  Unlike LiveATC, this API expects programmatic callers rather than browsers, so "polite client" here means a descriptive User-Agent (app name, version, and a link to this repository) instead of browser impersonation, fetched only from the main process (`src/main/weather.ts`) and cached; polling never runs more often than every 5 minutes, 10 by default (`config.weather.pollMinutes`).
  The API's own decoded flight-category field is deliberately not trusted — the app re-derives VFR/MVFR/IFR/LIFR from ceiling and visibility itself (`src/shared/weather.ts`), so the category logic stays unit-testable and independent of this one source's own decoding.

## Alternatives considered

**Tauri 2 + Rust.**
Much lighter than Electron — no bundled Chromium duplicated per window — and would allow native audio DSP in Rust.
Rejected for this alpha: multi-webview support (needed to host the FR24 panel alongside the rest of the UI, Tauri's analogue of `WebContentsView`) was still unstable at evaluation time; the macOS WebView backend (WKWebView) has known media/autoplay quirks that would complicate the YouTube grid; VAD/activity detection would need custom Rust audio decode instead of reusing Web Audio; and all of it added schedule risk against a five-day alpha deadline.
Revisit once multi-webview stabilizes — see Future explorations.

**Native macOS SwiftUI.**
Best achievable performance and battery life, and `AVAudioEngine` is a strong fit for the audio graph.
Rejected: it only runs on macOS, and cross-platform (macOS + Windows + Linux) was already a locked requirement — going native here means either dropping that requirement or building and maintaining two more native implementations from scratch.
It also doesn't avoid embedded web views: YouTube and FR24 still need them inside a "native" shell, undercutting the main reason to go native in the first place.

**Plain web app.**
Simplest option — no packaging, no installer, just a page.
Rejected outright on one hard requirement: FlightRadar24 cannot be embedded in any browser page (`x-frame-options: SAMEORIGIN` blocks the iframe, and a web page has no way to open a full navigable browser panel inside itself).
Multi-window pop-outs and audio autoplay are also far more restricted and less controllable from a browser tab than from an app that owns its own windows.

## Future explorations

- **Revisit Tauri 2** once its multi-webview story stabilizes — still the biggest available RAM win if the FR24-panel blocker clears.
- **A native audio sidecar process** for DSP-heavy features that don't belong on the UI thread — noise reduction, or transcription via a local speech model running on the already-ducked buffers.
- **Loopback/virtual-device audio capture**, to lift the YouTube audio-routing limitation above by capturing system audio output instead of relying on `setSinkId` inside the iframe's cross-origin player.
- **Signed and notarized installers with auto-update**, once a certificate exists and the alpha's unsigned-artifact warnings need to go away for wider distribution.
- **Performance budget work** if the number of concurrent audio or video feeds grows past what today's per-stream `AudioContext` / per-tile IFrame approach was sized for.
