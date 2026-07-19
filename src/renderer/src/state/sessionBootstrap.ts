import type { LayoutStorage } from 'react-resizable-panels'
import type { PopoutState, PopoutSummary, SessionState, VideoLayoutState } from '@shared/ipc'
import { defaultSessionState } from '@shared/session'
import { useAppStore, type AppState } from './store'

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

/** Read the store's three video-layout fields as one VideoLayoutState. */
function readVideoLayout(state: AppState): VideoLayoutState {
  return {
    mode: state.videoLayoutMode,
    emphasizedFeedId: state.emphasizedFeedId,
    fillPanelFeedId: state.fillPanelFeedId
  }
}

/**
 * Apply the saved main-window video layout into the store BEFORE first render, so
 * the grid opens in its restored mode with no uniform-then-restore flash. Called
 * from the bootstrap once the snapshot is loaded.
 */
export function hydrateVideoLayout(): void {
  const { mode, emphasizedFeedId, fillPanelFeedId } = snapshot.video
  useAppStore.setState({
    videoLayoutMode: mode,
    emphasizedFeedId,
    fillPanelFeedId
  })
}

/**
 * Persist the main-window video layout on every change. Subscribing to the whole
 * store is cheap — the listener early-returns unless one of the three layout
 * fields actually moved, so audio-activity churn does not trigger a write.
 */
export function startVideoLayoutPersistence(): void {
  let prev = readVideoLayout(useAppStore.getState())
  useAppStore.subscribe((state) => {
    const next = readVideoLayout(state)
    if (
      next.mode === prev.mode &&
      next.emphasizedFeedId === prev.emphasizedFeedId &&
      next.fillPanelFeedId === prev.fillPanelFeedId
    ) {
      return
    }
    prev = next
    snapshot = { ...snapshot, video: next }
    window.api.session.patch({ video: next })
  })
}

/** Every feed id claimed by an open pop-out in a summary list (deduplicated). */
function unionFeeds(popouts: readonly PopoutSummary[]): string[] {
  return [...new Set(popouts.flatMap((p) => p.feedIds))]
}

/**
 * Seed the main grid's hand-off set from the restored pop-outs (main window),
 * then keep it in step with live open/close via the windows:popoutsChanged push,
 * so a popped-out feed is hidden in the main grid and returns when its pop-out closes.
 */
export function startPopoutFeedTracking(): void {
  useAppStore.getState().setPoppedOutFeedIds(unionFeeds(snapshot.popouts))
  window.api.windows.onPopoutsChanged((popouts) => {
    useAppStore.getState().setPoppedOutFeedIds(unionFeeds(popouts))
  })
}

/** This pop-out window's own persisted slice (by its launch id), or undefined. */
export function currentPopoutSlice(): PopoutState | undefined {
  const id = window.api.windows.popoutId
  if (id === null) return undefined
  return snapshot.popouts.find((p) => p.id === id)
}
