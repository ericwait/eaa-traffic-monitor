import { describe, it, expect } from 'vitest'
import {
  dropHighlightRect,
  hitTestDropZone,
  withHysteresis,
  type LeafRectInput
} from '@renderer/layout/dropZones'
import type { Rect } from '@shared/panelLayout'

// Guardian tests for the header-drag hit-testing (docs/Panel-System-Plan.md §
// Key interactions § Header drag-to-dock): the panel-center swap box, the
// nearest-edge split zones, root-edge docking (checked FIRST, since the
// outermost leaves also line the canvas boundary), and the hysteresis that
// keeps the highlight from flickering near a zone boundary.

const rootRect: Rect = { x: 0, y: 0, width: 1000, height: 600 }
const leftLeaf: LeafRectInput = { id: 'audio', rect: { x: 0, y: 0, width: 300, height: 600 } }
const rightLeaf: LeafRectInput = { id: 'fr24', rect: { x: 300, y: 0, width: 700, height: 600 } }
const leafRects: LeafRectInput[] = [leftLeaf, rightLeaf]

describe('hitTestDropZone — root edges (checked first)', () => {
  it.each([
    [{ x: 5, y: 300 }, 'left'],
    [{ x: 995, y: 300 }, 'right'],
    [{ x: 500, y: 5 }, 'top'],
    [{ x: 500, y: 595 }, 'bottom']
  ] as const)('a point within 24px of the %s root edge docks there', (point, edge) => {
    expect(hitTestDropZone(point, leafRects, rootRect)).toEqual({ kind: 'root', edge })
  })

  it('root-edge proximity wins even though the point also sits inside a leaf', () => {
    // (5, 300) is well within leftLeaf's rect too, but the root edge takes priority.
    expect(hitTestDropZone({ x: 5, y: 300 }, leafRects, rootRect)).toEqual({
      kind: 'root',
      edge: 'left'
    })
  })

  it('a point just past the 24px threshold falls through to the panel underneath instead', () => {
    const result = hitTestDropZone({ x: 30, y: 300 }, leafRects, rootRect)
    expect(result).toMatchObject({ kind: 'panel', targetId: 'audio' })
  })
})

describe('hitTestDropZone — panel zones', () => {
  it('the center 40% box swaps', () => {
    // rightLeaf spans x:300..1000, y:0..600 — its center is (650, 300).
    expect(hitTestDropZone({ x: 650, y: 300 }, leafRects, rootRect)).toEqual({
      kind: 'panel',
      targetId: 'fr24',
      zone: 'center'
    })
  })

  it("a point near the panel's left edge (but not the root edge) splits left", () => {
    // relX = 0.05 within rightLeaf, far from every root edge.
    expect(hitTestDropZone({ x: 335, y: 300 }, leafRects, rootRect)).toEqual({
      kind: 'panel',
      targetId: 'fr24',
      zone: 'left'
    })
  })

  it("a point near the panel's top edge splits top", () => {
    expect(hitTestDropZone({ x: 650, y: 40 }, leafRects, rootRect)).toEqual({
      kind: 'panel',
      targetId: 'fr24',
      zone: 'top'
    })
  })

  it("a point near the panel's bottom edge splits bottom", () => {
    expect(hitTestDropZone({ x: 650, y: 560 }, leafRects, rootRect)).toEqual({
      kind: 'panel',
      targetId: 'fr24',
      zone: 'bottom'
    })
  })

  it('null when the point is outside every known leaf rect and every root edge', () => {
    // Only leftLeaf is provided; (650, 300) falls in the (deliberately) uncovered gap.
    expect(hitTestDropZone({ x: 650, y: 300 }, [leftLeaf], rootRect)).toBeNull()
  })
})

describe('dropHighlightRect', () => {
  it('a root-edge target highlights a 25% strip along that edge', () => {
    expect(dropHighlightRect({ kind: 'root', edge: 'left' }, leafRects, rootRect)).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 600
    })
    expect(dropHighlightRect({ kind: 'root', edge: 'bottom' }, leafRects, rootRect)).toEqual({
      x: 0,
      y: 450,
      width: 1000,
      height: 150
    })
  })

  it('a center-zone target highlights the whole panel rect', () => {
    expect(
      dropHighlightRect({ kind: 'panel', targetId: 'fr24', zone: 'center' }, leafRects, rootRect)
    ).toEqual(rightLeaf.rect)
  })

  it('an edge-zone target highlights the corresponding half of the panel', () => {
    expect(
      dropHighlightRect({ kind: 'panel', targetId: 'audio', zone: 'right' }, leafRects, rootRect)
    ).toEqual({
      x: 150,
      y: 0,
      width: 150,
      height: 600
    })
  })

  it('null for a stale target whose panel id is no longer in leafRects', () => {
    expect(
      dropHighlightRect({ kind: 'panel', targetId: 'weather', zone: 'center' }, leafRects, rootRect)
    ).toBeNull()
  })
})

describe('withHysteresis', () => {
  it('with no previous target, behaves exactly like a fresh hitTestDropZone', () => {
    expect(withHysteresis({ x: 650, y: 300 }, null, leafRects, rootRect)).toEqual(
      hitTestDropZone({ x: 650, y: 300 }, leafRects, rootRect)
    )
  })

  it('sticks to the previous target while the pointer stays within its highlight + margin', () => {
    const previous = { kind: 'panel' as const, targetId: 'fr24' as const, zone: 'center' as const }
    // rightLeaf's center-zone highlight IS the whole leaf rect (300..1000), so a
    // point just outside it (305) but within the 8px margin should still stick.
    const stuck = withHysteresis({ x: 302, y: 300 }, previous, leafRects, rootRect)
    expect(stuck).toBe(previous)
  })

  it('re-resolves once the pointer truly leaves the highlight + margin', () => {
    const previous = { kind: 'panel' as const, targetId: 'audio' as const, zone: 'right' as const }
    // audio's 'right' highlight is x:150..300; far outside (650) must drop the stick.
    const resolved = withHysteresis({ x: 650, y: 300 }, previous, leafRects, rootRect)
    expect(resolved).not.toBe(previous)
    expect(resolved).toEqual({ kind: 'panel', targetId: 'fr24', zone: 'center' })
  })

  it('re-resolves via a fresh hit test when the previous target no longer highlights anywhere (stale panel id)', () => {
    const previous = {
      kind: 'panel' as const,
      targetId: 'weather' as const,
      zone: 'center' as const
    }
    const resolved = withHysteresis({ x: 650, y: 300 }, previous, leafRects, rootRect)
    expect(resolved).toEqual({ kind: 'panel', targetId: 'fr24', zone: 'center' })
  })

  it('honors a custom margin override', () => {
    const previous = { kind: 'panel' as const, targetId: 'audio' as const, zone: 'right' as const }
    // Just 2px outside the highlight — sticks with a generous margin, but not with margin 0.
    expect(withHysteresis({ x: 302, y: 300 }, previous, leafRects, rootRect, 10)).toBe(previous)
    expect(withHysteresis({ x: 302, y: 300 }, previous, leafRects, rootRect, 0)).not.toBe(previous)
  })
})
