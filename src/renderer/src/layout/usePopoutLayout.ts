import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeedAudioState, PopoutState } from '@shared/ipc'
import {
  buildBalancedGrid,
  movePanel as movePanelOp,
  pruneVideoLeaves,
  removePanel,
  updateSplitSizes as updateSplitSizesOp,
  type DropTarget,
  type LayoutNode,
  type PanelId,
  type VideoFitMode
} from '@shared/panelLayout'
import type { LayoutController } from './LayoutController'
import { videoFeedIdOf } from './panelMeta'
import { defaultFeeds } from '../youtube/defaultFeeds'

// The pop-out window's own `LayoutController` (decision 2026-07-20; see
// docs/Panel-System-Plan.md and docs/design/Layout.md's pop-out section): a
// pop-out reuses the EXACT SAME panel canvas (PanelCanvas/LeafFrame/Splitter/
// useHeaderDrag/DragOverlay/VideoLeafBody) as the main window, but backed by
// LOCAL React state here instead of the global zustand store — mirrors
// components/useMainLayoutController.ts against `useAppStore`, one level
// down. Every open/close/move/maximize/fit action funnels through the SAME
// pure `@shared/panelLayout` ops the main window uses, so both windows share
// one tested implementation of "what does a drag-to-dock/split/maximize
// mean" — only where the tree LIVES differs. Pop-outs have no Move-panel
// modal or Layout Manager (main-window-only by decision — a pop-out's reorg
// path is header-drag-to-dock on this very canvas), so `openMovePanel` is an
// unreachable no-op here (PanelChromeButtons hides the button in this
// context — see components/VideoLeafBody.tsx's `popout` prop).
//
// Persistence: tree/videoFit changes are pushed to this pop-out's OWN
// PopoutState slice via `windows:patchPopout` (main process debounces the
// actual disk flush — see src/main/session.ts's scheduleFlush), the same
// "commit on every structural change, let main coalesce the write" pattern
// state/sessionBootstrap.ts's startPanelLayoutPersistence uses for the main
// window's panelLayout section. feedIds is persisted separately (its own
// effect): src/main/popouts.ts's PopoutManager.patchPopout broadcasts
// windows:popoutsChanged specifically when feedIds is part of the patch —
// that broadcast is what tells the MAIN window's own
// state/sessionBootstrap.ts (startPopoutFeedTracking) a feed came back.
//
// Closing the LAST leaf closes the whole window (existing pop-out semantics
// — see src/main/popouts.ts's 'closed' handler, which removes this slice and
// returns EVERY one of its feeds to the main grid). Closing one of SEVERAL
// leaves instead drops just that leaf + feed id locally; the resulting
// smaller feedIds list, once persisted, is what the main window's canvas
// reads (via insertVideoLeafBottom) to bring that one feed back — this
// window never has to know anything about the main window's own tree.

/** This pop-out's feed ids, filtered to feeds still in `defaultFeeds` (a feed can rotate out of config while an old pop-out slice still names it — mirrors state/sessionBootstrap.ts's hydratePanelLayout prune). */
function allowedFeeds(feedIds: readonly string[]): string[] {
  const known = new Set(defaultFeeds.map((f) => f.id))
  return feedIds.filter((id) => known.has(id))
}

/** The starting tree: the persisted tree pruned to this window's currently-allowed feeds, or a fresh balanced grid when there's nothing to prune (a missing/corrupt tree, or every leaf got pruned away). */
function initialTree(rawTree: LayoutNode | null, feeds: readonly string[]): LayoutNode | null {
  const pruned = pruneVideoLeaves(rawTree, feeds)
  return pruned ?? buildBalancedGrid(feeds.map((id): PanelId => `video:${id}`))
}

export interface UsePopoutLayoutResult {
  /** `null` only when this pop-out has no feeds at all — PopoutApp shows the empty-window message instead of mounting the canvas/controller. */
  controller: LayoutController | null
  /** Per-feed audio state (volume/mute), keyed by feed id — the pop-out's own leaf body reads/writes this per tile (main-window tiles have no such persistence). */
  volumes: Record<string, FeedAudioState>
  /** Persist one feed's volume/mute (mirrors the pre-canvas PopoutApp's handleAudioChange). */
  setFeedAudio: (feedId: string, state: FeedAudioState) => void
}

export function usePopoutLayout(
  popoutId: number | null,
  slice: PopoutState | undefined
): UsePopoutLayoutResult {
  const feeds = useMemo(() => allowedFeeds(slice?.feedIds ?? []), [slice])

  const [tree, setTree] = useState<LayoutNode | null>(() => initialTree(slice?.tree ?? null, feeds))
  const [videoFit, setVideoFitState] = useState<Record<string, VideoFitMode>>(
    () => slice?.videoFit ?? {}
  )
  const [maximizedPanelId, setMaximizedPanelId] = useState<PanelId | null>(null)
  const [dragPanelId, setDragPanelId] = useState<PanelId | null>(null)
  const [feedIds, setFeedIds] = useState<string[]>(feeds)
  const [volumes, setVolumes] = useState<Record<string, FeedAudioState>>(() => slice?.volumes ?? {})

  // Persist tree/videoFit together (whole-section replace, like the main
  // window's panelLayout — see state/sessionBootstrap.ts's
  // startPanelLayoutPersistence). The ref skips the very first render so
  // mounting never re-writes back the exact value it just read.
  const skipTreeEffect = useRef(true)
  useEffect(() => {
    if (skipTreeEffect.current) {
      skipTreeEffect.current = false
      return
    }
    if (popoutId !== null) window.api.windows.patchPopout(popoutId, { tree, videoFit })
  }, [tree, videoFit, popoutId])

  // Persisted separately from tree/videoFit — see this file's header comment
  // on why feedIds changing is what main/popouts.ts broadcasts on.
  const skipFeedIdsEffect = useRef(true)
  useEffect(() => {
    if (skipFeedIdsEffect.current) {
      skipFeedIdsEffect.current = false
      return
    }
    if (popoutId !== null) window.api.windows.patchPopout(popoutId, { feedIds })
  }, [feedIds, popoutId])

  const updateSplitSizes = useCallback((splitId: string, sizes: readonly number[]): void => {
    setTree((prev) => (prev === null ? prev : updateSplitSizesOp(prev, splitId, sizes)))
  }, [])

  const commitDrag = useCallback((id: PanelId, target: DropTarget): void => {
    setTree((prev) => (prev === null ? prev : movePanelOp(prev, id, target)))
    setDragPanelId(null)
  }, [])

  const toggleMaximize = useCallback((id: PanelId): void => {
    setMaximizedPanelId((prev) => (prev === id ? null : id))
  }, [])

  // A thin wrapper (rather than handing the raw `Dispatch` straight to the
  // controller) so this reads identically to the store action
  // `LayoutController.setDragPanelId` expects — one argument in, no
  // functional-update overload exposed to callers.
  const setDragPanelIdAction = useCallback((id: PanelId | null): void => {
    setDragPanelId(id)
  }, [])

  const setVideoFit = useCallback((feedId: string, mode: VideoFitMode): void => {
    setVideoFitState((prev) => ({ ...prev, [feedId]: mode }))
  }, [])

  // Unreachable in practice: PanelChromeButtons hides "Move panel…" for every
  // pop-out leaf (see VideoLeafBody's `popout` prop / `hideMove`), since
  // header-drag-to-dock on this same canvas is the pop-out's reorg path and
  // the Move-panel modal + Layout Manager stay main-window-only (decision
  // 2026-07-20). Kept only to satisfy the LayoutController shape.
  const openMovePanel = useCallback((): void => {}, [])

  const closePanel = useCallback(
    (id: PanelId): void => {
      if (tree === null) return
      const next = removePanel(tree, id)
      if (next === null) {
        // The only leaf left — close the whole window (today's existing
        // behavior): main's 'closed' handler removes this slice and returns
        // every one of this pop-out's feeds to the main grid.
        if (popoutId !== null) window.api.windows.closePopout(popoutId)
        return
      }
      if (next === tree) return // id wasn't in the tree — no-op
      setTree(next)
      const closedFeedId = videoFeedIdOf(id)
      setFeedIds((prev) => prev.filter((f) => f !== closedFeedId))
      setMaximizedPanelId((prev) => (prev === id ? null : prev))
    },
    [tree, popoutId]
  )

  const setFeedAudio = useCallback(
    (feedId: string, state: FeedAudioState): void => {
      setVolumes((prev) => ({ ...prev, [feedId]: state }))
      if (popoutId !== null) {
        window.api.windows.patchPopout(popoutId, { volumes: { [feedId]: state } })
      }
    },
    [popoutId]
  )

  const controller = useMemo<LayoutController | null>(() => {
    if (tree === null) return null
    return {
      tree,
      maximizedPanelId,
      dragPanelId,
      videoFit,
      updateSplitSizes,
      commitDrag,
      toggleMaximize,
      setDragPanelId: setDragPanelIdAction,
      setVideoFit,
      openMovePanel,
      closePanel
    }
  }, [
    tree,
    maximizedPanelId,
    dragPanelId,
    videoFit,
    updateSplitSizes,
    commitDrag,
    toggleMaximize,
    setDragPanelIdAction,
    setVideoFit,
    openMovePanel,
    closePanel
  ])

  return { controller, volumes, setFeedAudio }
}
