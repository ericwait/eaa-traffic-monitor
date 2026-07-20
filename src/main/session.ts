import ElectronStore from 'electron-store'
import type { PopoutState, SessionPatch, SessionState } from '@shared/ipc'
import {
  applySessionPatch,
  defaultSessionState,
  mergePopouts as mergePopoutsState,
  patchPopout as patchPopoutState,
  removePopout as removePopoutState,
  sanitizeSessionState,
  upsertPopout as upsertPopoutState,
  type PopoutSlicePatch
} from '@shared/session'

// Persisted session (electron-store). Phase 4 completes full session restore
// (decision 2026-07-19): window bounds/display, panel layout, per-stream
// volume/mute/pan, the video layout, every pop-out, and the FR24 last URL.
//
// Model: this module holds the AUTHORITATIVE in-memory state, loaded once and
// sanitized. Every patch merges into that live object IMMEDIATELY (so reads are
// consistent the moment after a write — the audio engine reads routes right after
// patching them) and schedules a DEBOUNCED flush to disk. Coalescing a slider
// drag's storm of patches into one atomic write ~500 ms after it settles is the
// whole point; a guaranteed flush on quit means nothing in flight is lost.
//
// Reliability mandate (this gets debugged at 6 a.m. mid-airshow): a
// missing/corrupt store must NEVER crash the app. Construction and every read/
// write degrade to well-formed in-memory defaults and log what happened.

/** Debounce window for coalescing patches into one atomic disk write. */
export const SESSION_FLUSH_DEBOUNCE_MS = 500

// The store is created lazily on first use (after app `ready`, so userData is
// resolvable) and memoized. On any construction failure we run purely in memory
// and remember that, so we never retry-crash on every call.
let store: ElectronStore<SessionState> | null = null
let storeInitFailed = false

// The authoritative live state, loaded once, mutated by every patch, flushed on a
// debounce. Reads clone from here so callers can never mutate the source.
let current: SessionState | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getStore(): ElectronStore<SessionState> | null {
  if (store) return store
  if (storeInitFailed) return null
  try {
    store = new ElectronStore<SessionState>({
      name: 'session',
      defaults: defaultSessionState(),
      // A corrupt session.json is reset to defaults rather than throwing — a
      // stale layout/route is not worth a failed launch during a show.
      clearInvalidConfig: true
    })
    return store
  } catch (err: unknown) {
    storeInitFailed = true
    console.warn(
      '[session] could not open session.json; continuing with in-memory defaults ' +
        '(settings will not persist this run):',
      err
    )
    return null
  }
}

/** Load + sanitize the authoritative state once, then reuse it for the run. */
function load(): SessionState {
  if (current) return current
  const s = getStore()
  if (!s) {
    current = defaultSessionState()
    return current
  }
  try {
    // electron-store returns the stored value merged over defaults; sanitize it
    // so an older/hand-edited file can never feed a malformed shape downstream.
    current = sanitizeSessionState(s.store)
  } catch (err: unknown) {
    console.warn('[session] failed to read session state; using defaults:', err)
    current = defaultSessionState()
  }
  return current
}

/** Schedule a trailing-debounced atomic flush of the live state to disk. */
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushSession()
  }, SESSION_FLUSH_DEBOUNCE_MS)
}

/**
 * Write the authoritative state to disk now, atomically (electron-store replaces
 * the file via a temp-and-rename, so a crash mid-write can't corrupt it). Called
 * on the debounce trailing edge and once on quit. Never throws.
 */
export function flushSession(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const s = getStore()
  if (!s || !current) return
  try {
    s.store = current
  } catch (err: unknown) {
    console.warn('[session] failed to flush session to disk (continuing):', err)
  }
}

/** Read the full persisted session state (a clone — callers cannot mutate it). */
export function getSessionState(): SessionState {
  return structuredClone(load())
}

/**
 * Merge a shallow patch into the live session state and schedule a flush. Never
 * throws — a failed persist is logged, not fatal. The in-memory state is updated
 * synchronously, so a following read reflects the patch immediately.
 */
export function patchSessionState(patch: SessionPatch): void {
  try {
    current = applySessionPatch(load(), patch)
    scheduleFlush()
  } catch (err: unknown) {
    console.warn('[session] failed to apply session patch (continuing):', err, patch)
  }
}

// --- Pop-out slice mutators (main-process owned — the pop-out windows are its) --

/** Insert or replace a pop-out's slice, then schedule a flush. */
export function upsertPopout(popout: PopoutState): void {
  current = upsertPopoutState(load(), popout)
  scheduleFlush()
}

/** Remove a pop-out's slice, then schedule a flush. */
export function removePopout(id: number): void {
  current = removePopoutState(load(), id)
  scheduleFlush()
}

/** Merge a patch (bounds / feeds / video / volumes) into one pop-out's slice, then flush. */
export function patchPopout(id: number, patch: PopoutSlicePatch): void {
  current = patchPopoutState(load(), id, patch)
  scheduleFlush()
}

/**
 * Merge `sourceId`'s pop-out into `targetId`'s (see @shared/session's
 * `mergePopouts` for the math), then flush. Returns `false` — leaving the
 * state untouched — when the ids are equal or either is unknown.
 */
export function mergePopouts(sourceId: number, targetId: number): boolean {
  const merged = mergePopoutsState(load(), sourceId, targetId)
  if (!merged) return false
  current = merged
  scheduleFlush()
  return true
}

/** Convenience read: the persisted FR24 URL, or null if none/unavailable. */
export function getFr24LastUrl(): string | null {
  return load().fr24.lastUrl
}

/** Convenience write: persist the FR24 URL. Never throws. */
export function setFr24LastUrl(url: string): void {
  patchSessionState({ fr24: { lastUrl: url } })
}
