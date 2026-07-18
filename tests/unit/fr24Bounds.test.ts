import { describe, it, expect } from 'vitest'
import { rectToBounds, boundsEqual } from '@shared/fr24Bounds'

// Guardian tests for the FR24 rect->bounds conversion. The edge cases here are
// the ones a resizable-panel layout actually produces at runtime — fractional
// device pixels, and zero/negative sizes during a panel collapse — so they are
// regressions worth catching, not synthetic inputs.

describe('rectToBounds', () => {
  it('passes through integer bounds unchanged', () => {
    expect(rectToBounds({ x: 10, y: 20, width: 300, height: 400 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400
    })
  })

  it('rounds fractional pixels to the nearest whole DIP', () => {
    expect(rectToBounds({ x: 10.4, y: 20.6, width: 299.5, height: 400.49 })).toEqual({
      x: 10,
      y: 21,
      width: 300,
      height: 400
    })
  })

  it('clamps a negative width/height to zero (mid-collapse)', () => {
    expect(rectToBounds({ x: 5, y: 5, width: -12, height: -1 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0
    })
  })

  it('treats a zero-size rect as a zero-size (invisible) view', () => {
    expect(rectToBounds({ x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
  })

  it('preserves negative x/y (region offset) without clamping', () => {
    // x/y are positions, not sizes: a negative offset is legitimate and must
    // survive so the view tracks a region scrolled/positioned above-left.
    expect(rectToBounds({ x: -8, y: -3, width: 100, height: 100 })).toEqual({
      x: -8,
      y: -3,
      width: 100,
      height: 100
    })
  })

  it('collapses NaN and Infinity to zero rather than propagating garbage', () => {
    expect(rectToBounds({ x: Number.NaN, y: 5, width: Infinity, height: 50 })).toEqual({
      x: 0,
      y: 5,
      width: 0,
      height: 50
    })
  })
})

describe('boundsEqual', () => {
  it('is true for identical bounds', () => {
    expect(
      boundsEqual({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })
    ).toBe(true)
  })

  it('is false when any field differs', () => {
    const base = { x: 1, y: 2, width: 3, height: 4 }
    expect(boundsEqual(base, { ...base, x: 9 })).toBe(false)
    expect(boundsEqual(base, { ...base, y: 9 })).toBe(false)
    expect(boundsEqual(base, { ...base, width: 9 })).toBe(false)
    expect(boundsEqual(base, { ...base, height: 9 })).toBe(false)
  })
})
