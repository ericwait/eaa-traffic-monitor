import { describe, it, expect } from 'vitest'
import {
  buildDefaultTree,
  clampSizesToMinPx,
  computeLayoutRects,
  type LeafRectResult,
  type Rect,
  type SplitterRectResult
} from '@shared/panelLayout'

// Guardian tests for the guillotine-partition geometry (computeLayoutRects)
// and the splitter min-px clamp helper — the pure math PanelCanvas (PR2) will
// drive directly into absolutely-positioned DOM rects. The load-bearing
// property under test throughout is PARTITION EXACTNESS: leaves plus
// splitters must tile the container with no gaps and no overlaps, to the
// pixel, for any tree shape.

function rectArea(rect: Rect): number {
  return rect.width * rect.height
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  const noOverlapX = a.x + a.width <= b.x || b.x + b.width <= a.x
  const noOverlapY = a.y + a.height <= b.y || b.y + b.height <= a.y
  return !(noOverlapX || noOverlapY)
}

/** Every rect pairwise non-overlapping, and their total area exactly the container's — the two facts that together prove exact tiling for a guillotine partition. */
function assertExactTiling(
  container: Rect,
  leaves: LeafRectResult[],
  splitters: SplitterRectResult[]
): void {
  const rects = [...leaves.map((l) => l.rect), ...splitters.map((s) => s.rect)]
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(rectsOverlap(rects[i], rects[j])).toBe(false)
    }
  }
  const totalArea = rects.reduce((sum, r) => sum + rectArea(r), 0)
  expect(totalArea).toBe(rectArea(container))
}

describe('computeLayoutRects', () => {
  const container: Rect = { x: 0, y: 0, width: 1000, height: 500 }

  it('a null tree yields no leaves and no splitters', () => {
    expect(computeLayoutRects(null, container)).toEqual({ leaves: [], splitters: [] })
  })

  it('a bare leaf takes the whole container, no splitters', () => {
    const result = computeLayoutRects({ type: 'leaf', id: 'fr24' }, container)
    expect(result.leaves).toEqual([{ id: 'fr24', rect: container }])
    expect(result.splitters).toEqual([])
  })

  it('a 2-child horizontal split tiles exactly, splitter sized and positioned between the leaves', () => {
    const tree = {
      type: 'split' as const,
      id: 'root',
      orientation: 'horizontal' as const,
      children: [
        { type: 'leaf' as const, id: 'audio' as const },
        { type: 'leaf' as const, id: 'fr24' as const }
      ],
      sizes: [30, 70]
    }
    const result = computeLayoutRects(tree, container, 10)
    assertExactTiling(container, result.leaves, result.splitters)

    expect(result.leaves).toHaveLength(2)
    expect(result.splitters).toHaveLength(1)
    const [audio, fr24] = result.leaves
    const [splitter] = result.splitters

    // Full-height cross-axis, and the splitter sits exactly between the two leaves.
    expect(audio.rect.y).toBe(0)
    expect(audio.rect.height).toBe(500)
    expect(audio.rect.x).toBe(0)
    expect(splitter.rect.x).toBe(audio.rect.x + audio.rect.width)
    expect(splitter.rect.width).toBe(10)
    expect(splitter.rect.height).toBe(500)
    expect(fr24.rect.x).toBe(splitter.rect.x + splitter.rect.width)
    expect(fr24.rect.x + fr24.rect.width).toBe(1000) // reaches the container's far edge exactly

    expect(splitter.splitId).toBe('root')
    expect(splitter.index).toBe(0)
    expect(splitter.orientation).toBe('horizontal')
  })

  it('a vertical split stacks top to bottom with a horizontal-thickness splitter', () => {
    const tree = {
      type: 'split' as const,
      id: 'rows',
      orientation: 'vertical' as const,
      children: [
        { type: 'leaf' as const, id: 'fr24' as const },
        { type: 'leaf' as const, id: 'weather' as const }
      ],
      sizes: [62, 38]
    }
    const result = computeLayoutRects(tree, container, 8)
    assertExactTiling(container, result.leaves, result.splitters)

    const [top, bottom] = result.leaves
    expect(top.rect.x).toBe(0)
    expect(top.rect.width).toBe(1000)
    expect(bottom.rect.y).toBe(top.rect.y + top.rect.height + 8)
    expect(bottom.rect.y + bottom.rect.height).toBe(500)
  })

  it('a 3+ way split places every splitter between its neighbors, and every rect tiles exactly', () => {
    const tree = {
      type: 'split' as const,
      id: 'row',
      orientation: 'horizontal' as const,
      children: [
        { type: 'leaf' as const, id: 'video:a' as const },
        { type: 'leaf' as const, id: 'video:b' as const },
        { type: 'leaf' as const, id: 'video:c' as const }
      ],
      sizes: [34, 33, 33]
    }
    const result = computeLayoutRects(tree, container, 6)
    assertExactTiling(container, result.leaves, result.splitters)
    expect(result.leaves).toHaveLength(3)
    expect(result.splitters).toHaveLength(2)
    expect(result.splitters.map((s) => s.index)).toEqual([0, 1])
  })

  it('a full nested tree (buildDefaultTree, 7 feeds) still tiles exactly', () => {
    const feeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const tree = buildDefaultTree(feeds)
    const result = computeLayoutRects(tree, container, 6)
    assertExactTiling(container, result.leaves, result.splitters)
    expect(result.leaves.map((l) => l.id).sort()).toEqual(
      ['audio', 'weather', 'fr24', ...feeds.map((f) => `video:${f}`)].sort()
    )
  })

  it('is stable under an odd container size (rounding never leaves a gap or an overlap)', () => {
    const oddContainer: Rect = { x: 3, y: 7, width: 777, height: 333 }
    const tree = {
      type: 'split' as const,
      id: 'row',
      orientation: 'horizontal' as const,
      children: [
        { type: 'leaf' as const, id: 'audio' as const },
        { type: 'leaf' as const, id: 'weather' as const },
        { type: 'leaf' as const, id: 'fr24' as const }
      ],
      sizes: [33.333, 33.333, 33.334]
    }
    const result = computeLayoutRects(tree, oddContainer, 6)
    assertExactTiling(oddContainer, result.leaves, result.splitters)
  })

  it('uses the default splitter thickness when none is given', () => {
    const tree = {
      type: 'split' as const,
      id: 'root',
      orientation: 'horizontal' as const,
      children: [
        { type: 'leaf' as const, id: 'audio' as const },
        { type: 'leaf' as const, id: 'fr24' as const }
      ],
      sizes: [50, 50]
    }
    const result = computeLayoutRects(tree, container)
    expect(result.splitters[0].rect.width).toBeGreaterThan(0)
    assertExactTiling(container, result.leaves, result.splitters)
  })
})

describe('clampSizesToMinPx', () => {
  it('leaves sizes alone when every child already clears the floor', () => {
    const result = clampSizesToMinPx([50, 50], 1000, 100) // 100px floor = 10% each, both already at 50%
    expect(result[0]).toBeCloseTo(50, 3)
    expect(result[1]).toBeCloseTo(50, 3)
  })

  it('raises an undersized child to the px floor, shrinking the others proportionally', () => {
    const result = clampSizesToMinPx([90, 10], 1000, 200) // 200px floor = 20%
    const minPct = 20
    expect(result[1]).toBeGreaterThanOrEqual(minPct - 0.5)
    expect(result[0] + result[1]).toBeCloseTo(100, 3)
  })

  it('clears the floor for every child simultaneously when several are undersized', () => {
    const result = clampSizesToMinPx([80, 10, 10], 1000, 150) // 150px floor = 15% each
    for (const pct of result) expect(pct).toBeGreaterThanOrEqual(15 - 0.5)
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3)
  })

  it('falls back to an equal split when the requested minimums cannot possibly fit', () => {
    const result = clampSizesToMinPx([50, 50], 1000, 600) // 600px floor x2 > 1000px total
    expect(result[0]).toBeCloseTo(50, 5)
    expect(result[1]).toBeCloseTo(50, 5)
  })

  it('is zero-safe for a non-positive totalPx', () => {
    expect(clampSizesToMinPx([50, 50], 0, 100)).toEqual([50, 50])
  })

  it('handles an empty sizes array', () => {
    expect(clampSizesToMinPx([], 1000, 100)).toEqual([])
  })
})
