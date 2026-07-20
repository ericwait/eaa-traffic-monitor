import { createContext, useContext } from 'react'
import type { DropTarget, LayoutNode, PanelId, VideoFitMode } from '@shared/panelLayout'

// (decision 2026-07-20) The panel canvas (PanelCanvas.tsx, LeafFrame.tsx,
// Splitter.tsx, useHeaderDrag.ts, DragOverlay.tsx, and the shared leaf chrome
// in PanelChromeButtons.tsx) is window-agnostic: every one of those files
// reads and writes layout state ONLY through this interface, delivered via
// React context, and none of them import the main window's `useAppStore`
// directly any more. This is what lets a future pop-out window
// (docs/Panel-System-Plan.md) reuse the same canvas machinery and the video
// leaf body (components/VideoLeafBody.tsx) against its OWN state instead of
// the main window's global store.
//
// The MAIN window's controller (components/useMainLayoutController.ts) is a
// thin, memoized adapter selecting the exact same `useAppStore`
// fields/actions the canvas read/called directly before this refactor — so
// main-window behavior is unchanged, byte for byte. See
// docs/decisions/README.md.
//
// Shape mirrors the slice of `AppState` (state/store.ts) the canvas + its
// leaf chrome actually consume — nothing main-window-specific (overlay,
// movePanelId, audio/weather/navState, …) belongs here; those stay owned by
// LayoutShell.tsx and the leaf-body components the window supplies via
// `renderLeafBody`.
export interface LayoutController {
  /** The current split tree PanelCanvas renders. */
  tree: LayoutNode
  /** The one leaf occupying the full canvas, or null. Every other leaf gets `visibility: hidden` (LeafFrame), never unmounted. */
  maximizedPanelId: PanelId | null
  /** Non-null only for the duration of a header-drag-to-dock gesture. */
  dragPanelId: PanelId | null
  /** Per-feed video fit/fill mode, keyed by the bare feed id (not the `video:` panel id). Absent = 'fit'. */
  videoFit: Record<string, VideoFitMode>
  /** Commit a settled splitter drag's sizes for one split id. */
  updateSplitSizes: (splitId: string, sizes: readonly number[]) => void
  /** Commit a header-drag-to-dock gesture as ONE write: applies the move AND clears `dragPanelId` together. */
  commitDrag: (id: PanelId, target: DropTarget) => void
  /** Toggle maximize for `id` — maximizing an already-maximized id restores. */
  toggleMaximize: (id: PanelId) => void
  /** Mark/unmark the panel being header-drag-dragged. */
  setDragPanelId: (id: PanelId | null) => void
  /** Set one feed's fit/fill mode. */
  setVideoFit: (feedId: string, mode: VideoFitMode) => void
  /** Open the Move-panel modal targeting `id`. */
  openMovePanel: (id: PanelId) => void
  /** Remove a leaf from the tree (a LeafFrame close button). */
  closePanel: (id: PanelId) => void
}

const LayoutControllerContext = createContext<LayoutController | null>(null)

/** Supplies the `LayoutController` every canvas/leaf-chrome component below it reads via `useLayoutController()`. The window hosting the canvas (LayoutShell.tsx today) is the one place that constructs the value. */
export const LayoutControllerProvider = LayoutControllerContext.Provider

/**
 * Read the layout controller the enclosing window provided. Every canvas
 * render lives inside a `LayoutControllerProvider` (LayoutShell.tsx wraps
 * `PanelCanvas` in one) — a missing provider is a wiring bug, so this throws
 * rather than silently falling back to some default.
 */
export function useLayoutController(): LayoutController {
  const controller = useContext(LayoutControllerContext)
  if (controller === null) {
    throw new Error('useLayoutController() called outside a LayoutControllerProvider')
  }
  return controller
}
