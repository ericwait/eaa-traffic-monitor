// The typed IPC contract — the single source of truth every process compiles
// against. Main registers handlers keyed on these channel names; the preload
// wraps ipcRenderer into the `window.api` surface below; the renderer calls
// that surface. A payload-shape change here is a compile error in every process
// that touches it, not a runtime surprise in one of them.
//
// This module MUST stay free of Electron and DOM APIs (see src/shared/README.md)
// so it can be imported by the main process, the preload, the renderer, and
// vitest alike. It is plain string constants plus types — nothing more.
//
// The one import is a TYPE-only pull of AppConfig from the (pure, zod-only)
// config module, so the IPC payloads speak in the same validated shape.

import type { AppConfig, StreamConfig } from './defaultConfig'
import type { LiveAtcFeed } from './liveatcDirectory'
import type { PanelLayoutSession } from './panelLayout'
import type { WeatherMetar, WeatherTaf } from './weather'

// ---------------------------------------------------------------------------
// Channel names. Referenced by constant everywhere so a rename is a single edit
// and a typo is a compile error rather than a silently-dead listener.
// ---------------------------------------------------------------------------
export const IpcChannels = {
  /** renderer -> main: reposition/resize the FR24 view to match its DOM region. */
  fr24SetBounds: 'fr24:setBounds',
  /** renderer -> main: back / forward / reload / home. */
  fr24Nav: 'fr24:nav',
  /** renderer -> main: show/hide the FR24 view (the overlay/z-order rule). */
  fr24SetVisible: 'fr24:setVisible',
  /** main -> renderer: push the current navigation state to the toolbar. */
  fr24NavState: 'fr24:navState',
  /** renderer -> main (invoke): read the persisted session state. */
  sessionGet: 'session:get',
  /** renderer -> main: shallow-merge a patch into the persisted session state. */
  sessionPatch: 'session:patch',
  /** renderer -> main (invoke): set the app theme (System/Cream/Ember); drives nativeTheme.themeSource. */
  themeSet: 'theme:set',
  /** renderer -> main (invoke): read + validate config.json (Phase 2a). */
  configGet: 'config:get',
  /** renderer -> main (invoke): re-read config.json from disk (Phase 2a). */
  configReload: 'config:reload',
  /** renderer -> main (invoke): replace the streams block of config.json (channel manager). */
  configUpdateStreams: 'config:updateStreams',
  /** renderer -> main (invoke): fetch + parse the LiveATC feed directory for one airport. */
  liveatcSearch: 'liveatc:search',
  /** renderer -> main (invoke): resolve a stream id to a playable URL (Phase 2a). */
  audioResolveStream: 'audio:resolveStream',
  /** renderer -> main (invoke): read the current field-weather snapshot (cached, or a fresh fetch if stale). */
  weatherGet: 'weather:get',
  /** renderer -> main (invoke): force a fresh METAR/TAF fetch, bypassing the cache (the panel's refresh button). */
  weatherRefresh: 'weather:refresh',
  /** main -> renderer: push a background-poll weather result to the panel. */
  weatherUpdate: 'weather:update',
  /** renderer(main) -> main (invoke): open a grid-only pop-out; resolves its id (Phase 4). */
  windowsOpenPopout: 'windows:openPopout',
  /** renderer(popout) -> main: request this pop-out be closed (Phase 4). */
  windowsClosePopout: 'windows:closePopout',
  /** renderer(popout) -> main: persist this pop-out's layout / per-feed volumes (Phase 4). */
  windowsPatchPopout: 'windows:patchPopout',
  /** main -> renderer: the set of currently open pop-outs, for feed hand-off (Phase 4). */
  windowsPopoutsChanged: 'windows:popoutsChanged'
} as const

// ---------------------------------------------------------------------------
// FR24 payloads.
// ---------------------------------------------------------------------------

/**
 * View bounds in device-independent pixels (DIP), relative to the main window's
 * content view — the same coordinate space `WebContentsView.setBounds` expects
 * and the same space `getBoundingClientRect()` reports in the renderer. All four
 * fields are integers; see `rectToBounds` in `fr24Bounds.ts` for the conversion.
 */
export interface Fr24Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** The four navigation actions the toolbar can request. */
export type Fr24NavAction = 'back' | 'forward' | 'reload' | 'home'

/**
 * Navigation state pushed from main to the renderer so the toolbar can enable/
 * disable buttons, show the read-only URL, and reflect loading.
 */
export interface Fr24NavState {
  canGoBack: boolean
  canGoForward: boolean
  url: string
  isLoading: boolean
}

// ---------------------------------------------------------------------------
// Session payloads. Phase 1 persisted just the FR24 last URL; Phase 2b added the
// per-stream ATC output-device selection; Phase 4 completes full session restore
// (decision 2026-07-19): main-window bounds + its display, the resizable panel
// layout, per-stream volume/mute/pan, the video layout, and every pop-out window.
// `SessionPatch` is the shallow, per-section partial the renderer sends over
// `session:patch`; pop-out slices are mutated main-side (they own the windows)
// via the `windows:*` channels, so they are deliberately absent from the patch
// surface. Keep both shapes in lockstep with the pure merge in `shared/session`.
// ---------------------------------------------------------------------------

/**
 * The app's theme selection (Wyvern Watch reskin, decision 2026-07-19):
 * 'system' follows the OS via `nativeTheme.themeSource`; 'light'/'dark' force
 * Cream Classic / Ember regardless of the OS setting. Set through `theme:set`
 * in the main process (never per-renderer CSS), so every window — including
 * pop-outs — and the OS chrome follow a single change instantly. Persisted in
 * `SessionState.theme`; default 'system'.
 */
export type ThemeMode = 'system' | 'light' | 'dark'

/**
 * A remembered output-device choice for one ATC stream. Both fields are stored:
 * the `deviceId` is tried first, and the human `deviceLabel` is the match-by-name
 * fallback when a device replug hands the same physical output a fresh id.
 */
export interface AudioDeviceSelection {
  deviceId: string
  deviceLabel: string
}

/**
 * Runtime-mutable per-stream ATC settings. Priority is intentionally NOT here:
 * config.json is priority's live tuning surface (see defaultConfig.ts), so it
 * stays config-owned and is re-derived from config on every launch rather than
 * pinned in the session (decision 2026-07-19).
 */
export interface AudioStreamSettings {
  /** Slider volume 0..1. */
  volume?: number
  muted?: boolean
  /** Stereo pan -1..1. */
  pan?: number
  /**
   * Whether the operator had this stream CONNECTED. Streams are on-demand
   * (decision 2026-07-19): they start disconnected and connect only when clicked,
   * so this restores the "arranged once" connected set on the next launch (absent
   * or false = disconnected). The engine staggers the restored connects.
   */
  connected?: boolean
}

/** Window bounds in global (multi-display) DIP plus the display last occupied. */
export interface WindowBoundsState {
  x: number
  y: number
  width: number
  height: number
  /** Electron display id the window was last on; validated against live displays on restore. */
  displayId: number | null
}

/** The video grid's cross-tile layout — the shared decisions VideoGrid reacts to. */
export interface VideoLayoutState {
  mode: 'uniform' | 'emphasized'
  /** Feed id in the emphasized "big" tile; null in uniform mode. */
  emphasizedFeedId: string | null
  /** Feed id filling the whole panel (grid hidden); null otherwise. */
  fillPanelFeedId: string | null
}

/** One YouTube tile's audio state (volume on YouTube's 0..100 scale). */
export interface FeedAudioState {
  volume: number
  muted: boolean
}

/** One pop-out window's persisted slice — its own bounds/display, feeds, layout, volumes. */
export interface PopoutState {
  /** Stable per-session id; also the `?id=` the pop-out renderer loads under. */
  id: number
  bounds: WindowBoundsState
  /** The feeds this pop-out manages (handed off from the main grid while open). */
  feedIds: string[]
  video: VideoLayoutState
  /** Per-feed audio for this pop-out's tiles, keyed by feed id. */
  volumes: Record<string, FeedAudioState>
}

export interface SessionState {
  fr24: {
    /** The last FR24 URL visited, or null before the first visit / on reset. */
    lastUrl: string | null
  }
  audio: {
    /**
     * Per-stream output device, keyed by stream id. A stream absent from this
     * map plays on the system default output (the common case).
     */
    devices: Record<string, AudioDeviceSelection>
    /** Per-stream volume/mute/pan overrides, keyed by stream id (absent = config default). */
    streams: Record<string, AudioStreamSettings>
  }
  /** Main-window bounds + display, or null before the first save. */
  window: WindowBoundsState | null
  /**
   * The panel-system split tree, maximize/fit state, and named profiles (see
   * src/shared/panelLayout.ts), rendered by the single-container canvas
   * (decision 2026-07-19; see docs/decisions/README.md). `null` before the
   * first commit, and for every pre-existing session — an old build wrote the
   * now-removed `layout` (react-resizable-panels' own `LayoutStorage` strings)
   * and top-level `video` (VideoLayoutState) fields instead; migration is
   * drop-and-default, so those keys simply stop being read/written and an old
   * session.json loads with `panelLayout: null` (the caller substitutes
   * `buildDefaultTree`). Downgrading to a pre-panel-canvas build is safe but
   * loses this section.
   */
  panelLayout: PanelLayoutSession | null
  /** Every open pop-out window (empty when none). */
  popouts: PopoutState[]
  /** The app theme selection (System/Cream/Ember); default 'system'. */
  theme: ThemeMode
}

/**
 * A shallow, per-section partial applied by `session:patch`. Pop-outs are absent
 * on purpose — they are mutated main-side through the `windows:*` channels.
 */
export interface SessionPatch {
  fr24?: Partial<SessionState['fr24']>
  audio?: {
    /**
     * Per-stream device selections to merge into the stored map. A `null` value
     * for a stream id CLEARS its selection (back to the system default) rather
     * than storing null — so resetting a route is a first-class patch.
     */
    devices?: Record<string, AudioDeviceSelection | null>
    /**
     * Per-stream volume/mute/pan to merge. A `null` value for a stream id CLEARS
     * its overrides (back to the config defaults).
     */
    streams?: Record<string, AudioStreamSettings | null>
  }
  /** Replace the whole main-window bounds record (or clear it with null). */
  window?: WindowBoundsState | null
  /** Replace the whole panel-layout section (whole-section replace, like `window`); `null` clears it. */
  panelLayout?: PanelLayoutSession | null
  /** Replace the app theme selection. Applied main-side via `theme:set`, not sent by the renderer through `session:patch` directly, but kept in the patch shape so the pure merge handles it uniformly. */
  theme?: ThemeMode
}

// ---------------------------------------------------------------------------
// Pop-out window payloads (Phase 4). The main window asks the main process to
// open a pop-out; the main process owns the BrowserWindow and its session slice;
// pop-out renderers persist their own layout / volumes back through `windows:*`.
// ---------------------------------------------------------------------------

/** The request that opens a pop-out: which feeds, in what layout, optionally where. */
export interface OpenPopoutRequest {
  feedIds: string[]
  layout: VideoLayoutState
  /** Optional starting bounds (else the main process offsets a default). */
  bounds?: WindowBoundsState
}

/** A pop-out renderer's persist patch for its own slice. */
export interface PopoutPatch {
  video?: VideoLayoutState
  volumes?: Record<string, FeedAudioState>
  feedIds?: string[]
}

/** The lightweight per-window broadcast so the main grid knows what is handed off. */
export interface PopoutSummary {
  id: number
  feedIds: string[]
}

/** Which renderer role a window is running as, derived from its launch URL query. */
export type WindowRole = 'main' | 'popout'

// ---------------------------------------------------------------------------
// The `window.api` surface the preload exposes via contextBridge. The renderer
// sees exactly this; the preload implements exactly this against ipcRenderer.
// ---------------------------------------------------------------------------

export interface Fr24Api {
  /** Fire-and-forget: move/resize the FR24 view to the given content-space rect. */
  setBounds(bounds: Fr24Bounds): void
  /** Fire-and-forget: request a navigation action. */
  nav(action: Fr24NavAction): void
  /** Fire-and-forget: show/hide the FR24 view (false while an overlay covers it). */
  setVisible(visible: boolean): void
  /**
   * Subscribe to navigation-state pushes. Returns an unsubscribe function; call
   * it on teardown so a re-mount (React StrictMode, HMR) never stacks listeners.
   */
  onNavState(listener: (state: Fr24NavState) => void): () => void
}

export interface SessionApi {
  /** Read the full persisted session state. */
  get(): Promise<SessionState>
  /** Merge a shallow patch into the persisted session state. */
  patch(patch: SessionPatch): void
}

export interface ThemeApi {
  /**
   * Set the app theme (System/Cream/Ember). Drives `nativeTheme.themeSource`
   * in the main process — every window (including pop-outs) and the OS chrome
   * follow instantly — and persists the choice for the next launch. The
   * current value is read via `session.get()`; there is no separate getter.
   */
  set(theme: ThemeMode): Promise<void>
}

export interface WindowsApi {
  /** (main window) Pop a subset of feeds into their own grid-only window; resolves the new id. */
  openPopout(request: OpenPopoutRequest): Promise<number>
  /** (pop-out window) Ask the main process to close this pop-out. */
  closePopout(id: number): void
  /** (pop-out window) Persist this pop-out's layout / per-feed volumes. */
  patchPopout(id: number, patch: PopoutPatch): void
  /**
   * Subscribe to the set of currently open pop-outs (feed hand-off). Returns an
   * unsubscribe function; call it on teardown so a re-mount never stacks listeners.
   */
  onPopoutsChanged(listener: (popouts: PopoutSummary[]) => void): () => void
  /** This window's renderer role, derived once from the launch URL query. */
  readonly role: WindowRole
  /** This window's pop-out id when `role === 'popout'`, else null. */
  readonly popoutId: number | null
}

/** The complete project-owned bridge surface exposed as `window.api`. */
export interface AppApi {
  fr24: Fr24Api
  session: SessionApi
  theme: ThemeApi
  config: ConfigApi
  audio: AudioApi
  liveatc: LiveAtcApi
  weather: WeatherApi
  windows: WindowsApi
}

// ---------------------------------------------------------------------------
// Config payloads (Phase 2a). config.json is read + zod-validated in the main
// process; an invalid file falls back to the compiled defaults and the renderer
// shows a dismissible banner naming the file path and the validation error.
// ---------------------------------------------------------------------------

/** Where the active config came from: a valid file, or the compiled fallback. */
export type ConfigSource = 'file' | 'defaults-fallback'

/** The result of reading/validating config.json. Always yields a usable config. */
export interface ConfigResult {
  /** The validated, app-facing configuration (defaults if the file was bad). */
  config: AppConfig
  /** 'file' when the on-disk config was valid; 'defaults-fallback' otherwise. */
  source: ConfigSource
  /** Absolute path to config.json, so the banner can name the file to fix. */
  filePath: string
  /** Present only on 'defaults-fallback': the parse/validation error text. */
  error?: string
}

export interface ConfigApi {
  /** Read + validate config.json (cached after first read). */
  get(): Promise<ConfigResult>
  /** Re-read config.json from disk (the "Reload config" button). */
  reload(): Promise<ConfigResult>
  /**
   * Replace the streams block of config.json (the channel manager's add /
   * remove / reorder). The rest of the file — vad, ducking, weather, notes —
   * is preserved, and the file stays hand-editable (decision 2026-07-19).
   */
  updateStreams(streams: StreamConfig[]): Promise<UpdateStreamsResult>
}

/**
 * The outcome of `config:updateStreams`. On success the returned ConfigResult
 * is the new active config (already cached main-side); on failure nothing was
 * written and the previous config is still in force.
 */
export type UpdateStreamsResult = { ok: true; result: ConfigResult } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// LiveATC directory payloads (channel manager). The search page is fetched in
// the main process (browser UA — see CLAUDE.md) and parsed by the pure shared
// parser; a fetch/parse failure is a typed result, never a throw across IPC.
// ---------------------------------------------------------------------------

/** The outcome of `liveatc:search`. */
export type LiveAtcSearchResult =
  | {
      ok: true
      icao: string
      feeds: LiveAtcFeed[]
      fetchedAt: number
      /**
       * 'live' when the feeds came from LiveATC just now (or its short cache);
       * 'bundled' when the live search failed and these are the compiled-in
       * KOSH snapshot (see shared/koshFallback.ts) — the dialog says so.
       */
      source: 'live' | 'bundled'
    }
  | { ok: false; icao: string; kind: ResolveFailureKind; error: string }

export interface LiveAtcApi {
  /**
   * Fetch + parse the LiveATC feed directory for one airport query (e.g.
   * "osh"). Cached main-side; pass `{ fresh: true }` to force a re-fetch.
   */
  search(icao: string, opts?: { fresh?: boolean }): Promise<LiveAtcSearchResult>
}

// ---------------------------------------------------------------------------
// Audio payloads (Phase 2a). Stream resolution runs in the main process (browser
// UA, redirect-following) and returns a typed result — never a bare throw across
// IPC — so a failure reaches the UI as a status-chip state with a real message.
// ---------------------------------------------------------------------------

/** Category of a resolve failure — drives whether the UI reads it as recoverable. */
export type ResolveFailureKind = 'network' | 'parse' | 'notfound' | 'unknown'

/** The outcome of `audio:resolveStream`. */
export type ResolveStreamResult =
  | { ok: true; streamId: string; finalUrl: string; title: string }
  | { ok: false; streamId: string; kind: ResolveFailureKind; error: string }

export interface AudioApi {
  /**
   * Resolve a stream id to a playable final URL. Pass `{ fresh: true }` on every
   * reconnect so resolution re-lands on a fresh rotating host.
   */
  resolveStream(streamId: string, opts?: { fresh?: boolean }): Promise<ResolveStreamResult>
  /**
   * True when launched under the e2e harness (AUDIO_E2E). The engine uses it to
   * shorten reconnect backoff and skip audible autoplay so the smoke test never
   * waits on a real network or a user gesture. Not for feature logic.
   */
  readonly isE2E: boolean
}

// ---------------------------------------------------------------------------
// Weather payloads. Field-weather (METAR/TAF) is fetched from the NOAA
// aviationweather.gov Data API in the main process (see
// docs/development/TechStack.md and src/main/weather.ts), cached, and polled
// no more often than the configured interval. Like `ResolveStreamResult`, a
// fetch failure is a typed result, never a throw across IPC — the panel shows
// a stale/error state instead of an unhandled rejection.
// ---------------------------------------------------------------------------

/** One fetched-and-derived snapshot: current METAR + TAF for one station. */
export interface WeatherSnapshot {
  /** ICAO station id, e.g. "KOSH". */
  station: string
  /** The poll interval in effect when this snapshot was fetched, in minutes — carried along so the UI can compute "stale" without a second round-trip to read config. */
  pollMinutes: number
  /** When this snapshot was fetched, epoch ms. */
  fetchedAt: number
  /** Null only if the API returned no METAR for the station (rare, but possible). */
  metar: WeatherMetar | null
  /** Null only if the API returned no TAF for the station. */
  taf: WeatherTaf | null
}

/** Category of a weather-fetch failure. */
export type WeatherFailureKind = 'network' | 'parse' | 'unknown'

/**
 * The outcome of `weather:get` / `weather:refresh` (and background pushes on
 * `weather:update`). On failure, `stale` carries the last successfully fetched
 * snapshot (if any) so the panel can keep showing last-known conditions with a
 * visible "stale"/error indicator — graceful degradation, never a blank panel.
 */
export type WeatherResult =
  | { ok: true; snapshot: WeatherSnapshot }
  | { ok: false; kind: WeatherFailureKind; error: string; stale: WeatherSnapshot | null }

export interface WeatherApi {
  /** Read the current snapshot: cached if still fresh, otherwise a fresh fetch. */
  get(): Promise<WeatherResult>
  /** Force a fresh fetch, bypassing the cache-freshness check (the refresh button). */
  refresh(): Promise<WeatherResult>
  /**
   * Subscribe to background-poll pushes. Returns an unsubscribe function; call
   * it on teardown so a re-mount (React StrictMode, HMR) never stacks listeners.
   */
  onUpdate(listener: (result: WeatherResult) => void): () => void
}
