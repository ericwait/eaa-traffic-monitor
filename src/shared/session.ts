// Pure session-state logic: the defaults, a defensive sanitizer for whatever the
// store hands back, and the merge that `session:patch` applies — plus the pop-out
// array operations the main process performs. All side-effect-free (no Electron,
// no electron-store, no fs), so the full restore contract is exercised in vitest
// while `src/main/session.ts` is left holding only the persistence plumbing
// (electron-store + the debounced atomic flush).
//
// Reliability mandate (this gets debugged at 6 a.m. mid-airshow): sanitize NEVER
// throws. A missing section, a hand-edited value of the wrong type, or a whole
// non-object degrades that piece to its default — the app relaunches on a clean,
// well-formed state rather than crashing on a bad field.

import type {
  AudioDeviceSelection,
  AudioStreamSettings,
  FeedAudioState,
  PopoutState,
  PopoutSummary,
  SessionPatch,
  SessionState,
  ThemeMode,
  VideoLayoutState,
  WindowBoundsState
} from './ipc'
import { sanitizePanelLayoutSession } from './panelLayout'

/**
 * The main-process pop-out slice patch: the renderer's PopoutPatch fields
 * (video/volumes/feedIds) PLUS `bounds`, which only the main process (which owns
 * the window) sets from its move/resize tracking.
 */
export type PopoutSlicePatch = Partial<Omit<PopoutState, 'id'>>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** A fresh, fully-formed default session — a new object every call (never shared). */
export function defaultSessionState(): SessionState {
  return {
    fr24: { lastUrl: null },
    audio: { devices: {}, streams: {} },
    window: null,
    panelLayout: null,
    popouts: [],
    theme: 'system'
  }
}

/** The video grid's default layout (uniform, nothing emphasized or filled). */
export function defaultVideoLayout(): VideoLayoutState {
  return { mode: 'uniform', emphasizedFeedId: null, fillPanelFeedId: null }
}

// ---------------------------------------------------------------------------
// Small type guards. Local and boring on purpose — the point is that no branch
// can throw on a malformed input.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

// ---------------------------------------------------------------------------
// Sanitizers — each takes `unknown` and returns a well-formed value or a default.
// ---------------------------------------------------------------------------

function sanitizeDeviceSelection(value: unknown): AudioDeviceSelection | undefined {
  if (!isObject(value)) return undefined
  const deviceId = asString(value.deviceId)
  const deviceLabel = asString(value.deviceLabel)
  if (deviceId === undefined || deviceLabel === undefined) return undefined
  return { deviceId, deviceLabel }
}

function sanitizeStreamSettings(value: unknown): AudioStreamSettings | undefined {
  if (!isObject(value)) return undefined
  const out: AudioStreamSettings = {}
  const volume = asFiniteNumber(value.volume)
  if (volume !== undefined) out.volume = Math.min(1, Math.max(0, volume))
  if (typeof value.muted === 'boolean') out.muted = value.muted
  const pan = asFiniteNumber(value.pan)
  if (pan !== undefined) out.pan = Math.min(1, Math.max(-1, pan))
  if (typeof value.connected === 'boolean') out.connected = value.connected
  return out
}

/** Per-entry tolerant record sanitize: a bad entry is dropped, the rest survive. */
function sanitizeRecord<T>(
  value: unknown,
  sanitizeEntry: (entry: unknown) => T | undefined
): Record<string, T> {
  const out: Record<string, T> = {}
  if (!isObject(value)) return out
  for (const [key, raw] of Object.entries(value)) {
    const entry = sanitizeEntry(raw)
    if (entry !== undefined) out[key] = entry
  }
  return out
}

function sanitizeWindowBounds(value: unknown): WindowBoundsState | null {
  if (!isObject(value)) return null
  const x = asFiniteNumber(value.x)
  const y = asFiniteNumber(value.y)
  const width = asFiniteNumber(value.width)
  const height = asFiniteNumber(value.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null
  const displayId = asFiniteNumber(value.displayId)
  return { x, y, width, height, displayId: displayId ?? null }
}

/** A bad/missing theme value degrades to 'system' rather than throwing. */
function sanitizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function sanitizeVideoLayout(value: unknown): VideoLayoutState {
  if (!isObject(value)) return defaultVideoLayout()
  const mode = value.mode === 'emphasized' ? 'emphasized' : 'uniform'
  return {
    mode,
    emphasizedFeedId: asString(value.emphasizedFeedId) ?? null,
    fillPanelFeedId: asString(value.fillPanelFeedId) ?? null
  }
}

function sanitizeFeedAudio(value: unknown): FeedAudioState | undefined {
  if (!isObject(value)) return undefined
  const volume = asFiniteNumber(value.volume)
  return {
    volume: volume === undefined ? 100 : Math.min(100, Math.max(0, volume)),
    muted: value.muted === true
  }
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function sanitizePopout(value: unknown): PopoutState | undefined {
  if (!isObject(value)) return undefined
  const id = asFiniteNumber(value.id)
  const bounds = sanitizeWindowBounds(value.bounds)
  // A pop-out with no id or no bounds cannot be recreated meaningfully — drop it.
  if (id === undefined || bounds === null) return undefined
  return {
    id,
    bounds,
    feedIds: sanitizeStringArray(value.feedIds),
    video: sanitizeVideoLayout(value.video),
    volumes: sanitizeRecord(value.volumes, sanitizeFeedAudio)
  }
}

/**
 * Coerce whatever the store returned (possibly hand-edited, older, or partial)
 * into a fully-formed SessionState. Every field falls back to its default rather
 * than throwing, so a relaunch is never blocked by one bad value.
 */
export function sanitizeSessionState(raw: unknown): SessionState {
  const base = defaultSessionState()
  if (!isObject(raw)) return base

  const fr24 = isObject(raw.fr24) ? raw.fr24 : {}
  base.fr24.lastUrl = asString(fr24.lastUrl) ?? null

  const audio = isObject(raw.audio) ? raw.audio : {}
  base.audio.devices = sanitizeRecord(audio.devices, sanitizeDeviceSelection)
  base.audio.streams = sanitizeRecord(audio.streams, sanitizeStreamSettings)

  base.window = sanitizeWindowBounds(raw.window)
  // Old sessions (and any garbage/corrupt panelLayout) sanitize to null — the
  // caller substitutes buildDefaultTree; see panelLayout.ts's sanitizer doc.
  base.panelLayout = sanitizePanelLayoutSession(raw.panelLayout)

  base.popouts = Array.isArray(raw.popouts)
    ? raw.popouts.map(sanitizePopout).filter((p): p is PopoutState => p !== undefined)
    : []

  base.theme = sanitizeTheme(raw.theme)

  return base
}

// ---------------------------------------------------------------------------
// Patch merge — the `session:patch` semantics, returning a NEW state (the input
// is never mutated, so the store can compare or roll back).
// ---------------------------------------------------------------------------

/**
 * Merge a shallow, per-section patch into `state`, returning a new state.
 *
 * - `audio.devices` / `audio.streams`: per-entry merge, where a `null` value for
 *   a key DELETES that entry (reset to the config/system default).
 * - `window`: replaced wholesale (null clears it).
 * - `fr24`: shallow-merged.
 * - `panelLayout`: replaced wholesale, like `window` (undefined leaves it untouched, null clears it).
 */
export function applySessionPatch(state: SessionState, patch: SessionPatch): SessionState {
  const next: SessionState = {
    fr24: { ...state.fr24 },
    audio: {
      devices: { ...state.audio.devices },
      streams: { ...state.audio.streams }
    },
    window: state.window ? { ...state.window } : null,
    panelLayout: state.panelLayout,
    popouts: state.popouts,
    theme: state.theme
  }

  if (patch.fr24) next.fr24 = { ...next.fr24, ...patch.fr24 }

  if (patch.audio?.devices) {
    for (const [id, selection] of Object.entries(patch.audio.devices)) {
      if (selection === null) delete next.audio.devices[id]
      else next.audio.devices[id] = selection
    }
  }

  if (patch.audio?.streams) {
    for (const [id, settings] of Object.entries(patch.audio.streams)) {
      if (settings === null) delete next.audio.streams[id]
      else next.audio.streams[id] = { ...next.audio.streams[id], ...settings }
    }
  }

  if (patch.window !== undefined) next.window = patch.window ? { ...patch.window } : null
  if (patch.panelLayout !== undefined) next.panelLayout = patch.panelLayout
  if (patch.theme) next.theme = patch.theme

  return next
}

// ---------------------------------------------------------------------------
// Pop-out array operations (main-process owned). Pure so the hand-off bookkeeping
// is vitest-covered independently of BrowserWindow lifecycle.
// ---------------------------------------------------------------------------

/** Insert `popout`, replacing any existing entry with the same id. */
export function upsertPopout(state: SessionState, popout: PopoutState): SessionState {
  const popouts = state.popouts.filter((p) => p.id !== popout.id)
  popouts.push(popout)
  return { ...state, popouts }
}

/** Remove the pop-out with `id` (no-op when absent). */
export function removePopout(state: SessionState, id: number): SessionState {
  return { ...state, popouts: state.popouts.filter((p) => p.id !== id) }
}

/** Merge `patch` (bounds / feeds / video / volumes) into the pop-out with `id` (no-op when absent). */
export function patchPopout(
  state: SessionState,
  id: number,
  patch: PopoutSlicePatch
): SessionState {
  return {
    ...state,
    popouts: state.popouts.map((p) => {
      if (p.id !== id) return p
      return {
        ...p,
        bounds: patch.bounds ?? p.bounds,
        feedIds: patch.feedIds ?? p.feedIds,
        video: patch.video ?? p.video,
        volumes: patch.volumes ? { ...p.volumes, ...patch.volumes } : p.volumes
      }
    })
  }
}

/** The next pop-out id: one past the current maximum (ids never reused within a run). */
export function nextPopoutId(state: SessionState): number {
  return state.popouts.reduce((max, p) => Math.max(max, p.id), 0) + 1
}

/** Every feed id currently claimed by an open pop-out (the set the main grid hides). */
export function poppedOutFeedIds(state: SessionState): Set<string> {
  const ids = new Set<string>()
  for (const popout of state.popouts) for (const feedId of popout.feedIds) ids.add(feedId)
  return ids
}

/** The lightweight per-window broadcast summary (id + feeds only). */
export function popoutSummaries(state: SessionState): PopoutSummary[] {
  return state.popouts.map((p) => ({ id: p.id, feedIds: [...p.feedIds] }))
}
