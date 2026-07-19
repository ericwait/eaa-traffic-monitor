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

import type { AppConfig } from './defaultConfig'
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
  /** renderer -> main (invoke): read + validate config.json (Phase 2a). */
  configGet: 'config:get',
  /** renderer -> main (invoke): re-read config.json from disk (Phase 2a). */
  configReload: 'config:reload',
  /** renderer -> main (invoke): resolve a stream id to a playable URL (Phase 2a). */
  audioResolveStream: 'audio:resolveStream',
  /** renderer -> main (invoke): read the current field-weather snapshot (cached, or a fresh fetch if stale). */
  weatherGet: 'weather:get',
  /** renderer -> main (invoke): force a fresh METAR/TAF fetch, bypassing the cache (the panel's refresh button). */
  weatherRefresh: 'weather:refresh',
  /** main -> renderer: push a background-poll weather result to the panel. */
  weatherUpdate: 'weather:update'
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
// Session payloads. Phase 1 persisted just the FR24 last URL; Phase 2b adds the
// per-stream ATC output-device selection (so "Tower on headphones, the rest on
// speakers" survives a relaunch). Later phases extend `SessionState` further
// (window bounds, panel layout, per-stream volume/mute/pan, video layout,
// popouts); `SessionPatch` grows with it. Keep both shapes in lockstep.
// ---------------------------------------------------------------------------

/**
 * A remembered output-device choice for one ATC stream. Both fields are stored:
 * the `deviceId` is tried first, and the human `deviceLabel` is the match-by-name
 * fallback when a device replug hands the same physical output a fresh id.
 */
export interface AudioDeviceSelection {
  deviceId: string
  deviceLabel: string
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
  }
}

/** A shallow, per-section partial applied by `session:patch`. */
export interface SessionPatch {
  fr24?: Partial<SessionState['fr24']>
  audio?: {
    /**
     * Per-stream device selections to merge into the stored map. A `null` value
     * for a stream id CLEARS its selection (back to the system default) rather
     * than storing null — so resetting a route is a first-class patch.
     */
    devices?: Record<string, AudioDeviceSelection | null>
  }
}

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

/** The complete project-owned bridge surface exposed as `window.api`. */
export interface AppApi {
  fr24: Fr24Api
  session: SessionApi
  config: ConfigApi
  audio: AudioApi
  weather: WeatherApi
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
