import { describe, it, expect } from 'vitest'
import {
  validateWindowBounds,
  DEFAULT_COVERAGE_THRESHOLD,
  type DisplayInfo
} from '@shared/windowBounds'

// Guardian tests for the missing-display bounds validator — the Phase 4 exit
// criterion made testable ("with a pop-out's display disconnected at launch, it
// still opens, recentred onto the primary — never off-screen and invisible").
// The scenarios are the real ones: a display unplugged, a display resized
// smaller, a negative-coordinate second monitor to the left of primary, and a
// window left partly or wholly off the desktop.

// A common two-monitor desktop: primary 1920x1080 at the origin, a secondary
// 1920x1080 to its RIGHT. Work areas trim a top menu bar for realism.
const PRIMARY: DisplayInfo = { id: 1, workArea: { x: 0, y: 25, width: 1920, height: 1055 } }
const RIGHT_SECONDARY: DisplayInfo = {
  id: 2,
  workArea: { x: 1920, y: 25, width: 1920, height: 1055 }
}
// A secondary to the LEFT of primary — its origin is negative, the case naive
// clamping-to-zero breaks.
const LEFT_SECONDARY: DisplayInfo = {
  id: 3,
  workArea: { x: -1920, y: 25, width: 1920, height: 1055 }
}

describe('validateWindowBounds', () => {
  it('keeps a window fully within the primary display and reports that display', () => {
    const result = validateWindowBounds(
      { x: 100, y: 100, width: 1280, height: 800, displayId: 1 },
      [PRIMARY, RIGHT_SECONDARY],
      1
    )
    expect(result.recentred).toBe(false)
    expect(result.displayId).toBe(1)
    expect(result.bounds).toEqual({ x: 100, y: 100, width: 1280, height: 800 })
  })

  it('keeps a correctly-placed window on a negative-coordinate left monitor unchanged', () => {
    // The whole window sits inside the left monitor's negative-x work area; a
    // validator that clamped x to >= 0 would wrongly yank it onto primary.
    const saved = { x: -1600, y: 100, width: 1000, height: 700, displayId: 3 }
    const result = validateWindowBounds(saved, [PRIMARY, LEFT_SECONDARY], 1)
    expect(result.recentred).toBe(false)
    expect(result.displayId).toBe(3)
    expect(result.bounds).toEqual({ x: -1600, y: 100, width: 1000, height: 700 })
  })

  it('keeps a window straddling two adjacent monitors (fully covered by the union)', () => {
    // Spans the seam (x=1920) between primary and the right secondary; every
    // pixel is on one display or the other, so coverage is 1.0 and it stays put.
    // 300 px sit on primary and 700 past the seam, so the secondary owns it.
    const saved = { x: 1620, y: 200, width: 1000, height: 600, displayId: 1 }
    const result = validateWindowBounds(saved, [PRIMARY, RIGHT_SECONDARY], 1)
    expect(result.recentred).toBe(false)
    expect(result.displayId).toBe(2)
    expect(result.bounds).toEqual({ x: 1620, y: 200, width: 1000, height: 600 })
  })

  it('keeps a window with only a small overhang past a screen edge (majority visible)', () => {
    // 200 of 1000 px hang off the right edge of the single display → 80% visible,
    // above the 0.6 threshold → not disruptive, leave it.
    const result = validateWindowBounds({ x: 1120, y: 300, width: 1000, height: 500 }, [PRIMARY], 1)
    expect(result.recentred).toBe(false)
    expect(result.displayId).toBe(1)
    expect(result.bounds).toEqual({ x: 1120, y: 300, width: 1000, height: 500 })
  })

  it('recentres a window that is mostly off-screen onto its owning display', () => {
    // 800 of 1000 px hang off the right edge → only 20% visible → recentre.
    const result = validateWindowBounds({ x: 1720, y: 300, width: 1000, height: 500 }, [PRIMARY], 1)
    expect(result.recentred).toBe(true)
    expect(result.displayId).toBe(1)
    // Centred in the primary work area (0..1920 x 25..1080).
    expect(result.bounds).toEqual({ x: 460, y: 303, width: 1000, height: 500 })
  })

  it('recentres a fully off-screen window onto the primary display', () => {
    const result = validateWindowBounds(
      { x: 6000, y: 6000, width: 800, height: 600, displayId: 1 },
      [PRIMARY, RIGHT_SECONDARY],
      1
    )
    expect(result.recentred).toBe(true)
    expect(result.displayId).toBe(1)
    expect(result.bounds).toEqual({ x: 560, y: 253, width: 800, height: 600 })
  })

  it('reappears on the primary when the saved display was unplugged (the exit criterion)', () => {
    // A pop-out saved on the right secondary (id 2), which is now gone. Its saved
    // bounds sit in the 1920..3840 x-range that no longer exists.
    const savedOnMonitor2 = { x: 2400, y: 200, width: 900, height: 600, displayId: 2 }
    const result = validateWindowBounds(savedOnMonitor2, [PRIMARY], 1)
    expect(result.recentred).toBe(true)
    expect(result.displayId).toBe(1)
    // Fully inside the primary work area — never off-screen.
    expect(result.bounds.x).toBeGreaterThanOrEqual(PRIMARY.workArea.x)
    expect(result.bounds.y).toBeGreaterThanOrEqual(PRIMARY.workArea.y)
    expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(
      PRIMARY.workArea.x + PRIMARY.workArea.width
    )
    expect(result.bounds.y + result.bounds.height).toBeLessThanOrEqual(
      PRIMARY.workArea.y + PRIMARY.workArea.height
    )
  })

  it('follows the saved display id when it still exists but the window drifted off it', () => {
    // Saved on the right secondary and off-screen there; the right secondary is
    // still connected, so it reappears there, not on primary.
    const saved = { x: 3900, y: 2000, width: 800, height: 600, displayId: 2 }
    const result = validateWindowBounds(saved, [PRIMARY, RIGHT_SECONDARY], 1)
    expect(result.recentred).toBe(true)
    expect(result.displayId).toBe(2)
    expect(result.bounds).toEqual({ x: 2480, y: 253, width: 800, height: 600 })
  })

  it('shrinks a window too large for a display that was resized smaller', () => {
    // The display dropped from 1920x1080 to 1024x768; the saved 1600x1000 window
    // now covers the whole small screen but overhangs badly → shrink to fit.
    const small: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1024, height: 768 } }
    const result = validateWindowBounds(
      { x: 0, y: 0, width: 1600, height: 1000, displayId: 1 },
      [small],
      1
    )
    expect(result.recentred).toBe(true)
    expect(result.displayId).toBe(1)
    expect(result.bounds.width).toBeLessThanOrEqual(1024)
    expect(result.bounds.height).toBeLessThanOrEqual(768)
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 1024, height: 768 })
  })

  it('falls back to the primary when the saved display id is unknown and bounds are off-screen', () => {
    const result = validateWindowBounds(
      { x: 9000, y: 9000, width: 800, height: 600, displayId: 99 },
      [PRIMARY, RIGHT_SECONDARY],
      1
    )
    expect(result.displayId).toBe(1)
    expect(result.recentred).toBe(true)
  })

  it('falls back to the first display when neither the saved nor the primary id exists', () => {
    // Primary id 1 is not in the list (a degenerate hotplug race); use displays[0].
    const result = validateWindowBounds(
      { x: 9000, y: 9000, width: 800, height: 600, displayId: 7 },
      [RIGHT_SECONDARY],
      1
    )
    expect(result.displayId).toBe(2)
    expect(result.recentred).toBe(true)
  })

  it('returns the bounds untouched when there are no displays at all', () => {
    const saved = { x: 100, y: 100, width: 800, height: 600, displayId: 2 }
    const result = validateWindowBounds(saved, [], 1)
    expect(result.recentred).toBe(false)
    expect(result.displayId).toBe(2)
    expect(result.bounds).toEqual({ x: 100, y: 100, width: 800, height: 600 })
  })

  it('recentres when saved dimensions are non-finite (garbage from a corrupt store)', () => {
    const result = validateWindowBounds(
      { x: Number.NaN, y: 0, width: Number.POSITIVE_INFINITY, height: 600, displayId: 1 },
      [PRIMARY],
      1
    )
    expect(result.recentred).toBe(true)
    expect(result.displayId).toBe(1)
    // Non-finite width fell back to the display width; the window is on-screen.
    expect(Number.isFinite(result.bounds.x)).toBe(true)
    expect(result.bounds.width).toBeGreaterThan(0)
    expect(result.bounds.width).toBeLessThanOrEqual(PRIMARY.workArea.width)
  })

  it('honours an explicit coverage threshold', () => {
    // 50% visible: rejected at the default 0.6, accepted at 0.4.
    const saved = { x: 960, y: 300, width: 1920, height: 500 }
    expect(validateWindowBounds(saved, [PRIMARY], 1, DEFAULT_COVERAGE_THRESHOLD).recentred).toBe(
      true
    )
    expect(validateWindowBounds(saved, [PRIMARY], 1, 0.4).recentred).toBe(false)
  })
})
