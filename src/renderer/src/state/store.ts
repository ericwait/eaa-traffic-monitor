import { create } from 'zustand'
import type { Fr24NavState } from '@shared/ipc'

// The per-window live UI store (zustand). Phase 1 holds just the FR24 nav state
// (pushed from main) and the overlay flag that drives the z-order rule. It works
// outside React, which is why later phases can let the audio-engine singleton
// write into a store like this directly; here the "writer" is the IPC glue that
// forwards fr24:navState pushes.

const INITIAL_NAV_STATE: Fr24NavState = {
  canGoBack: false,
  canGoForward: false,
  url: '',
  isLoading: false
}

export interface AppState {
  /** Latest FR24 navigation state, mirrored from the main process. */
  navState: Fr24NavState
  /**
   * True while a DOM overlay/modal is open over the FR24 region. Because the
   * WebContentsView paints ABOVE all DOM, this flag drives fr24:setVisible(false)
   * so the overlay is actually visible — the standing z-order pattern (see
   * CLAUDE.md gotchas). Every future overlay that can cover the FR24 region must
   * set this the same way.
   */
  overlayOpen: boolean
  setNavState: (navState: Fr24NavState) => void
  setOverlayOpen: (overlayOpen: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  navState: INITIAL_NAV_STATE,
  overlayOpen: false,
  setNavState: (navState) => set({ navState }),
  setOverlayOpen: (overlayOpen) => set({ overlayOpen })
}))

/**
 * Custom DOM event the layout dispatches when a resizable panel divider moves,
 * so the FR24 region can re-measure and re-sync its native view bounds. A plain
 * window event keeps the layout and the FR24 panel decoupled and avoids a store
 * write (and re-render) on every pointer move during a drag.
 */
export const FR24_RELAYOUT_EVENT = 'fr24-relayout'
