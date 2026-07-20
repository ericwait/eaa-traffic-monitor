import { create } from 'zustand'
import type { Fr24NavState, WeatherResult, WeatherSnapshot } from '@shared/ipc'
import {
  buildDefaultTree,
  insertPanelBalanced,
  insertVideoLeafBottom,
  movePanel as movePanelOp,
  normalizeTree,
  removePanel,
  updateSplitSizes as updateSplitSizesOp,
  type DropTarget,
  type LayoutLeaf,
  type LayoutNode,
  type LayoutProfile,
  type PanelId,
  type VideoFitMode
} from '@shared/panelLayout'
import {
  applyProfileByIndex,
  deleteProfile as deleteProfileOp,
  renameProfile as renameProfileOp,
  saveProfile as saveProfileOp
} from '@shared/layoutProfiles'
import { defaultFeeds } from '../youtube/defaultFeeds'
import type { AudioOutputDevice } from '../audio/devices'
import { panelKind } from '../layout/panelMeta'

// The per-window live UI store (zustand). Phase 1 holds just the FR24 nav state
// (pushed from main) and the overlay flag that drives the z-order rule. It works
// outside React, which is why later phases can let the audio-engine singleton
// write into a store like this directly; here the "writer" is the IPC glue that
// forwards fr24:navState pushes.

const INITIAL_NAV_STATE: Fr24NavState = {
  canGoBack: false,
  canGoForward: false,
  url: '',
  isLoading: false
}

/**
 * The overlays that can cover the FR24 region (each hides the native view).
 * `'move-panel'` (PR4 of the panel-system effort) is the accessible,
 * e2e-deterministic move path — see layout/MovePanelModal.tsx — landed BEFORE
 * pointer-driven drag-to-dock (`feature/panel-drag-dock`); see
 * docs/decisions/README.md (decision 2026-07-20). `'layout-manager'` (PR5) is
 * the snap template gallery + named-profile CRUD dialog — see
 * layout/LayoutManagerModal.tsx — opened from the native Layout menu's
 * "Layout Manager…" item (src/main/menu.ts).
 */
export type OverlayKind = 'about' | 'add-channel' | 'move-panel' | 'layout-manager'

export interface AppState {
  /** Latest FR24 navigation state, mirrored from the main process. */
  navState: Fr24NavState
  /**
   * Which DOM overlay/modal is open over the FR24 region, or null. Because the
   * WebContentsView paints ABOVE all DOM, a non-null value drives
   * fr24:setVisible(false) so the overlay is actually visible — the standing
   * z-order pattern (see CLAUDE.md gotchas). Every future overlay that can cover
   * the FR24 region must register itself the same way.
   */
  overlay: OverlayKind | null
  setNavState: (navState: Fr24NavState) => void
  setOverlay: (overlay: OverlayKind | null) => void

  // --- Audio slice (Phase 2a) ---------------------------------------------
  /** Per-stream UI state, keyed by stream id (see AudioStreamUi). */
  audioStreams: Record<string, AudioStreamUi>
  /** Stream ids in display order (config order). */
  audioOrder: string[]
  /**
   * Config fallback banner: set when config.json was invalid and the app fell
   * back to compiled defaults. Names the file and the validation error.
   */
  audioBanner: AudioBanner | null
  /**
   * True while any stream's AudioContext is autoplay-suspended — the panel shows
   * a "click to enable audio" hint until the first user gesture unlocks it.
   */
  audioNeedsGesture: boolean
  /**
   * The soloed stream id, or null. Momentary UI state (Phase 2b) — never
   * persisted: a solo is a live override the operator holds, not a saved setting.
   * The engine is the authority; it mirrors the value here for the button state.
   */
  audioSolo: string | null
  /**
   * The concrete output devices available for per-stream routing, refreshed on
   * mount and on every `devicechange`. The "System default" option is synthetic
   * (see audio/devices.ts) and prepended by the picker, so it is NOT in this list.
   */
  audioOutputs: AudioOutputDevice[]
  /**
   * The strip currently being drag-reordered, or null. Live UI state for the
   * channel manager's drag: the dragged strip styles itself and the list
   * previews the new order (audioOrder is rewritten during the drag, then
   * committed — or reverted — on release; see audio/reorder.ts).
   */
  audioDragId: string | null
  /** Replace the whole stream set (engine build / rebuild). */
  initAudioStreams: (streams: AudioStreamUi[]) => void
  /** Rewrite the display order only (drag preview; ids must match the set). */
  setAudioOrder: (order: string[]) => void
  /** Mark/unmark the strip being drag-reordered. */
  setAudioDragId: (id: string | null) => void
  /** Shallow-merge a patch into one stream's UI state. */
  patchAudioStream: (id: string, patch: Partial<AudioStreamUi>) => void
  /** Set or clear the config fallback banner. */
  setAudioBanner: (banner: AudioBanner | null) => void
  /** Set the autoplay-gesture hint flag. */
  setAudioNeedsGesture: (needsGesture: boolean) => void
  /** Mirror the engine's current solo selection (null = none). */
  setAudioSolo: (id: string | null) => void
  /** Replace the enumerated output-device list. */
  setAudioOutputs: (outputs: AudioOutputDevice[]) => void
  // --- Panel-layout canvas slice (PR2 of the panel-system effort) ---------
  // (decision 2026-07-19) The main window's video grid modes (uniform /
  // emphasized / fill-panel) are retired in favor of the panel canvas's
  // maximize (any panel, not just video) plus a per-feed fit/fill toggle;
  // pop-outs keep their own uniform/emphasized/fill grid (see
  // VideoLayoutState/PopoutState in @shared/ipc, untouched). See
  // docs/Panel-System-Plan.md and docs/decisions/README.md.
  /**
   * The serializable split tree PanelCanvas renders (see @shared/panelLayout).
   * Never null after hydration — sessionBootstrap falls back to
   * buildDefaultTree for an absent/corrupt session, so this starting value
   * (also buildDefaultTree) is only ever visible for the instant before
   * hydratePanelLayout's synchronous pre-mount setState runs.
   */
  panelTree: LayoutNode
  /**
   * Bumped on every STRUCTURAL tree commit (open/close/apply-tree, a settled
   * splitter drag) — LayoutShell's FR24-relayout effect keys off this instead
   * of deep-comparing the tree on every render.
   */
  layoutRevision: number
  /** The one leaf occupying the full canvas, or null. Every other leaf gets `visibility: hidden` (LeafFrame) — never unmounted, so a video keeps playing while maximized elsewhere. */
  maximizedPanelId: PanelId | null
  /** Non-null only for the duration of a header-drag-to-dock gesture (wired for `feature/panel-drag-dock`); included in the FR24 visibility rule now so that rule needs no change when drag lands. */
  dragPanelId: PanelId | null
  /** Per-feed video fit/fill mode, keyed by the bare feed id (not the `video:` panel id). Absent = 'fit' (the default). */
  videoFit: Record<string, VideoFitMode>
  /** Named, saved tree snapshots (the `feature/layout-snaps` gallery + profile CRUD land later; the field exists now so session round-trips never drop a restored profile). */
  layoutProfiles: LayoutProfile[]
  /** Which saved profile currently matches the canvas, for UI highlighting only — store-only (never persisted) and cleared by any structural edit, since an edit means the canvas no longer matches that profile exactly. */
  activeProfileName: string | null
  /**
   * The panel MovePanelModal is currently open for, or null. Momentary UI
   * state (never persisted) — mirrors the `dragPanelId`/`audioDragId`
   * pattern. Non-null exactly while `overlay === 'move-panel'`; see
   * `openMovePanel`.
   */
  movePanelId: PanelId | null

  /** Replace the whole tree (hydrate, a sanitizer fallback, a future template/profile apply). Normalizes on the way in. */
  applyTree: (tree: LayoutNode) => void
  /** Remove a leaf (a LeafFrame close button, or a feed handed off to a new pop-out). A no-op if `id` would empty the whole tree. */
  closePanel: (id: PanelId) => void
  /** Reopen/insert a leaf — joins the largest all-leaf group (rebalanced) or splits 50/50 (a pop-out's feed returning, or a future reopen menu). A no-op if `id` is already present. */
  openPanel: (leaf: LayoutLeaf) => void
  /** Commit a settled splitter drag's sizes for one split id (the ephemeral, in-progress sizes live in PanelCanvas's own local state — this is the release-time store write). */
  updateSplitSizes: (splitId: string, sizes: readonly number[]) => void
  /** Toggle maximize for `id` — maximizing an already-maximized id restores (also triggered by Escape, wired in LayoutShell). */
  toggleMaximize: (id: PanelId) => void
  /** Set one feed's fit/fill mode. */
  setVideoFit: (feedId: string, mode: VideoFitMode) => void
  /** Mark/unmark the panel being header-drag-dragged. */
  setDragPanelId: (id: PanelId | null) => void
  /** Move `id` to `target` (MovePanelModal's commit, and the future header-drag-to-dock landing). A no-op per the pure op's own rules (self-drop, stale ids, only-leaf). */
  movePanel: (id: PanelId, target: DropTarget) => void
  /** Open MovePanelModal for `id` (sets `overlay: 'move-panel'` + `movePanelId`). */
  openMovePanel: (id: PanelId) => void
  /** Set/clear which panel MovePanelModal targets — used by the modal's own close handler alongside `setOverlay(null)`. */
  setMovePanelId: (id: PanelId | null) => void
  /**
   * Save the CURRENT canvas tree as a named profile (LayoutManagerModal's
   * "Save current layout as…" form) — delegates to `@shared/layoutProfiles`'
   * `saveProfile` (upserts by exact name match; a blank/whitespace name is a
   * no-op). Marks the new/updated profile as the active one, since the
   * canvas now matches it exactly.
   */
  saveProfile: (name: string) => void
  /** Rename the profile at `index` (a no-op per the pure op's rules: blank name, unchanged name, or a collision with another profile's name). Keeps `activeProfileName` in step when the renamed profile was the active one. */
  renameProfile: (index: number, name: string) => void
  /** Delete the profile at `index`. Clears `activeProfileName` if that was the deleted profile — the canvas itself is untouched. */
  deleteProfile: (index: number) => void
  /**
   * Apply the profile at `index` to the canvas. Unlike `applyTree` (used for
   * a template instantiation, which always CLEARS `activeProfileName` — a
   * template isn't a saved profile), this SETS `activeProfileName` to the
   * applied profile's name, so the modal/menu can highlight which saved
   * profile currently matches the canvas.
   */
  applyProfile: (index: number) => void

  // --- Weather slice (field METAR/TAF) ------------------------------------
  /** Latest weather snapshot (from a get/refresh call or a poll push), or null before the first successful fetch. */
  weatherSnapshot: WeatherSnapshot | null
  /** The most recent fetch failure's message, or null. Cleared by the next successful fetch. */
  weatherError: string | null
  /** True while a get/refresh call is in flight — drives the refresh button's disabled state. */
  weatherLoading: boolean
  /**
   * Feed a `weather:get` / `weather:refresh` / `onUpdate` result into the
   * slice. Success replaces the snapshot and clears any error. Failure keeps
   * showing the last-known snapshot (preferring the result's own `stale`
   * payload, falling back to whatever is already in the store) while
   * surfacing the error — graceful degradation, never a blank panel.
   */
  setWeatherResult: (result: WeatherResult) => void
  /** Toggle the in-flight flag around a get/refresh call. */
  setWeatherLoading: (loading: boolean) => void

  // --- Pop-out feed hand-off (Phase 4) ------------------------------------
  /**
   * Feed ids currently managed by an open pop-out window. The main grid hides
   * these tiles (their management moved to the pop-out) and shows them again when
   * the pop-out closes. Mirrored from the main-process windows:popoutsChanged push.
   */
  poppedOutFeedIds: string[]
  /** Replace the popped-out feed set (from the popouts-changed broadcast). */
  setPoppedOutFeedIds: (feedIds: string[]) => void
}

export const useAppStore = create<AppState>((set) => ({
  navState: INITIAL_NAV_STATE,
  overlay: null,
  setNavState: (navState) => set({ navState }),
  setOverlay: (overlay) => set({ overlay }),

  audioStreams: {},
  audioOrder: [],
  audioBanner: null,
  audioNeedsGesture: false,
  audioSolo: null,
  audioOutputs: [],
  audioDragId: null,
  initAudioStreams: (streams) =>
    set({
      audioStreams: Object.fromEntries(streams.map((s) => [s.id, s])),
      audioOrder: streams.map((s) => s.id)
    }),
  setAudioOrder: (audioOrder) => set({ audioOrder }),
  setAudioDragId: (audioDragId) => set({ audioDragId }),
  patchAudioStream: (id, patch) =>
    set((state) => {
      const current = state.audioStreams[id]
      if (!current) return state
      return { audioStreams: { ...state.audioStreams, [id]: { ...current, ...patch } } }
    }),
  setAudioBanner: (audioBanner) => set({ audioBanner }),
  setAudioNeedsGesture: (audioNeedsGesture) => set({ audioNeedsGesture }),
  setAudioSolo: (audioSolo) => set({ audioSolo }),
  setAudioOutputs: (audioOutputs) => set({ audioOutputs }),
  // Placeholder until hydratePanelLayout's synchronous pre-mount setState
  // (see state/sessionBootstrap.ts) replaces it with the restored/pruned tree
  // — mirrors the same shape so a render that somehow raced the hydrate would
  // still show something sane rather than an empty canvas.
  panelTree: buildDefaultTree(defaultFeeds.map((f) => f.id)),
  layoutRevision: 0,
  maximizedPanelId: null,
  dragPanelId: null,
  videoFit: {},
  layoutProfiles: [],
  activeProfileName: null,
  movePanelId: null,

  applyTree: (tree) =>
    set((state) => {
      const normalized = normalizeTree(tree)
      if (normalized === state.panelTree) return state
      return {
        panelTree: normalized,
        layoutRevision: state.layoutRevision + 1,
        activeProfileName: null
      }
    }),

  closePanel: (id) =>
    set((state) => {
      const next = removePanel(state.panelTree, id)
      // `next === null` would mean id was the tree's only leaf — refuse rather
      // than leave the canvas with nothing to render.
      if (next === null || next === state.panelTree) return state
      return {
        panelTree: next,
        layoutRevision: state.layoutRevision + 1,
        maximizedPanelId: state.maximizedPanelId === id ? null : state.maximizedPanelId,
        activeProfileName: null
      }
    }),

  openPanel: (leaf) =>
    set((state) => {
      // Fix C (docs/Panel-System-Plan.md, decision 2026-07-20): a returning
      // video leaf (pop-out close, the only reopen path today) always joins
      // the BOTTOM ROW of the video region — insertPanelBalanced's largest-
      // all-leaf-group heuristic can otherwise pick the audio/weather pair
      // (e.g. when exactly one video feed remains, buildBalancedGrid
      // represents it as a bare leaf, not a joinable split) and land the
      // panel in the left column. Non-video reopens keep insertPanelBalanced.
      const next =
        panelKind(leaf.id) === 'video'
          ? insertVideoLeafBottom(state.panelTree, leaf)
          : insertPanelBalanced(state.panelTree, leaf)
      if (next === state.panelTree) return state
      return { panelTree: next, layoutRevision: state.layoutRevision + 1, activeProfileName: null }
    }),

  updateSplitSizes: (splitId, sizes) =>
    set((state) => {
      const next = updateSplitSizesOp(state.panelTree, splitId, sizes)
      if (next === state.panelTree) return state
      return { panelTree: next, layoutRevision: state.layoutRevision + 1, activeProfileName: null }
    }),

  toggleMaximize: (id) =>
    set((state) => ({ maximizedPanelId: state.maximizedPanelId === id ? null : id })),

  setVideoFit: (feedId, mode) =>
    set((state) => ({ videoFit: { ...state.videoFit, [feedId]: mode } })),

  setDragPanelId: (dragPanelId) => set({ dragPanelId }),

  movePanel: (id, target) =>
    set((state) => {
      const next = movePanelOp(state.panelTree, id, target)
      if (next === state.panelTree) return state
      return { panelTree: next, layoutRevision: state.layoutRevision + 1, activeProfileName: null }
    }),

  openMovePanel: (id) => set({ overlay: 'move-panel', movePanelId: id }),
  setMovePanelId: (movePanelId) => set({ movePanelId }),

  saveProfile: (name) =>
    set((state) => {
      const nextProfiles = saveProfileOp(state.layoutProfiles, name, state.panelTree)
      if (nextProfiles === state.layoutProfiles) return state // blank/whitespace name — rejected
      // saveProfileOp already validated `name` is non-blank (else it would
      // have returned the same reference above), so trimming again here is
      // exactly the name it saved under.
      return { layoutProfiles: nextProfiles, activeProfileName: name.trim() }
    }),

  renameProfile: (index, name) =>
    set((state) => {
      const oldName = state.layoutProfiles[index]?.name
      const nextProfiles = renameProfileOp(state.layoutProfiles, index, name)
      if (nextProfiles === state.layoutProfiles) return state
      const renamedTo = nextProfiles[index].name
      return {
        layoutProfiles: nextProfiles,
        activeProfileName: state.activeProfileName === oldName ? renamedTo : state.activeProfileName
      }
    }),

  deleteProfile: (index) =>
    set((state) => {
      const deletedName = state.layoutProfiles[index]?.name
      const nextProfiles = deleteProfileOp(state.layoutProfiles, index)
      if (nextProfiles === state.layoutProfiles) return state
      return {
        layoutProfiles: nextProfiles,
        activeProfileName: state.activeProfileName === deletedName ? null : state.activeProfileName
      }
    }),

  applyProfile: (index) =>
    set((state) => {
      const tree = applyProfileByIndex(state.layoutProfiles, index)
      if (tree === null) return state
      const normalized = normalizeTree(tree)
      const targetName = state.layoutProfiles[index].name
      if (normalized === state.panelTree && state.activeProfileName === targetName) return state
      return {
        panelTree: normalized,
        layoutRevision: state.layoutRevision + 1,
        activeProfileName: targetName
      }
    }),

  weatherSnapshot: null,
  weatherError: null,
  weatherLoading: false,
  setWeatherResult: (result) =>
    set((state) =>
      result.ok
        ? { weatherSnapshot: result.snapshot, weatherError: null }
        : { weatherSnapshot: result.stale ?? state.weatherSnapshot, weatherError: result.error }
    ),
  setWeatherLoading: (weatherLoading) => set({ weatherLoading }),

  poppedOutFeedIds: [],
  setPoppedOutFeedIds: (poppedOutFeedIds) => set({ poppedOutFeedIds })
}))

/**
 * Custom DOM event the layout dispatches when a resizable panel divider moves,
 * so the FR24 region can re-measure and re-sync its native view bounds. A plain
 * window event keeps the layout and the FR24 panel decoupled and avoids a store
 * write (and re-render) on every pointer move during a drag.
 */
export const FR24_RELAYOUT_EVENT = 'fr24-relayout'

// ---------------------------------------------------------------------------
// Audio slice types (Phase 2a). The engine (a plain-TS singleton) writes these;
// React subscribes via selectors. Only the post-hysteresis `active` boolean and
// status changes flow through here — the high-frequency dBFS levels stay inside
// the engine, never triggering a store write or re-render.
// ---------------------------------------------------------------------------

/**
 * The status-pill states — distinct from the activity light, and the pill is the
 * connect toggle (on-demand model, decision 2026-07-19):
 *   - `disconnected` — the default; no network activity at all, click to connect,
 *   - `connecting`   — resolving/opening a wanted stream,
 *   - `live`         — streaming and healthy,
 *   - `reconnecting` — a wanted stream is down and retrying on the fast schedule,
 *   - `feed-down`    — a wanted stream has been down long enough to retry calmly
 *                      on the slow cadence (no more climbing counter),
 *   - `error`        — a config/playlist problem (bad mount id, unparsable .pls).
 */
export type AudioStreamStatus =
  'disconnected' | 'connecting' | 'live' | 'reconnecting' | 'feed-down' | 'error'

/** One ATC stream's live UI state. */
export interface AudioStreamUi {
  id: string
  label: string
  /** Connection health (the status chip). NOT the activity light. */
  status: AudioStreamStatus
  /** Reconnect attempt count, shown as reconnecting·n. */
  attempt: number
  /** Post-hysteresis voice activity (the activity light). Works while muted. */
  active: boolean
  /** Slider volume 0..1, remembered across a mute. */
  volume: number
  muted: boolean
  /** Stereo pan -1..1. */
  pan: number
  /** Priority rank (1 = highest); drives Phase 2b ordering/ducking. */
  priority: number
  /** Last failure message, for the chip tooltip. */
  lastError: string | null
  /** Epoch ms of the next reconnect attempt, for the countdown tooltip. */
  nextRetryAt: number | null
  /**
   * Current duck-gain target in [0, 1] (Phase 2b). 1 = full, config.duckLevel =
   * ducked, 0 = silenced by a solo elsewhere. Surfaced per strip as a data
   * attribute always (verification hook) and a numeric readout in dev mode, so
   * ducking can be SEEN without being heard — the night before the show that is
   * the only way to check it.
   */
  duckTarget: number
  /** Routed output device id ('' = system default). */
  deviceId: string
  /** Routed output device label (for the picker's current value + relabel match). */
  deviceLabel: string
  /**
   * A visible per-strip notice, e.g. a routed device was unplugged and the stream
   * fell back to the default output. Null when there is nothing to say. Distinct
   * from lastError (which is stream-health); this is about routing.
   */
  deviceNotice: string | null
}

/** The config fallback banner payload. */
export interface AudioBanner {
  /** The zod validation / parse error text. */
  message: string
  /** Absolute path to config.json, so the operator knows which file to fix. */
  filePath: string
}
