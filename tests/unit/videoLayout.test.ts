import { describe, it, expect } from 'vitest'
import { computeVideoLayout } from '@renderer/youtube/layout'

// Guardian tests for the video grid's pure layout math — the uniform
// ceil(sqrt(n)) column count and the emphasized 2x2-plus-rail area matrix.
// These are the same edge cases the grid actually hits at runtime: 1..9 feeds
// (today's scrape landed on 7), a null emphasized index (uniform mode), and a
// stale/out-of-range emphasized index (a feed removed from config while it
// was the emphasized one).

describe('computeVideoLayout — uniform mode (emphasizedIndex null)', () => {
  it('lays out 0 feeds without throwing', () => {
    const layout = computeVideoLayout(0, null)
    expect(layout.mode).toBe('uniform')
    expect(layout.gridTemplateColumns).toBe('repeat(1, 1fr)')
    expect(layout.gridTemplateRows).toBe('repeat(1, 1fr)')
  })

  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 3, 3],
    [8, 3, 3],
    [9, 3, 3]
  ])('n=%i uses %i columns and %i rows (ceil(sqrt(n)))', (n, cols, rows) => {
    const layout = computeVideoLayout(n, null)
    expect(layout.mode).toBe('uniform')
    expect(layout.gridTemplateColumns).toBe(`repeat(${cols}, 1fr)`)
    expect(layout.gridTemplateRows).toBe(`repeat(${rows}, 1fr)`)
  })

  it('sets no grid-template-areas and no tile area for any index', () => {
    const layout = computeVideoLayout(6, null)
    expect(layout.gridTemplateAreas).toBeUndefined()
    for (let i = 0; i < 6; i++) {
      expect(layout.tileArea(i)).toBeUndefined()
    }
  })

  it('a single feed is always uniform even if an emphasized index is requested', () => {
    // n <= 1 has nothing to emphasize against, so it degrades to uniform.
    const layout = computeVideoLayout(1, 0)
    expect(layout.mode).toBe('uniform')
    expect(layout.tileArea(0)).toBeUndefined()
  })

  it('treats negative and fractional counts as a caller bug, not a crash', () => {
    expect(computeVideoLayout(-3, null).mode).toBe('uniform')
    expect(computeVideoLayout(-3, null).gridTemplateColumns).toBe('repeat(1, 1fr)')
    expect(computeVideoLayout(4.9, null).gridTemplateColumns).toBe('repeat(2, 1fr)') // floors to 4
  })

  it('treats non-finite counts as zero', () => {
    const layout = computeVideoLayout(Number.NaN, null)
    expect(layout.gridTemplateColumns).toBe('repeat(1, 1fr)')
  })
})

describe('computeVideoLayout — emphasized mode', () => {
  it('emphasizes index 0 of 2 feeds: one big tile + a 1-tile rail', () => {
    const layout = computeVideoLayout(2, 0)
    expect(layout.mode).toBe('emphasized')
    expect(layout.gridTemplateColumns).toBe('2fr 2fr 1fr')
    expect(layout.gridTemplateRows).toBe('repeat(2, 1fr)')
    expect(layout.tileArea(0)).toBe('big')
    expect(layout.tileArea(1)).toBe('rail1')
    expect(layout.gridTemplateAreas).toBe('"big big rail1" "big big ."')
  })

  it('emphasizing a middle index still assigns the rest to the rail in DOM order', () => {
    const layout = computeVideoLayout(4, 2)
    expect(layout.mode).toBe('emphasized')
    expect(layout.tileArea(2)).toBe('big')
    expect(layout.tileArea(0)).toBe('rail0')
    expect(layout.tileArea(1)).toBe('rail1')
    expect(layout.tileArea(3)).toBe('rail3')
  })

  it('grows rows to fit every rail tile once there are more than 2 (n=9 case)', () => {
    const layout = computeVideoLayout(9, 0)
    expect(layout.mode).toBe('emphasized')
    // 8 rail tiles need 8 rows (more than the big tile's own 2-row span).
    expect(layout.gridTemplateRows).toBe('repeat(8, 1fr)')
    for (let i = 1; i < 9; i++) {
      expect(layout.tileArea(i)).toBe(`rail${i}`)
    }
    expect(layout.tileArea(0)).toBe('big')
  })

  it('a single rail tile (n=2) still reserves 2 rows for the big tile, second row empty in col 3', () => {
    const layout = computeVideoLayout(2, 0)
    // Row 1: big big rail1 ; Row 2: big big . (no second rail tile to place)
    expect(layout.gridTemplateAreas).toContain('"big big ."')
  })

  it('clamps a too-large emphasized index into range instead of crashing', () => {
    const layout = computeVideoLayout(5, 99)
    expect(layout.mode).toBe('emphasized')
    expect(layout.tileArea(4)).toBe('big') // clamped to n-1
  })

  it('clamps a negative emphasized index up to 0 instead of crashing', () => {
    const layout = computeVideoLayout(5, -7)
    expect(layout.mode).toBe('emphasized')
    expect(layout.tileArea(0)).toBe('big')
  })

  it('clamps a non-finite emphasized index to 0', () => {
    const layout = computeVideoLayout(5, Number.NaN)
    expect(layout.mode).toBe('emphasized')
    expect(layout.tileArea(0)).toBe('big')
  })
})
