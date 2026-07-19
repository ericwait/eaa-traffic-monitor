import ElectronStore from 'electron-store'
import type { SessionState, SessionPatch } from '@shared/ipc'

// Persisted session state (electron-store, atomic writes). Phase 1 persists only
// the FR24 last URL — which restores the map position nearly for free, since FR24
// encodes the view into its own URL. Later phases extend SessionState (window
// bounds, panel layout, per-stream audio, video layout, popouts); this module
// grows the same way.
//
// Reliability mandate (this gets debugged at 6 a.m. mid-airshow): a
// missing/corrupt store must NEVER crash the app. Every path degrades to an
// in-memory default and logs what happened and what it did about it.

const DEFAULTS: SessionState = {
  fr24: { lastUrl: null },
  audio: { devices: {} }
}

/** Deep-ish clone of the small defaults so callers can never mutate the source. */
function freshDefaults(): SessionState {
  return { fr24: { ...DEFAULTS.fr24 }, audio: { devices: {} } }
}

// The store is created lazily on first use (after app `ready`, so userData is
// resolvable) and memoized. On any construction failure we fall back to an
// in-memory object and remember that we did, so we never retry-crash on every
// call.
let store: ElectronStore<SessionState> | null = null
let storeInitFailed = false
let memoryFallback: SessionState | null = null

function getStore(): ElectronStore<SessionState> | null {
  if (store) return store
  if (storeInitFailed) return null
  try {
    store = new ElectronStore<SessionState>({
      name: 'session',
      defaults: freshDefaults(),
      // A corrupt session.json is reset to defaults rather than throwing — a
      // stale login/URL is not worth a failed launch during a show.
      clearInvalidConfig: true
    })
    return store
  } catch (err: unknown) {
    storeInitFailed = true
    memoryFallback = freshDefaults()
    console.warn(
      '[session] could not open session.json; continuing with in-memory defaults ' +
        '(FR24 will start at its home view and settings will not persist this run):',
      err
    )
    return null
  }
}

/**
 * Read the full persisted session state. Falls back to defaults on any read
 * failure so callers always get a well-formed object.
 */
export function getSessionState(): SessionState {
  const s = getStore()
  if (!s) {
    return memoryFallback
      ? {
          fr24: { ...memoryFallback.fr24 },
          audio: { devices: { ...memoryFallback.audio.devices } }
        }
      : freshDefaults()
  }
  try {
    // electron-store returns the stored value merged over defaults; be defensive
    // about the nested shape in case an older/hand-edited file is missing it.
    const fr24 = s.get('fr24')
    const audio = s.get('audio')
    return {
      fr24: { lastUrl: fr24?.lastUrl ?? null },
      audio: { devices: { ...(audio?.devices ?? {}) } }
    }
  } catch (err: unknown) {
    console.warn('[session] failed to read session state; using defaults:', err)
    return freshDefaults()
  }
}

/**
 * Shallow-merge a patch into the persisted session state, per top-level section.
 * Phase 1 only has the `fr24` section; the pattern generalizes as sections are
 * added. Never throws — a failed write is logged, not fatal.
 */
export function patchSessionState(patch: SessionPatch): void {
  const s = getStore()
  try {
    if (patch.fr24) {
      const current = s ? s.get('fr24') : memoryFallback?.fr24
      const merged = { lastUrl: null, ...current, ...patch.fr24 }
      if (s) {
        s.set('fr24', merged)
      } else if (memoryFallback) {
        memoryFallback.fr24 = merged
      }
    }

    if (patch.audio?.devices) {
      // Merge per-stream device selections into the stored map. A null value
      // clears that stream's route (back to the system default) rather than
      // persisting null — resetting a route is a first-class patch.
      const current = (s ? s.get('audio') : memoryFallback?.audio)?.devices ?? {}
      const merged: SessionState['audio']['devices'] = { ...current }
      for (const [id, selection] of Object.entries(patch.audio.devices)) {
        if (selection === null) delete merged[id]
        else merged[id] = selection
      }
      if (s) {
        s.set('audio', { devices: merged })
      } else if (memoryFallback) {
        memoryFallback.audio = { devices: merged }
      }
    }
  } catch (err: unknown) {
    console.warn('[session] failed to persist session patch (continuing):', err, patch)
  }
}

/** Convenience read: the persisted FR24 URL, or null if none/unavailable. */
export function getFr24LastUrl(): string | null {
  return getSessionState().fr24.lastUrl
}

/** Convenience write: persist the FR24 URL. Never throws. */
export function setFr24LastUrl(url: string): void {
  patchSessionState({ fr24: { lastUrl: url } })
}
