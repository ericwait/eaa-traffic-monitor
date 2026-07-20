import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  collectLeafIds,
  computeLayoutRects,
  type LayoutNode,
  type LayoutSplit,
  type PanelId,
  type Rect
} from '@shared/panelLayout'
import { useAppStore } from '../state/store'
import { canvasRenderOrder } from './canvasRenderOrder'
import { panelKind } from './panelMeta'
import LeafFrame from './LeafFrame'
import Splitter from './Splitter'

// The single-container panel canvas (docs/Panel-System-Plan.md's
// Architecture section): one absolutely-positioned region hosting every open
// panel as a stable-keyed sibling, placed purely by inline style from
// `computeLayoutRects`. See the render-order comment below — it is the single
// most important invariant in this file.

/** Reserved layout gap AND visual thickness for every splitter (matches today's 6px `.separator-*` look). The Splitter component enlarges its own INTERACTIVE hit area beyond this without changing the reserved/visual size. */
const SPLITTER_PX = 6

/** Per-panel-kind minimum px floor for a splitter drag (docs/Panel-System-Plan.md § Key interactions § Splitter drag). A split's own floor is the max across its direct children (a nested split, e.g. a video grid row, uses the video floor). */
const LEAF_MIN_PX: Record<ReturnType<typeof panelKind>, number> = {
  audio: 200,
  fr24: 200,
  weather: 160,
  video: 120
}

function minPxForNode(node: LayoutNode): number {
  return node.type === 'leaf' ? LEAF_MIN_PX[panelKind(node.id)] : LEAF_MIN_PX.video
}

/**
 * Apply an in-progress (uncommitted) splitter drag's sizes over `tree`, purely
 * for THIS render — the store only ever sees the settled, committed sizes
 * (Splitter's onCommit). A no-op (same reference) once no split has a live
 * override, so a render between drags costs nothing extra.
 */
function withEphemeralSizes(tree: LayoutNode, ephemeral: Record<string, number[]>): LayoutNode {
  if (Object.keys(ephemeral).length === 0) return tree

  function walk(node: LayoutNode): LayoutNode {
    if (node.type === 'leaf') return node
    const children = node.children.map(walk)
    const overriddenSizes = ephemeral[node.id]
    const childrenChanged = children.some((c, i) => c !== node.children[i])
    if (overriddenSizes === undefined && !childrenChanged) return node
    return { ...node, children, sizes: overriddenSizes ?? node.sizes }
  }

  return walk(tree)
}

interface SplitMeta {
  node: LayoutSplit
  availablePx: number
  minPx: number
}

/**
 * One walk of `tree` collecting every split node's own bounding rect (derived
 * from its descendant leaves' rects) and the derived drag inputs Splitter
 * needs. This is topology-only bookkeeping, not pixel math of its own: because
 * `computeLayoutRects` produces an exact guillotine partition (leaves +
 * splitters tile the container with no gaps/overlaps, see
 * tests/unit/layoutRects.test.ts), the axis-aligned bounding box of any split
 * node's descendant LEAVES is exactly that split's own occupied rect — so
 * this can never drift from computeLayoutRects' own rounding.
 */
function collectSplitMeta(
  tree: LayoutNode,
  leafRectById: ReadonlyMap<PanelId, Rect>,
  splitterPx: number
): Map<string, SplitMeta> {
  const out = new Map<string, SplitMeta>()

  function boundingRect(ids: PanelId[]): Rect {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of ids) {
      const r = leafRectById.get(id)
      if (!r) continue
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.width)
      maxY = Math.max(maxY, r.y + r.height)
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  function walk(node: LayoutNode): void {
    if (node.type === 'leaf') return
    const rect = boundingRect(collectLeafIds(node))
    const mainAxisSize = node.orientation === 'horizontal' ? rect.width : rect.height
    const gapTotal = splitterPx * Math.max(0, node.children.length - 1)
    const availablePx = Math.max(0, mainAxisSize - gapTotal)
    const minPx = Math.max(...node.children.map(minPxForNode))
    out.set(node.id, { node, availablePx, minPx })
    for (const child of node.children) walk(child)
  }

  walk(tree)
  return out
}

function PanelCanvas(): React.JSX.Element {
  const panelTree = useAppStore((s) => s.panelTree)
  const maximizedPanelId = useAppStore((s) => s.maximizedPanelId)
  const updateSplitSizesAction = useAppStore((s) => s.updateSplitSizes)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [ephemeralSizes, setEphemeralSizes] = useState<Record<string, number[]>>({})

  // Layout effect (not a plain effect) so the very first paint already has a
  // real measured size — a `useEffect` here would let one 0x0 frame through
  // before the ResizeObserver's first callback lands.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const initial = el.getBoundingClientRect()
    setSize({ width: initial.width, height: initial.height })
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const effectiveTree = useMemo(
    () => withEphemeralSizes(panelTree, ephemeralSizes),
    [panelTree, ephemeralSizes]
  )

  const containerRect: Rect = useMemo(
    () => ({ x: 0, y: 0, width: size.width, height: size.height }),
    [size.width, size.height]
  )

  const { leaves, splitters } = useMemo(
    () => computeLayoutRects(effectiveTree, containerRect, SPLITTER_PX),
    [effectiveTree, containerRect]
  )

  const leafRectById = useMemo(() => new Map(leaves.map((l) => [l.id, l.rect])), [leaves])
  const splitMeta = useMemo(
    () => collectSplitMeta(effectiveTree, leafRectById, SPLITTER_PX),
    [effectiveTree, leafRectById]
  )

  // A stale maximizedPanelId (a leaf closed while maximized — defensively
  // guarded against even though closePanel already clears it) must never hide
  // every other leaf; only apply maximize when the target still exists.
  const maximizedTarget =
    maximizedPanelId !== null && leafRectById.has(maximizedPanelId) ? maximizedPanelId : null

  const handleSplitterLiveChange =
    (splitId: string) =>
    (sizes: number[]): void => {
      setEphemeralSizes((prev) => ({ ...prev, [splitId]: sizes }))
    }

  const handleSplitterCommit =
    (splitId: string) =>
    (sizes: number[]): void => {
      setEphemeralSizes((prev) => {
        if (!(splitId in prev)) return prev
        const rest = { ...prev }
        delete rest[splitId]
        return rest
      })
      updateSplitSizesAction(splitId, sizes)
    }

  // -------------------------------------------------------------------------
  // LOAD-BEARING INVARIANT (decision 2026-07-19, docs/Panel-System-Plan.md's
  // Architecture section): leaves render as stable-keyed siblings in FIXED,
  // ID-SORTED DOM ORDER — `canvasRenderOrder`, and ONLY `canvasRenderOrder,
  // decides that order. NEVER key/order this list by tree position or by the
  // `leaves`/`splitters` arrays' own (traversal) order. Visual placement is
  // entirely style-only (the rects computed above). Violating this lets React
  // reorder DOM nodes (`insertBefore`) on a drag/snap-switch/maximize, which
  // reloads every embedded video <iframe> among them — see
  // tests/unit/canvasRenderOrder.test.ts, the guardian test for exactly this.
  // -------------------------------------------------------------------------
  const renderOrder = canvasRenderOrder(panelTree)

  return (
    <div className="panel-canvas" ref={containerRef}>
      {renderOrder.map((id) => {
        const rect = leafRectById.get(id)
        if (!rect) return null // defensive: tree/rects momentarily out of step across a render (should not happen)
        const isMaximizedTarget = maximizedTarget === id
        const hidden = maximizedTarget !== null && !isMaximizedTarget
        const effectiveRect = isMaximizedTarget ? containerRect : rect
        return (
          <LeafFrame
            key={id}
            panelId={id}
            rect={effectiveRect}
            hidden={hidden}
            isMaximized={isMaximizedTarget}
          />
        )
      })}

      {maximizedTarget === null &&
        splitters.map((s) => {
          const meta = splitMeta.get(s.splitId)
          if (!meta) return null
          return (
            <Splitter
              key={`${s.splitId}-${s.index}`}
              splitId={s.splitId}
              index={s.index}
              orientation={s.orientation}
              rect={s.rect}
              sizes={meta.node.sizes}
              availablePx={meta.availablePx}
              minPx={meta.minPx}
              onLiveChange={handleSplitterLiveChange(s.splitId)}
              onCommit={handleSplitterCommit(s.splitId)}
            />
          )
        })}
    </div>
  )
}

export default PanelCanvas
