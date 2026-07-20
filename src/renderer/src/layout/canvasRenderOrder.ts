import { collectLeafIds, type LayoutNode, type PanelId } from '@shared/panelLayout'

// (decision 2026-07-19) LOAD-BEARING INVARIANT: panel leaves render in this
// fixed, id-SORTED DOM order, NEVER in tree/traversal order. Visual placement
// is entirely style-only — see PanelCanvas.tsx, which positions every leaf via
// `computeLayoutRects` and renders leaves in exactly the order this function
// returns, regardless of where they sit in the tree. Sorting by id is safe
// specifically because a panel's id never changes when it MOVES (only tree
// position changes on a move/resize/snap-switch) — it only changes when a
// panel OPENS or CLOSES, which is precisely when a DOM node should mount/
// unmount anyway. A caller that instead keys a rendered list by tree position
// and lets React reorder DOM nodes (`insertBefore`) forces every embedded
// video <iframe> among them to reload — see docs/Panel-System-Plan.md's
// Architecture section and this function's guardian test
// (tests/unit/canvasRenderOrder.test.ts, which asserts the returned order is
// identical across differently-arranged trees over the same leaf set).
export function canvasRenderOrder(tree: LayoutNode | null): PanelId[] {
  return collectLeafIds(tree).slice().sort()
}
