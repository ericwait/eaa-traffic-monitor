import type { PopoutState, PopoutSummary, SessionState } from '@shared/ipc'
import { defaultSessionState } from '@shared/session'
import {
  buildDefaultTree,
  collectLeafIds,
  pruneVideoLeaves,
  treesEqual,
  type LayoutNode,
  type PanelId,
  type PanelLayoutSession
} from '@shared/panelLayout'
import { defaultFeeds } from '../youtube/defaultFeeds'
import { useAppStore, type AppState } from './store'

// Renderer-side session bootstrap. The persisted session is fetched ONCE before
// the app mounts (see main.tsx) and stashed here as a synchronous snapshot, so
// every restore consumer can hydrate without an async flash:
//   - the panel-layout canvas hydration below,
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

/** Every feed id claimed by an open pop-out in a summary list (deduplicated). */
function unionFeeds(popouts: readonly PopoutSummary[]): string[] {
  return [...new Set(popouts.flatMap((p) => p.feedIds))]
}

/**
 * Seed + hydrate the panel-layout canvas from the persisted session, BEFORE
 * React mounts (see main.tsx), so the canvas opens in its restored
 * arrangement with no default-then-restore flash. `panelLayout: null`
 * (every pre-panel-canvas session, or a corrupt one — see
 * sanitizePanelLayoutSession) falls back to `buildDefaultTree`. Either way,
 * `video:` leaves for feeds no longer in `defaultFeeds`, or already claimed
 * by a restored pop-out, are pruned; an emptied tree (e.g. every video feed
 * is popped out) falls back to `buildDefaultTree` of whatever remains.
 */
export function hydratePanelLayout(): void {
  const allFeedIds = defaultFeeds.map((f) => f.id)
  const claimedByPopout = new Set(unionFeeds(snapshot.popouts))
  const allowedFeedIds = allFeedIds.filter((id) => !claimedByPopout.has(id))

  const persisted = snapshot.panelLayout
  const startingTree: LayoutNode = persisted?.tree ?? buildDefaultTree(allFeedIds)
  const tree = pruneVideoLeaves(startingTree, allowedFeedIds) ?? buildDefaultTree(allowedFeedIds)

  const leafIds = new Set(collectLeafIds(tree))
  const maximizedPanelId =
    persisted?.maximizedPanelId != null && leafIds.has(persisted.maximizedPanelId)
      ? persisted.maximizedPanelId
      : null

  useAppStore.setState({
    panelTree: tree,
    layoutRevision: 0,
    maximizedPanelId,
    videoFit: persisted?.videoFit ?? {},
    layoutProfiles: persisted?.profiles ?? [],
    activeProfileName: null
  })
}

/** Read the store's panel-layout fields as one PanelLayoutSession (the shape persisted). */
function readPanelLayout(state: AppState): PanelLayoutSession {
  return {
    tree: state.panelTree,
    maximizedPanelId: state.maximizedPanelId,
    videoFit: state.videoFit,
    profiles: state.layoutProfiles
  }
}

/**
 * Persist the panel-layout section on every change (whole-section replace,
 * like `window` — see @shared/ipc's SessionPatch doc). Subscribing to the
 * whole store is cheap: the listener early-returns unless the tree/maximize/
 * fit/profiles actually moved, so unrelated churn (audio activity, weather
 * polling) never triggers a write.
 */
export function startPanelLayoutPersistence(): void {
  let prev = readPanelLayout(useAppStore.getState())
  useAppStore.subscribe((state) => {
    const next = readPanelLayout(state)
    if (
      treesEqual(next.tree, prev.tree) &&
      next.maximizedPanelId === prev.maximizedPanelId &&
      next.videoFit === prev.videoFit &&
      next.profiles === prev.profiles
    ) {
      return
    }
    prev = next
    snapshot = { ...snapshot, panelLayout: next }
    window.api.session.patch({ panelLayout: next })
  })
}

/**
 * Seed the main grid's hand-off set from the restored pop-outs (main window),
 * then keep it in step with live open/close via the windows:popoutsChanged
 * push — AND reconcile the panel tree to match (docs/Panel-System-Plan.md §
 * Key interactions § Pop-out interplay): a feed newly claimed by a pop-out is
 * removed from the canvas (`closePanel`); a feed returning from a closed
 * pop-out is reinserted, balanced (`openPanel`). The STARTING set is already
 * accounted for by `hydratePanelLayout`'s prune step, so only the DELTA on
 * each push needs reconciling here.
 */
export function startPopoutFeedTracking(): void {
  const initial = unionFeeds(snapshot.popouts)
  useAppStore.getState().setPoppedOutFeedIds(initial)
  let prevClaimed = new Set(initial)

  window.api.windows.onPopoutsChanged((popouts) => {
    const nextIds = unionFeeds(popouts)
    useAppStore.getState().setPoppedOutFeedIds(nextIds)

    const nextClaimed = new Set(nextIds)
    for (const feedId of nextClaimed) {
      if (!prevClaimed.has(feedId)) {
        useAppStore.getState().closePanel(`video:${feedId}` as PanelId)
      }
    }
    for (const feedId of prevClaimed) {
      if (!nextClaimed.has(feedId)) {
        useAppStore.getState().openPanel({ type: 'leaf', id: `video:${feedId}` as PanelId })
      }
    }
    prevClaimed = nextClaimed
  })
}

/** This pop-out window's own persisted slice (by its launch id), or undefined. */
export function currentPopoutSlice(): PopoutState | undefined {
  const id = window.api.windows.popoutId
  if (id === null) return undefined
  return snapshot.popouts.find((p) => p.id === id)
}
