import { describe, it, expect } from 'vitest'
import {
  buildDefaultTree,
  movePanel,
  swapPanels,
  type LayoutNode,
  type PanelId
} from '@shared/panelLayout'
import { canvasRenderOrder } from '@renderer/layout/canvasRenderOrder'

// The render-order guardian (docs/Panel-System-Plan.md's LOAD-BEARING
// INVARIANT #2, decision 2026-07-19): PanelCanvas renders leaves in fixed,
// id-sorted DOM order, NEVER by tree position, so that rearranging panels can
// never force React to reorder (and thus reload) an embedded video iframe.
// This suite proves `canvasRenderOrder` is ARRANGEMENT-INDEPENDENT: for a
// fixed leaf set, every tree shape that set can take yields the identical
// rendered order.

function feeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `feed-${i}`)
}

describe('canvasRenderOrder', () => {
  it('is empty for a null tree', () => {
    expect(canvasRenderOrder(null)).toEqual([])
  })

  it('sorts a bare leaf set alphabetically by id', () => {
    const tree = buildDefaultTree(['b', 'a', 'c'])
    expect(canvasRenderOrder(tree)).toEqual([
      'audio',
      'fr24',
      'video:a',
      'video:b',
      'video:c',
      'weather'
    ])
  })

  it('is identical for the default tree vs. a fully rearranged one over the same leaf set', () => {
    const defaultTree = buildDefaultTree(feeds(7))
    const defaultOrder = canvasRenderOrder(defaultTree)

    // Move every video leaf onto fr24's east edge, one at a time — a
    // drastically different tree SHAPE, but the exact same leaf SET.
    let rearranged: LayoutNode = defaultTree
    for (const id of feeds(7)) {
      rearranged = movePanel(rearranged, `video:${id}` as PanelId, {
        kind: 'panel',
        targetId: 'fr24',
        zone: 'right'
      })
    }
    expect(canvasRenderOrder(rearranged)).toEqual(defaultOrder)
  })

  it('is unaffected by swapping two leaves in place', () => {
    const tree = buildDefaultTree(feeds(3))
    const before = canvasRenderOrder(tree)
    const swapped = swapPanels(tree, 'audio', 'fr24')
    expect(canvasRenderOrder(swapped)).toEqual(before)
  })

  it('is unaffected by maximize-style single-leaf-vs-rest structural shuffles (root docking)', () => {
    const tree = buildDefaultTree(feeds(2))
    const before = canvasRenderOrder(tree)
    const docked = movePanel(tree, 'weather', { kind: 'root', edge: 'left' })
    expect(canvasRenderOrder(docked)).toEqual(before)
  })

  it('DOES change when the leaf set itself changes (open/close), which is the only time DOM should mount/unmount', () => {
    const tree = buildDefaultTree(feeds(2))
    const before = canvasRenderOrder(tree)
    const withThird = buildDefaultTree([...feeds(2), 'z'])
    expect(canvasRenderOrder(withThird)).not.toEqual(before)
    expect(canvasRenderOrder(withThird)).toContain('video:z')
  })
})
