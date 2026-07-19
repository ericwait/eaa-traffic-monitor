import { create } from 'zustand'
import type { Fr24NavState } from '@shared/ipc'
import type { AudioOutputDevice } from '../audio/devices'

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

// ---------------------------------------------------------------------------
// Video slice (Phase 3) — the YouTube grid's layout mode, which feed (if any)
// is emphasized, and which feed (if any) fills the entire video panel. Live
// per-tile state (volume/mute, player status) stays local to each VideoTile —
// only the cross-tile layout decisions belong in shared UI state, same
// "only what other things need to react to" principle as overlayOpen above.
// ---------------------------------------------------------------------------

export type VideoLayoutMode = 'uniform' | 'emphasized'

export interface AppState {
  /** Latest FR24 navigation state, mirrored from the main process. */
  navState: Fr24NavState
  /**
   * True while a DOM overlay/modal is open over the FR24 region. Because the
   * WebContentsView paints ABOVE all DOM, this flag drives fr24:setVisible(false)
   * so the overlay is actually visible — the standing z-order pattern (see
   * CLAUDE.md gotchas). Every future overlay that can cover the FR24 region must
   * set this the same way.
   */
  overlayOpen: boolean
  setNavState: (navState: Fr24NavState) => void
  setOverlayOpen: (overlayOpen: boolean) => void

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
  /** Replace the whole stream set (engine build / rebuild). */
  initAudioStreams: (streams: AudioStreamUi[]) => void
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
  /** 'uniform' (grid, all tiles equal) or 'emphasized' (one big tile + rail). */
  videoLayoutMode: VideoLayoutMode
  /** The feed id occupying the emphasized "big" tile; null in uniform mode. */
  emphasizedFeedId: string | null
  /** The feed id filling the ENTIRE video panel (grid hidden); null otherwise. */
  fillPanelFeedId: string | null
  /**
   * Double-click behavior: emphasizing the same feed again demotes it back to
   * uniform mode; emphasizing a different feed re-targets the big tile.
   */
  toggleEmphasizedFeed: (feedId: string) => void
  /** Fill-panel button (or double-click while already emphasized). */
  setFillPanelFeedId: (feedId: string | null) => void
  /** Escape / close affordance — always returns to the grid. */
  exitFillPanel: () => void

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
  overlayOpen: false,
  setNavState: (navState) => set({ navState }),
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),

  audioStreams: {},
  audioOrder: [],
  audioBanner: null,
  audioNeedsGesture: false,
  audioSolo: null,
  audioOutputs: [],
  initAudioStreams: (streams) =>
    set({
      audioStreams: Object.fromEntries(streams.map((s) => [s.id, s])),
      audioOrder: streams.map((s) => s.id)
    }),
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
  videoLayoutMode: 'uniform',
  emphasizedFeedId: null,
  fillPanelFeedId: null,
  toggleEmphasizedFeed: (feedId) =>
    set((state) => {
      const alreadyEmphasized = state.emphasizedFeedId === feedId
      return alreadyEmphasized
        ? { videoLayoutMode: 'uniform', emphasizedFeedId: null }
        : { videoLayoutMode: 'emphasized', emphasizedFeedId: feedId }
    }),
  setFillPanelFeedId: (feedId) => set({ fillPanelFeedId: feedId }),
  exitFillPanel: () => set({ fillPanelFeedId: null }),
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

/** The connection-health chip states — distinct from the activity light. */
export type AudioStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'error'

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
