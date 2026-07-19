// Pure validation of a saved window's bounds against the displays that exist
// right now — the "a pop-out can wake up on the wrong screen" guard from
// docs/design/Video.md § Risks. Lifted out of the main process so it is
// testable with plain objects (no Electron `screen`, no BrowserWindow): the
// caller passes `screen.getAllDisplays()` mapped to DisplayInfo plus the primary
// display id, and gets back bounds guaranteed to land on a connected display.
//
// This is the Phase 4 analogue of fr24Bounds.ts — a small, side-effect-free
// geometry function that the app depends on but exercises entirely in vitest.
//
// The dominant real case (see the Phase 4 exit criterion): a pop-out saved on a
// second monitor that is unplugged before relaunch. Its saved bounds no longer
// intersect any live display, so it must reappear centred on the primary rather
// than opening off-screen and invisible.

/** A rectangle in the global (multi-display) coordinate space, in DIP. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** One connected display, identified, with the region a window may safely occupy. */
export interface DisplayInfo {
  /** Stable per-boot display id (`Electron.Display.id`). */
  id: number
  /**
   * The usable work area (excludes the menu bar / taskbar / dock) — always used
   * over the full `bounds` so a restored window never lands under system chrome.
   */
  workArea: Rect
}

/** Saved window bounds plus the display they were last seen on, if recorded. */
export interface SavedWindowBounds extends Rect {
  /**
   * The display id the window last occupied. Used only as the *preferred* target
   * when the bounds turn out to be off-screen; a stale/missing id falls through
   * to the primary display. Absent (undefined/null) on windows saved before
   * display tracking existed.
   */
  displayId?: number | null
}

/** The outcome of validating saved bounds against the current display set. */
export interface ValidatedWindowBounds {
  /** Bounds guaranteed to sit on a connected display (possibly the input, unchanged). */
  bounds: Rect
  /** The display the window will occupy, or null when there are no displays at all. */
  displayId: number | null
  /**
   * True when the saved bounds were unusable (off-screen / too big) and had to be
   * recentred or resized onto a display — the signal a caller can log.
   */
  recentred: boolean
}

/**
 * Fraction of a window's area that must remain visible on the current displays
 * for the saved bounds to be accepted as-is. Below this the window is treated as
 * off-screen and recentred. 0.6 keeps a window the operator can still see and
 * grab (a small overhang past a screen edge is fine) while rejecting one that is
 * mostly or entirely gone — including a window left too large for a now-smaller
 * display, which reads as low coverage and gets shrunk to fit.
 */
export const DEFAULT_COVERAGE_THRESHOLD = 0.6

/** Coerce a measurement to a finite integer, or `fallback` when it is not finite. */
function toInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback
}

/** Area of the overlap between two rects (0 when they do not intersect). */
function intersectionArea(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const w = right - left
  const h = bottom - top
  return w > 0 && h > 0 ? w * h : 0
}

/** The display whose work area overlaps `rect` most, or null when none do. */
function ownerDisplay(rect: Rect, displays: readonly DisplayInfo[]): DisplayInfo | null {
  let best: DisplayInfo | null = null
  let bestArea = 0
  for (const display of displays) {
    const area = intersectionArea(rect, display.workArea)
    if (area > bestArea) {
      bestArea = area
      best = display
    }
  }
  return best
}

/** Look up a display by id (null id / not found → undefined). */
function findDisplay(
  displays: readonly DisplayInfo[],
  id: number | null | undefined
): DisplayInfo | undefined {
  if (id == null) return undefined
  return displays.find((d) => d.id === id)
}

/**
 * Centre a `width × height` window inside `area`, shrinking either dimension that
 * exceeds the area so the whole window fits on the display it is placed on.
 */
function fitCentered(area: Rect, width: number, height: number): Rect {
  const w = Math.min(Math.max(1, toInt(width, area.width)), area.width)
  const h = Math.min(Math.max(1, toInt(height, area.height)), area.height)
  return {
    x: area.x + Math.round((area.width - w) / 2),
    y: area.y + Math.round((area.height - h) / 2),
    width: w,
    height: h
  }
}

/**
 * Validate saved window bounds against the connected displays.
 *
 * - Enough of the window is visible (>= `coverageThreshold` of its area overlaps
 *   some display work area): the bounds are kept unchanged and `displayId` is set
 *   to the display it mostly sits on — so a window straddling two monitors, or a
 *   correctly-placed window on a negative-coordinate secondary display, is left
 *   exactly where it was.
 * - Otherwise the window is off-screen (a disconnected display, a display that
 *   shrank, or bounds that never intersected any screen): it is fit-centred onto
 *   its last display if that display still exists, else the primary, else the
 *   first available — `recentred: true`.
 *
 * With no displays at all (a headless / between-hotplug edge) the bounds are
 * returned untouched rather than invented — there is nothing to validate against.
 */
export function validateWindowBounds(
  saved: SavedWindowBounds,
  displays: readonly DisplayInfo[],
  primaryDisplayId: number,
  coverageThreshold: number = DEFAULT_COVERAGE_THRESHOLD
): ValidatedWindowBounds {
  if (displays.length === 0) {
    return {
      bounds: { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
      displayId: saved.displayId ?? null,
      recentred: false
    }
  }

  const rect: Rect = {
    x: toInt(saved.x, 0),
    y: toInt(saved.y, 0),
    width: Math.max(0, toInt(saved.width, 0)),
    height: Math.max(0, toInt(saved.height, 0))
  }
  const windowArea = rect.width * rect.height

  if (windowArea > 0) {
    let visibleArea = 0
    for (const display of displays) visibleArea += intersectionArea(rect, display.workArea)
    const owner = ownerDisplay(rect, displays)
    if (owner && visibleArea / windowArea >= coverageThreshold) {
      return { bounds: rect, displayId: owner.id, recentred: false }
    }
  }

  // Off-screen: reassign to the last display if it survives, else the primary,
  // else whatever display is first — and fit the window inside its work area.
  const target =
    findDisplay(displays, saved.displayId) ?? findDisplay(displays, primaryDisplayId) ?? displays[0]
  return {
    bounds: fitCentered(
      target.workArea,
      rect.width || target.workArea.width,
      rect.height || target.workArea.height
    ),
    displayId: target.id,
    recentred: true
  }
}
