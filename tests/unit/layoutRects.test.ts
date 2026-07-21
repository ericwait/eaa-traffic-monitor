import { describe, it, expect } from 'vitest'
import {
  buildDefaultTree,
  clampSizesToMinPx,
  clampTreeToMinPx,
  computeLayoutRects,
  type LayoutNode,
  type LeafRectResult,
  type PanelId,
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

// The render-time min-size floor (decision 2026-07-20). The load-bearing
// property throughout: after clamping, no leaf renders below its usable
// minimum px — the safety net that keeps a panel from ever collapsing into an
// ungrabbable sliver. Mirrors PanelCanvas's own LEAF_MIN_PX floors.
describe('clampTreeToMinPx', () => {
  const SPLITTER_PX = 6
  const FLOOR: Record<'audio' | 'weather' | 'fr24' | 'video', number> = {
    audio: 200,
    fr24: 200,
    weather: 160,
    video: 120
  }
  const minPxForLeaf = (id: PanelId): number => {
    if (id === 'audio') return FLOOR.audio
    if (id === 'weather') return FLOOR.weather
    if (id === 'fr24') return FLOOR.fr24
    return FLOOR.video
  }

  /** The main-axis span each leaf actually renders at, once the clamped tree is mapped onto `container`. */
  function renderedLeafWidths(tree: LayoutNode, container: Rect): Map<PanelId, Rect> {
    const clamped = clampTreeToMinPx(tree, container, minPxForLeaf, SPLITTER_PX)
    const { leaves } = computeLayoutRects(clamped, container, SPLITTER_PX)
    return new Map(leaves.map((l) => [l.id, l.rect]))
  }

  it('returns the same reference when every leaf already clears its floor', () => {
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'fr24' }
      ],
      sizes: [50, 50]
    }
    const container: Rect = { x: 0, y: 0, width: 2000, height: 800 }
    expect(clampTreeToMinPx(tree, container, minPxForLeaf, SPLITTER_PX)).toBe(tree)
  })

  it('raises a collapsed child back up to its px floor (the "shrunk to a sliver" case)', () => {
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'video:a' },
        { type: 'leaf', id: 'fr24' }
      ],
      sizes: [98, 2] // fr24 at 2% of ~2000px = ~40px, well under its 200px floor
    }
    const container: Rect = { x: 0, y: 0, width: 2000, height: 800 }
    const rects = renderedLeafWidths(tree, container)
    // fr24 is lifted to (essentially) its floor; a couple of px of rounding slack.
    expect(rects.get('fr24')!.width).toBeGreaterThanOrEqual(FLOOR.fr24 - 2)
    // video:a keeps the rest and stays comfortably above its own 120px floor.
    expect(rects.get('video:a')!.width).toBeGreaterThanOrEqual(FLOOR.video)
    const total = rects.get('fr24')!.width + rects.get('video:a')!.width
    expect(total).toBeLessThanOrEqual(container.width) // splitter gap accounts for the rest
  })

  it('holds a nested column to its widest leaf floor, not a flat leaf floor', () => {
    // A near-collapsed audio/weather column: measured across its own vertical
    // orientation, its width floor is max(audio 200, weather 160) = 200 — NOT
    // the 120 a bare video leaf would get.
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'video:a' },
        {
          type: 'split',
          id: 'col',
          orientation: 'vertical',
          children: [
            { type: 'leaf', id: 'audio' },
            { type: 'leaf', id: 'weather' }
          ],
          sizes: [50, 50]
        }
      ],
      sizes: [98, 2]
    }
    const container: Rect = { x: 0, y: 0, width: 2000, height: 800 }
    const rects = renderedLeafWidths(tree, container)
    // Both column leaves share the column's width, so each must be >= 200px wide.
    expect(rects.get('audio')!.width).toBeGreaterThanOrEqual(FLOOR.audio - 2)
    expect(rects.get('weather')!.width).toBeGreaterThanOrEqual(FLOOR.audio - 2)
  })

  it('enforces floors top-down: a deeply squeezed nested split still clears every leaf', () => {
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'video:big' },
        {
          type: 'split',
          id: 'col',
          orientation: 'vertical',
          children: [
            { type: 'leaf', id: 'audio' },
            { type: 'leaf', id: 'weather' }
          ],
          sizes: [95, 5] // weather collapsed within the column too
        }
      ],
      sizes: [95, 5] // whole column collapsed at the root
    }
    const container: Rect = { x: 0, y: 0, width: 2000, height: 900 }
    const rects = renderedLeafWidths(tree, container)
    expect(rects.get('audio')!.width).toBeGreaterThanOrEqual(FLOOR.audio - 2)
    expect(rects.get('audio')!.height).toBeGreaterThanOrEqual(FLOOR.audio - 2)
    expect(rects.get('weather')!.height).toBeGreaterThanOrEqual(FLOOR.weather - 2)
  })

  it('best-effort (proportional to need) when the floors cannot all fit, never throwing', () => {
    // Three 200px-floor panels in a 400px-wide container — 600px of floor can't
    // fit. Must degrade gracefully to shares proportional to need, summing 100.
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'fr24' },
        { type: 'leaf', id: 'weather' }
      ],
      sizes: [80, 10, 10]
    }
    const container: Rect = { x: 0, y: 0, width: 400, height: 800 }
    const clamped = clampTreeToMinPx(tree, container, minPxForLeaf, SPLITTER_PX)
    expect(clamped.type).toBe('split')
    if (clamped.type === 'split') {
      const sum = clamped.sizes.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(100, 3)
      for (const s of clamped.sizes) expect(s).toBeGreaterThan(0)
    }
  })

  it('is a no-op (same reference) at a zero-sized container — nothing to clamp against', () => {
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'fr24' }
      ],
      sizes: [50, 50]
    }
    const zero: Rect = { x: 0, y: 0, width: 0, height: 0 }
    expect(clampTreeToMinPx(tree, zero, minPxForLeaf, SPLITTER_PX)).toBe(tree)
  })

  it('leaves a bare leaf tree untouched', () => {
    const tree: LayoutNode = { type: 'leaf', id: 'fr24' }
    const container: Rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(clampTreeToMinPx(tree, container, minPxForLeaf, SPLITTER_PX)).toBe(tree)
  })
})
