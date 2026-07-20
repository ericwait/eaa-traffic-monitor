# Panel system plan — VSCode-style modular panels with custom snap layouts

Status: proposed plan, not yet implemented (drafted 2026-07-19).
This document is the working reference for the panel-system effort;
decision stamps and `docs/decisions/README.md` rows land with the implementing commits, not here.

## Context

The app today is three hard-coded pillars (`LayoutShell.tsx`: ATC audio | FR24 / video grid) with two drag dividers.
The goal is VSCode-style modularity:
first-class panels for audio, weather (currently nested inside the audio column), FR24, and each video stream;
free rearrangement;
custom "snap" layouts;
and videos that fit or stretch to their panel.
This aligns with two existing backlog items ("Named layout profiles", "Stream add/remove management UI" — the latter stays out of scope).

Direction settled with the owner on 2026-07-19:

- Custom drag-to-arrange with NO new dependency.
- Snaps = BOTH a template gallery and named saved layouts, and switching must not reload video streams.
- Per-video-panel Fit/Fill toggle (default Fit, persisted per feed).
- No tabs in v1.
- Pop-outs stay the multi-window mechanism.

## Exploration summary (verified against the code)

- `react-resizable-panels` v4.12.2, `zustand`, `zod`, and `electron-store` are all already shipped and in use.
  Phases 0–6 are merged; only the v0.1.0 tag remains.
- Weather is fully built (`src/main/weather.ts`, `weatherPoller.ts`, `src/shared/weather.ts`, `WeatherPanel.tsx` mounted inside `AudioPanel.tsx`) — promotion is re-homing, not new data work.
- The audio engine is a module singleton (bottom of `src/renderer/src/audio/engine.ts`) surviving unmount; the audio UI can move freely.
- `VideoTile.tsx` creates a real `YT.Player` in an effect and destroys it on unmount,
  so any React re-parent or keyed sibling reorder (`insertBefore`) reloads the stream.
  Today's "fill" mode actually destroys the other six players — the new design must beat that.
- FR24 is the only `WebContentsView` (`src/main/fr24.ts`), a child of `mainWindow.contentView`, painting above all DOM; occlusion is only `setVisible(false)`.
  Renderer-side, `Fr24Panel.tsx` self-measures its region (`getBoundingClientRect` + ResizeObserver + window resize + `FR24_RELAYOUT_EVENT`, rAF-throttled, `boundsEqual`-deduped) and sends `fr24:setBounds`.
  The store field `overlay: OverlayKind | null` (renamed from the boolean `overlayOpen` by the channel-manager work) drives `setVisible(overlay === null)`.
- Session: `session.json` via electron-store (`src/main/session.ts`), typed contract in `src/shared/ipc.ts`, sanitizers in `src/shared/session.ts` that never throw;
  500 ms debounced atomic flush; hydrated pre-mount (`sessionBootstrap.ts`) so there is no restore flash.
- A design review read the rrp v4 dist source: the Group is uncontrolled;
  an in-lifetime layout cache outranks `defaultLayout` on re-bootstrap;
  `defaultLayout` is discarded on any panel-id-set mismatch and on zero-size mount deferral.
  Driving a dynamic, profile-switched tree through rrp means fighting three interacting size mechanisms plus remount discipline.

## Architecture: single-container canvas (not rrp + a media layer)

Render the whole panel area as one absolutely-positioned canvas:

1. A pure serializable layout tree (splits with orientation + percentage sizes; leaves = panel ids) lives in the store and session.
2. One pure function maps tree + container size to leaf rects + splitter segments (guillotine partition) —
  the same shape as the existing, e2e-proven `computeVideoLayout` pattern.
3. All leaves render as stable-keyed siblings in one container, in fixed id-sorted DOM order, forever.
  Visual placement is style-only.
  React therefore never reorders or reparents panel DOM, so video iframes structurally cannot reload on drag-move, snap switch, close/reopen of other panels, or maximize.
4. A custom splitter component (~150–250 lines: pointer capture, pure clamp math, `role="separator"`, arrow-key resize, ≥10 px hit area).
5. `Fr24Panel` drops in essentially unchanged — its self-measuring region div is simply positioned by the canvas.
6. Maximize = the maximized leaf gets the full rect and all other leaves get `visibility: hidden`
  (players keep running — strictly better than today's fill mode).

Why not recursive rrp Groups plus a portal "media layer":
the rrp v4 uncontrolled-layout edges above;
a profile switch that keeps the same panel set but different sizes would silently not apply without extra remount tricks;
and the media layer metastasizes, because all video chrome (overlays, badges, controls) would have to migrate into it.
The canvas deletes both problem spaces at the cost of one well-tested splitter.
After this lands, `react-resizable-panels` has no consumers left (pop-outs use the plain CSS grid) — remove the dependency in the final PR with a decision stamp.

Load-bearing invariant (comment loudly at the render site):
leaves render sorted by panel id, never by tree position.
A keyed reorder executes `insertBefore` and reloads every iframe.

## Data model and persistence

New pure domain module `src/shared/panelLayout.ts` (Electron/DOM-free — it compiles in both tsconfigs):

```ts
type PanelId = 'audio' | 'weather' | 'fr24' | `video:${string}`
interface LayoutLeaf { type: 'leaf'; id: PanelId }
interface LayoutSplit { type: 'split'; id: string; orientation: 'horizontal' | 'vertical';
                        children: LayoutNode[]; sizes: number[] /* pct, sum ~100 */ }
type LayoutNode = LayoutLeaf | LayoutSplit
interface LayoutProfile { name: string; tree: LayoutNode }
type VideoFitMode = 'fit' | 'fill'
interface PanelLayoutSession { tree: LayoutNode; maximizedPanelId: PanelId | null;
                               videoFit: Record<string, VideoFitMode>; profiles: LayoutProfile[] }
```

Session changes (`src/shared/ipc.ts` + `src/shared/session.ts`):

- Add `panelLayout: PanelLayoutSession | null` to `SessionState` and `SessionPatch` (whole-section replace, like `window`).
- Remove `SessionState.layout` (the rrp `LayoutStorage` strings — library-owned, no longer read) and the top-level `SessionState.video`.
  Keep `VideoLayoutState` and `PopoutState.video` — pop-outs still use uniform/emphasized/fill.
- `sanitizePanelLayoutSession` / `sanitizeLayoutTree`: never throw;
  unknown leaf kinds and duplicate leaves dropped;
  1-child splits collapsed;
  non-finite sizes renormalized (else equal);
  depth cap;
  `maximizedPanelId` not in tree becomes null;
  anything malformed becomes `null` (= use the default tree).
- Migration is drop-and-default.
  Old sessions load with `panelLayout: null`; legacy keys stop being read and fall off on the next flush.
  At hydrate, prune `video:` leaves whose feed id is not in `defaultFeeds` and against restored pop-outs;
  an emptied tree falls back to `buildDefaultTree`.
  Downgrade to an old build is safe but loses the new layout section (document it).

## Pure-function inventory (all guardian-tested; template `tests/unit/videoLayout.test.ts`)

In `src/shared/panelLayout.ts`:
`collectLeafIds`, `normalizeTree`, `removePanel`, `splitPanel(tree, targetId, newLeaf, edge, sharePct)`, `swapPanels`, `movePanel(tree, id, DropTarget)`, `insertPanelBalanced` (reopen path), `updateSplitSizes(tree, splitId, sizes)` (epsilon no-op returns the same reference), `buildBalancedGrid` (7 feeds → rows [3,2,2]), `buildDefaultTree` (mirrors today's 22/78 + 62/38 arrangement with weather split below audio), `pruneVideoLeaves`, `treesEqual`, the sanitizers,
plus `computeLayoutRects(tree, containerRect, splitterPx)` returning `{ leaves: {id, rect}[], splitters: {splitId, index, orientation, rect}[] }`,
and a min-px clamp helper for splitter drags.

- `src/shared/layoutTemplates.ts`: template catalog (`default`, `2x2`, `big-left`, `tall-right`, `three-columns`) as zone trees, plus `instantiateTemplate(template, zoneAssignment, openVideoIds)`.
  Unassigned zones collapse; a `video-rest` zone becomes `buildBalancedGrid` of unassigned feeds.
- `src/shared/videoGeometry.ts`: `computeAspectRect(containerSize, mode, aspect = 16/9)` —
  fit = largest inscribed 16:9 centered; fill = smallest covering 16:9 centered (cropped by `overflow: hidden`); integer output, never NaN.
- `src/renderer/src/layout/dropZones.ts` (pure, vitest-importable via `@renderer`):
  `hitTestDropZone(point, leafRects, rootRect)` returning an edge/center/root-edge `DropTarget`;
  `dropHighlightRect`;
  `withHysteresis` (the current target sticks until the pointer exits its highlight rect + 8 px).

## File inventory

New renderer files (`src/renderer/src/layout/`):

- `PanelCanvas.tsx` — container ResizeObserver → size state; renders id-sorted leaves + splitters from `computeLayoutRects`; ephemeral local sizes during splitter drags, store commit on release.
- `LeafFrame.tsx` — `.panel-head` chrome (title, fit toggle for video, pop out, move, maximize, close); body hosts AudioPanel / WeatherPanel / Fr24Panel / VideoTile.
- `Splitter.tsx`, `useHeaderDrag.ts` (drag state machine), `DragOverlay.tsx` (drop-zone highlight + light ghost).
- `MovePanelModal.tsx` — deterministic keyboard/e2e move path, the `overlay` pattern (register a `'move-panel'` `OverlayKind`).
- `LayoutManagerModal.tsx` — template gallery + zone assignment + named profiles.
- `panelMeta.ts` (PanelId → title/kind, joins `defaultFeeds`), `menuBridge.ts` (store ↔ native menu IPC).

New main-process file: `src/main/menu.ts` —
application menu with a Layout menu (manager, save, reset, profile radios with `CmdOrCtrl+Alt+1..9`) and a Panels menu (open/close checkboxes),
rebuilt on `layout:menuSync`, clicks forwarded as `layout:command`.
Native menus paint above FR24 (the sanctioned surface).

Modified:
`src/shared/ipc.ts` (two new channels `layout:menuSync` / `layout:command`, `AppApi.layout`, session types),
`src/shared/session.ts`,
`src/preload/index.ts`,
`src/main/ipc.ts` (narrowing),
`src/main/index.ts` (menu wiring),
`state/store.ts` (slice swap below),
`state/sessionBootstrap.ts` (delete `layoutStorage` / `hydrateVideoLayout` / `startVideoLayoutPersistence`; add `hydratePanelLayout` + `startPanelLayoutPersistence` + pop-out↔tree reconcile),
`components/LayoutShell.tsx` (header + PanelCanvas + overlays + FR24 rule),
`components/Fr24Panel.tsx` (unchanged measurement; becomes a leaf body),
`components/VideoTile.tsx` (optional props: `fitMode`; emphasize/fill buttons render only for pop-outs),
`components/VideoGrid.tsx` (deleted from the main window; `computeVideoLayout` + the grid path stay for `PopoutApp.tsx`),
`audio/AudioPanel.tsx` (remove the nested WeatherPanel),
`assets/main.css`,
`src/renderer/src/main.tsx`.

## Store slice (`state/store.ts`)

Remove `videoLayoutMode` / `emphasizedFeedId` / `fillPanelFeedId` and their actions
(`just typecheck` then lists every stale consumer to burn down).
Add `panelTree`, `layoutRevision` (bumped on structural commits), `maximizedPanelId`, `dragPanelId`, `videoFit`, `layoutProfiles`, `activeProfileName` (store-only; cleared by any structural edit),
plus actions delegating to the pure ops
(`applyTree`, `movePanel`, `closePanel`, `openPanel`, `updateSplitSizes`, `toggleMaximize`, `setVideoFit`, `setDragPanelId`, profile CRUD).
The `overlay: OverlayKind | null` field already exists (introduced by the channel-manager work, replacing the old boolean `overlayOpen`); this phase only extends the `OverlayKind` union with `'move-panel'` and `'layout-manager'` — it does not re-add an overlay flag.

Consolidated FR24 visibility rule (replaces the `overlay === null`-only effect):

```
fr24Visible ⟺ treeHasLeaf('fr24') ∧ overlay === null ∧ dragPanelId === null
            ∧ (maximizedPanelId ∈ {null, 'fr24'})
```

Single-writer sequencing:
hide transitions apply immediately (synchronously at drag start — the native view eats pointer events, so hiding during drags is required, not cosmetic);
the hidden→visible transition waits two rAF ticks after the tree commit so the freshly measured `fr24:setBounds` lands first (both are ordered fire-and-forget sends).
This also fixes the existing latent stale-bounds flash on modal close.
Mirror the flag as `data-fr24-hidden` on `.app-shell` for e2e.
Keep dispatching `FR24_RELAYOUT_EVENT` during splitter drags and after structural commits (`layoutRevision` effect) — `Fr24Panel`'s existing rAF-throttled listener does the rest.

## Key interactions

- Splitter drag: pointer capture on the splitter; pure clamp (min px per leaf, e.g. audio/fr24 200, weather 160, video 120);
  ephemeral sizes during the drag; store commit (`updateSplitSizes`) on release; relayout event per move.
- Header drag-to-dock: pointerdown on `.panel-head` (not on buttons) → 4 px slop → dragging;
  `setPointerCapture`;
  hit-test against computed rects from state (never `elementFromPoint`);
  zones = center 40% box (swap), nearest edge (split at 50%), `.app-body` edges within 24 px (root dock at 25%);
  hysteresis;
  video hosts get `pointer-events: none` during drags;
  Escape cancels.
  Commit = one store `set` (tree + `dragPanelId = null`).
- Move without drag: every header has a "Move panel…" button opening `MovePanelModal` (target + placement radios) committing the same `movePanel` op —
  the accessible and e2e-deterministic path, landed before drag exists.
- Maximize: header/tile double-click or button; Escape restores;
  others get `visibility: hidden` (streams keep playing — document that an unmuted hidden feed stays audible, consistent with the ATC mix philosophy).
- Snaps: `LayoutManagerModal` under the `overlay` pattern (a `'layout-manager'` `OverlayKind`) —
  template cards (mini flex previews) → per-zone assignment dropdowns (each panel once; `video-rest` for the remainder; sane default pre-fill) → `applyTree`.
  Named profiles: save (deep copy), apply, rename, delete; persisted in `session.panelLayout.profiles`; accelerators via the native menu.
- Snap switching and players: the canvas diffs leaf sets —
  feeds present in both keep their DOM (no reload, the requirement);
  feeds absent from the new tree unmount (player destroyed — that profile excludes them);
  new feeds mount fresh.
- Pop-out interplay: a popped-out feed triggers `removePanel`; closing the pop-out triggers `insertPanelBalanced`;
  hydrate prunes against restored pop-outs.
  `PopoutApp`, the `windows:*` channels, and `PopoutState` are untouched.
- Video fit/fill: `LeafFrame` applies `computeAspectRect(leafRect, videoFit[feedId])` to a `.video-tile-stage` wrapper inside the overflow-hidden leaf body;
  toggle in the header, `data-fit-mode` attribute.

## CSS (additions to `assets/main.css`, reusing `.panel`, `.panel-head`, `.separator*`, `.modal-*`)

`.panel-canvas` (relative container),
`.leaf-frame` (absolute; column flex; `data-panel-id`),
`.panel-head--draggable/--dragging`, `.panel-head-actions/-btn`,
`.panel-slot` (relative, `overflow: hidden`),
`.video-tile-stage` (absolute fit/fill target — `.video-tile-player` keeps `inset: 0` within it),
`.splitter.-vertical/-horizontal` (≥10 px hit area, visible 1 px line via the existing separator look),
`.drag-layer` (fixed, z-60) + `.dropzone-highlight` (`data-zone`) + `.drag-ghost` (z-70),
`.leaf-frame--hidden` (`visibility: hidden`),
and template-gallery/profile classes inside the existing `.modal` shell.
Z-order: leaves are normal flow < drag layer 60 < modals 100; the FR24 native view is handled solely by the visibility rule.

## Test plan

Guardian unit suites (`tests/unit/`):

- `panelLayoutTree.test.ts` — ops, normalize idempotence, remove-last → null, move-onto-self identity plus untouched-subtree reference preservation, balanced grid shapes n=1..9, default tree mirrors today, prune.
- `panelLayoutSanitize.test.ts` — garbage, duplicate leaves, bad sizes, depth bomb, and a legacy-session fixture sanitizing to `panelLayout: null` with everything else intact; extend `session.test.ts` for the patch plumbing.
- `layoutRects.test.ts` — partition exactness (leaves + splitters tile the container), min-px clamping, splitter segments.
- `layoutTemplates.test.ts`, `videoGeometry.test.ts` (fit inscribed / fill covering / centered / integer / zero-safe), `dropZones.test.ts` (zones, root edges, hysteresis),
  plus a render-order guardian (`canvasRenderOrder` is arrangement-independent).

E2E (Playwright-Electron, existing `e2eEnv()` + YouTube network block + `FR24_URL_OVERRIDE=about:blank`):

- `panels.spec.ts` — default layout has all `data-panel-id` frames; weather is its own panel; close removes a frame; reopen restores;
  maximize via double-click sets `data-maximized` and Escape restores; the fit toggle flips `data-fit-mode`.
- `layoutProfiles.spec.ts` — apply the 2×2 template with assignments (structure asserted via rect geometry / DOM attributes);
  save a profile, perturb via MovePanelModal, re-apply;
  stream-survival proxy: an `elementHandle` captured inside a tile before the switch is still `isConnected` after.
- `panelDrag.spec.ts` — the single pointer-simulation test: header drag to another panel's east half, `dropzone-highlight[data-zone="east"]` visible, drop, assert structure and that `data-fr24-hidden` toggled true during the drag;
  FR24 native-view checks via `electronApp.evaluate` → `contentView.children[0].getVisible()/getBounds()`.
- `video.spec.ts` — rewritten for per-feed panels (drop the grid-mode assertions, keep label/badge coverage).

## Docs, decisions, changelog (stamps + rows land with the implementing commits)

- New `docs/design/Layout.md` (what/why): panel model, tiled tree with no tabs in v1, snaps = templates + profiles, maximize semantics including hidden-but-audible feeds, drag docking, pop-out interplay.
- `docs/development/TechStack.md`: a "Panel layout system" section (how): tree in session, canvas render, splitters, menu IPC;
  update the `react-resizable-panels` row when the dependency is removed.
- Decision stamps to record:
  (1) panel layout is a serializable split tree in `session.panelLayout`, rendered by a single-container canvas, retiring rrp and its `LayoutStorage` strings;
  (2) leaves render in fixed id-sorted DOM order so rearrangement can never reload embeds;
  (3) main-window uniform/emphasized/fill retired in favor of maximize + per-feed fit/fill (pop-outs keep grid modes);
  (4) custom drag-to-dock on pointer events + pure hit-testing, with native menus + a DOM Move-panel modal as the FR24-safe/accessible fallbacks;
  (5) `react-resizable-panels` dependency removed (final PR).
- `docs/Implementation-Plan.md`: move "Named layout profiles" out of Backlog into this phase; progress-log rows per PR.
  `CHANGELOG.md` under `[Unreleased]`.

## PR slicing (branches `feature/*` → PRs to `develop`, merge commits, app working after each)

1. `feature/panel-layout-core` — all pure modules (`panelLayout.ts` including `computeLayoutRects`, `layoutTemplates.ts`, `videoGeometry.ts`) + the additive session schema (legacy fields still written) + guardian suites + decision stamp 1. Zero behavior change.
2. `feature/panel-canvas-shell` (keystone) — PanelCanvas/LeafFrame/Splitter, LayoutShell rewrite, weather promoted, store slice swap, sessionBootstrap swap (legacy `layout`/top-level `video` removed), VideoGrid deleted (main window), VideoTile prop split, consolidated FR24 rule + two-rAF reshow, `video.spec.ts` rewrite + `panels.spec.ts` basics, stamps 2–3. The default layout looks identical to today.
3. `feature/panel-maximize-fit` — maximize + Escape, fit/fill toggle + persistence, e2e.
4. `feature/panel-menu-move` — close/reopen, MovePanelModal, `layout:menuSync`/`layout:command` + preload + `src/main/menu.ts` + narrowing, Panels menu.
5. `feature/layout-snaps` — LayoutManagerModal (gallery + assignment + profiles), accelerators, `layoutProfiles.spec.ts`, the Implementation-Plan backlog move.
6. `feature/panel-drag-dock` — useHeaderDrag, dropZones + guardian suite, DragOverlay, drag FR24 sequencing, `panelDrag.spec.ts`, stamp 4, and removal of `react-resizable-panels` (stamp 5). Pure polish risk — everything is already reachable via PR4's modal.

## Risks and mitigations

1. DOM-order invariant violated later → all streams reload.
  Loud comment at the render site + a render-order guardian + the `isConnected` e2e.
2. FR24 show-before-bounds race → the single-writer rule + two-rAF reshow;
  e2e asserts `data-fr24-hidden` transitions and native-view bounds.
3. Custom splitter quality → pure clamp/normalize guardians, ≥10 px hit areas, `role="separator"` + arrow keys;
  skip collapse/double-click-reset in v1.
4. Drag hit-testing over live iframes / the native view → pointer capture + rect math from state;
  hosts pointer-inert during drags;
  FR24 hidden for the whole drag;
  one manual live-stream test before the show.
5. Sanitizer bugs on corrupt or hand-edited sessions → a never-throw recursive sanitizer defaulting to the built-in tree, with fixture-based guardians.

## Verification

- Per PR: `just lint`, `just typecheck`, `just fmt`, `just test` clean; `just e2e` for the renderer-affecting PRs.
- After PR2: `just dev` — the default layout matches today's arrangement;
  splitters drag (FR24 tracks live);
  relaunch restores sizes;
  weather appears as its own panel;
  audio keeps playing while resizing.
- After PR5: create a 2×2 snap, save two named profiles, switch via menu hotkeys —
  video placeholders must not remount (and with real network, streams must not rebuffer when present in both profiles).
- After PR6: header-drag a video panel onto FR24's east edge;
  FR24 disappears during the drag and reappears at correct bounds;
  Escape cancels mid-drag.
- Manual FR24 checks (real site, not the e2e stub): open the About modal, drag panels, maximize audio —
  the map must never paint over DOM, and there must be no stale-bounds flash on reappear.
