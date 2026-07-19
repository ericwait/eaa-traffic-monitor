import { screen } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import type { DisplayInfo } from '@shared/windowBounds'
import { validateWindowBounds } from '@shared/windowBounds'
import type { WindowBoundsState } from '@shared/ipc'

// The Electron-facing half of window-bounds restore — the thin, side-effecting
// wrapper around `screen` that feeds the pure validator (shared/windowBounds.ts)
// and reads/writes a window's live bounds. Kept apart from the validator so all
// the geometry decisions stay unit-tested and this file holds only `screen`
// plumbing. Used for the main window (index.ts) and every pop-out (popouts.ts).

/** Snapshot the current displays as the validator's DisplayInfo plus the primary id. */
function currentDisplays(): { displays: DisplayInfo[]; primaryId: number } {
  const displays = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: { ...d.workArea } }))
  return { displays, primaryId: screen.getPrimaryDisplay().id }
}

/**
 * Resolve a saved window slice to bounds that are guaranteed on-screen right now,
 * or null when there is nothing usable saved (first run) — the caller then falls
 * back to its default size and lets Electron place the window. Logs when it had
 * to move a window off a disconnected/shrunk display.
 */
export function resolveSavedBounds(
  saved: WindowBoundsState | null,
  label: string
): { bounds: Rectangle; displayId: number | null } | null {
  if (!saved) return null
  const { displays, primaryId } = currentDisplays()
  const result = validateWindowBounds(saved, displays, primaryId)
  if (result.recentred) {
    console.log(
      `[windowState] ${label} saved bounds were off-screen (display ${saved.displayId ?? 'unknown'} ` +
        `unavailable) — recentred onto display ${result.displayId}.`
    )
  }
  return {
    bounds: {
      x: result.bounds.x,
      y: result.bounds.y,
      width: result.bounds.width,
      height: result.bounds.height
    },
    displayId: result.displayId
  }
}

/** The window's current bounds plus the display it now sits on, as a session slice. */
export function boundsStateFor(win: BrowserWindow): WindowBoundsState {
  const b = win.getBounds()
  const displayId = screen.getDisplayMatching(b).id
  return { x: b.x, y: b.y, width: b.width, height: b.height, displayId }
}

/**
 * Persist a window's bounds/display whenever it moves or resizes. `persist` is
 * called with the fresh slice; it is expected to route through the debounced
 * session store, so the move/resize storm coalesces into one atomic write.
 * Returns a disposer that removes the listeners.
 */
export function trackWindowBounds(
  win: BrowserWindow,
  persist: (bounds: WindowBoundsState) => void
): () => void {
  const onChange = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    persist(boundsStateFor(win))
  }
  win.on('resize', onChange)
  win.on('move', onChange)
  return () => {
    win.removeListener('resize', onChange)
    win.removeListener('move', onChange)
  }
}
