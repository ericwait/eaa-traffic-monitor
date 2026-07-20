import { describe, it, expect } from 'vitest'
import { computeAspectRect } from '@shared/videoGeometry'

// Guardian tests for the video fit/fill geometry (see
// docs/Panel-System-Plan.md § Key interactions § Video fit/fill): fit
// inscribes (letterboxed, never cropped), fill covers (cropped by the
// caller's overflow:hidden, never letterboxed), both center the result, both
// output integers, and both degrade to a zero rect rather than NaN.

const ASPECT_16_9 = 16 / 9

describe('computeAspectRect — fit (inscribed)', () => {
  it('a wider-than-16:9 container is height-constrained, centered horizontally', () => {
    const rect = computeAspectRect({ width: 2000, height: 500 }, 'fit')
    expect(rect.height).toBe(500)
    expect(rect.width).toBeLessThan(2000)
    expect(rect.width).toBe(Math.round(500 * ASPECT_16_9))
    expect(rect.y).toBe(0)
    expect(rect.x).toBe(Math.round((2000 - rect.width) / 2))
  })

  it('a taller/narrower-than-16:9 container is width-constrained, centered vertically', () => {
    const rect = computeAspectRect({ width: 400, height: 900 }, 'fit')
    expect(rect.width).toBe(400)
    expect(rect.height).toBeLessThan(900)
    expect(rect.height).toBe(Math.round(400 / ASPECT_16_9))
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(Math.round((900 - rect.height) / 2))
  })

  it('an exact 16:9 container fills it exactly with no centering offset', () => {
    const rect = computeAspectRect({ width: 1920, height: 1080 }, 'fit')
    expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })
})

describe('computeAspectRect — fill (covering)', () => {
  it('a wider-than-16:9 container is width-constrained (overshoots height, to be cropped)', () => {
    const rect = computeAspectRect({ width: 2000, height: 500 }, 'fill')
    expect(rect.width).toBe(2000)
    expect(rect.height).toBeGreaterThan(500)
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(Math.round((500 - rect.height) / 2))
  })

  it('a taller/narrower-than-16:9 container is height-constrained (overshoots width, to be cropped)', () => {
    const rect = computeAspectRect({ width: 400, height: 900 }, 'fill')
    expect(rect.height).toBe(900)
    expect(rect.width).toBeGreaterThan(400)
    expect(rect.y).toBe(0)
    expect(rect.x).toBe(Math.round((400 - rect.width) / 2))
  })

  it('an exact 16:9 container fills it exactly, same as fit', () => {
    const rect = computeAspectRect({ width: 1920, height: 1080 }, 'fill')
    expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('fill always covers at least as much area as fit for the same container', () => {
    const container = { width: 733, height: 511 }
    const fit = computeAspectRect(container, 'fit')
    const fill = computeAspectRect(container, 'fill')
    expect(fill.width * fill.height).toBeGreaterThanOrEqual(fit.width * fit.height)
    expect(fill.width).toBeGreaterThanOrEqual(container.width)
    expect(fill.height).toBeGreaterThanOrEqual(container.height)
    expect(fit.width).toBeLessThanOrEqual(container.width)
    expect(fit.height).toBeLessThanOrEqual(container.height)
  })
})

describe('computeAspectRect — centered, integer, custom aspect', () => {
  it('centers both fit and fill rects (offsets split the leftover space evenly)', () => {
    for (const mode of ['fit', 'fill'] as const) {
      const rect = computeAspectRect({ width: 1000, height: 333 }, mode)
      const leftoverX = 1000 - rect.width
      const leftoverY = 333 - rect.height
      expect(rect.x).toBeCloseTo(leftoverX / 2, 0)
      expect(rect.y).toBeCloseTo(leftoverY / 2, 0)
    }
  })

  it('always returns integers, even for fractional container sizes', () => {
    const rect = computeAspectRect({ width: 999.7, height: 400.3 }, 'fit')
    for (const value of [rect.x, rect.y, rect.width, rect.height]) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('honors a custom aspect ratio (e.g. 4:3)', () => {
    const rect = computeAspectRect({ width: 800, height: 800 }, 'fit', 4 / 3)
    expect(rect.width).toBe(800)
    expect(rect.height).toBe(600)
  })
})

describe('computeAspectRect — zero-safe', () => {
  it('returns a zero rect (never NaN) for a zero-width or zero-height container', () => {
    expect(computeAspectRect({ width: 0, height: 500 }, 'fit')).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
    expect(computeAspectRect({ width: 500, height: 0 }, 'fill')).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
  })

  it('returns a zero rect for negative or non-finite container dimensions', () => {
    expect(computeAspectRect({ width: -100, height: 500 }, 'fit')).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
    expect(computeAspectRect({ width: Number.NaN, height: 500 }, 'fit')).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
    expect(computeAspectRect({ width: Number.POSITIVE_INFINITY, height: 500 }, 'fill')).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
  })

  it('returns a zero rect for a zero, negative, or non-finite aspect ratio', () => {
    expect(computeAspectRect({ width: 500, height: 500 }, 'fit', 0)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
    expect(computeAspectRect({ width: 500, height: 500 }, 'fit', -1)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
    expect(computeAspectRect({ width: 500, height: 500 }, 'fit', Number.NaN)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
  })
})
