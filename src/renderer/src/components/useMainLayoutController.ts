import { useMemo } from 'react'
import type { LayoutController } from '../layout/LayoutController'
import { useAppStore } from '../state/store'

/**
 * The MAIN window's `LayoutController` (decision 2026-07-20; see
 * layout/LayoutController.ts): a thin, memoized adapter selecting the exact
 * same `useAppStore` fields/actions the panel canvas read/called directly
 * before this refactor, so main-window behavior is unchanged, byte for byte.
 * A future pop-out window builds its own controller against its own state
 * instead of reusing this hook. See docs/decisions/README.md.
 */
export function useMainLayoutController(): LayoutController {
  const tree = useAppStore((s) => s.panelTree)
  const maximizedPanelId = useAppStore((s) => s.maximizedPanelId)
  const dragPanelId = useAppStore((s) => s.dragPanelId)
  const videoFit = useAppStore((s) => s.videoFit)
  const updateSplitSizes = useAppStore((s) => s.updateSplitSizes)
  const commitDrag = useAppStore((s) => s.commitDrag)
  const toggleMaximize = useAppStore((s) => s.toggleMaximize)
  const setDragPanelId = useAppStore((s) => s.setDragPanelId)
  const setVideoFit = useAppStore((s) => s.setVideoFit)
  const openMovePanel = useAppStore((s) => s.openMovePanel)
  const closePanel = useAppStore((s) => s.closePanel)

  return useMemo<LayoutController>(
    () => ({
      tree,
      maximizedPanelId,
      dragPanelId,
      videoFit,
      updateSplitSizes,
      commitDrag,
      toggleMaximize,
      setDragPanelId,
      setVideoFit,
      openMovePanel,
      closePanel
    }),
    [
      tree,
      maximizedPanelId,
      dragPanelId,
      videoFit,
      updateSplitSizes,
      commitDrag,
      toggleMaximize,
      setDragPanelId,
      setVideoFit,
      openMovePanel,
      closePanel
    ]
  )
}
