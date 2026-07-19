import type { LayoutStorage } from 'react-resizable-panels'
import type { SessionState } from '@shared/ipc'
import { defaultSessionState } from '@shared/session'

// Renderer-side session bootstrap. The persisted session is fetched ONCE before
// the app mounts (see main.tsx) and stashed here as a synchronous snapshot, so
// every restore consumer can hydrate without an async flash:
//   - the react-resizable-panels LayoutStorage adapter below (its getItem is
//     synchronous — it reads this snapshot),
//   - the video-layout store hydration,
//   - the pop-out window reading its own slice by id.
// Writes go straight to the debounced main-process store via window.api.session;
// this snapshot is kept in step so a subsequent read stays consistent.

let snapshot: SessionState = defaultSessionState()

/** Fetch and cache the persisted session. Called once before React mounts. */
export async function loadSessionSnapshot(): Promise<SessionState> {
  try {
    snapshot = await window.api.session.get()
  } catch (err: unknown) {
    console.warn('[session] failed to read session at startup; using defaults:', err)
    snapshot = defaultSessionState()
  }
  return snapshot
}

/** The current in-renderer session snapshot (defaults until loadSessionSnapshot runs). */
export function sessionSnapshot(): SessionState {
  return snapshot
}

/**
 * A react-resizable-panels `LayoutStorage` backed by the persisted session. The
 * library serializes each group's layout to a string under a key it owns
 * (`react-resizable-panels:<groupId>`); this adapter stores those strings in the
 * session `layout` map. getItem is synchronous (reads the preloaded snapshot);
 * setItem writes through to the debounced session store and updates the snapshot
 * so the value stays self-consistent within the session.
 */
export const layoutStorage: LayoutStorage = {
  getItem(key: string): string | null {
    return snapshot.layout[key] ?? null
  },
  setItem(key: string, value: string): void {
    snapshot = { ...snapshot, layout: { ...snapshot.layout, [key]: value } }
    window.api.session.patch({ layout: { [key]: value } })
  }
}
