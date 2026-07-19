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
  audioResolveStream: 'audio:resolveStream'
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
// Session payloads. Deliberately minimal for Phase 1 — just the FR24 last URL,
// which restores the map position nearly for free (FR24 encodes the view into
// its own URL). Later phases extend `SessionState` (window bounds, panel layout,
// per-stream audio settings, video layout, popouts); `SessionPatch` grows with
// it. Keep both shapes in lockstep.
// ---------------------------------------------------------------------------
export interface SessionState {
  fr24: {
    /** The last FR24 URL visited, or null before the first visit / on reset. */
    lastUrl: string | null
  }
}

/** A shallow, per-section partial applied by `session:patch`. */
export interface SessionPatch {
  fr24?: Partial<SessionState['fr24']>
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
