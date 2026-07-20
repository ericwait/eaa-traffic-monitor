// Pure drag/drop hit-testing for the panel canvas's header-drag-to-dock
// interaction (docs/Panel-System-Plan.md § Key interactions § Header
// drag-to-dock). No DOM: every function takes plain rects/points computed
// elsewhere (`computeLayoutRects` for the leaves, the container's own rect for
// root docking) so this is fully vitest-importable via the `@renderer` alias
// and has no dependency on `elementFromPoint` or any live layout.
//
// `DropTarget`/`DropZone`/`RootEdge` are defined in @shared/panelLayout (not
// here) because `movePanel` consumes the same vocabulary this module produces
// — see that module's header comment for why the type lives shared-side.

import type { DropTarget, DropZone, PanelId, Rect, RootEdge } from '@shared/panelLayout'

export interface Point {
  x: number
  y: number
}

/** One leaf's computed rect, as returned by `computeLayoutRects`'s `leaves` array. */
export interface LeafRectInput {
  id: PanelId
  rect: Rect
}

/** Pointer within this many px of the whole canvas's outer edge docks against the ROOT rather than the panel underneath it. */
const ROOT_EDGE_PX = 24
/** The middle box of a panel — the drop swaps instead of splitting inside this fraction of the panel's width/height, centered. */
const CENTER_ZONE_FRACTION = 0.4
/** The current target sticks until the pointer leaves its highlight rect grown by this many px (avoids flicker between two adjacent zones). */
const HYSTERESIS_MARGIN_PX = 8

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function expandRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2
  }
}

function nearestRootEdge(point: Point, rootRect: Rect): RootEdge | null {
  const distLeft = point.x - rootRect.x
  const distRight = rootRect.x + rootRect.width - point.x
  const distTop = point.y - rootRect.y
  const distBottom = rootRect.y + rootRect.height - point.y
  const min = Math.min(distLeft, distRight, distTop, distBottom)
  if (min > ROOT_EDGE_PX) return null
  if (min === distLeft) return 'left'
  if (min === distRight) return 'right'
  if (min === distTop) return 'top'
  return 'bottom'
}

function zoneWithinRect(point: Point, rect: Rect): DropZone {
  const relX = rect.width === 0 ? 0.5 : (point.x - rect.x) / rect.width
  const relY = rect.height === 0 ? 0.5 : (point.y - rect.y) / rect.height
  const lo = (1 - CENTER_ZONE_FRACTION) / 2
  const hi = 1 - lo
  if (relX >= lo && relX <= hi && relY >= lo && relY <= hi) return 'center'

  const distLeft = relX
  const distRight = 1 - relX
  const distTop = relY
  const distBottom = 1 - relY
  const min = Math.min(distLeft, distRight, distTop, distBottom)
  if (min === distLeft) return 'left'
  if (min === distRight) return 'right'
  if (min === distTop) return 'top'
  return 'bottom'
}

/**
 * What `point` is over: a root-edge dock (within `ROOT_EDGE_PX` of the whole
 * canvas's boundary, checked FIRST since the outermost leaves also line that
 * boundary), else the leaf whose rect contains it (with a zone — the center
 * 40% box swaps, else the nearest edge splits), else `null` (point is outside
 * every known rect — shouldn't happen once leaves tile the container, but is
 * not an error).
 */
export function hitTestDropZone(
  point: Point,
  leafRects: readonly LeafRectInput[],
  rootRect: Rect
): DropTarget | null {
  const rootEdge = nearestRootEdge(point, rootRect)
  if (rootEdge) return { kind: 'root', edge: rootEdge }

  const leaf = leafRects.find((l) => pointInRect(point, l.rect))
  if (!leaf) return null

  return { kind: 'panel', targetId: leaf.id, zone: zoneWithinRect(point, leaf.rect) }
}

/** The rect to paint as the drop-preview highlight for `target`, or `null` if its panel/edge can no longer be resolved (e.g. a stale target after the tree changed mid-drag). */
export function dropHighlightRect(
  target: DropTarget,
  leafRects: readonly LeafRectInput[],
  rootRect: Rect
): Rect | null {
  if (target.kind === 'root') {
    const share = 0.25
    const { edge } = target
    if (edge === 'left') {
      return {
        x: rootRect.x,
        y: rootRect.y,
        width: rootRect.width * share,
        height: rootRect.height
      }
    }
    if (edge === 'right') {
      return {
        x: rootRect.x + rootRect.width * (1 - share),
        y: rootRect.y,
        width: rootRect.width * share,
        height: rootRect.height
      }
    }
    if (edge === 'top') {
      return {
        x: rootRect.x,
        y: rootRect.y,
        width: rootRect.width,
        height: rootRect.height * share
      }
    }
    return {
      x: rootRect.x,
      y: rootRect.y + rootRect.height * (1 - share),
      width: rootRect.width,
      height: rootRect.height * share
    }
  }

  const leaf = leafRects.find((l) => l.id === target.targetId)
  if (!leaf) return null
  const { rect } = leaf
  const { zone } = target
  if (zone === 'center') return rect
  if (zone === 'left') return { x: rect.x, y: rect.y, width: rect.width / 2, height: rect.height }
  if (zone === 'right')
    return { x: rect.x + rect.width / 2, y: rect.y, width: rect.width / 2, height: rect.height }
  if (zone === 'top') return { x: rect.x, y: rect.y, width: rect.width, height: rect.height / 2 }
  return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width, height: rect.height / 2 }
}

/**
 * Sticky re-evaluation of the drop target: while `point` stays within
 * `previousTarget`'s highlight rect grown by `HYSTERESIS_MARGIN_PX`, keep
 * returning `previousTarget` unchanged (even if a fresh hit-test would now
 * resolve slightly differently) — this is what keeps the highlight from
 * flickering between two adjacent zones near a boundary. Once the pointer
 * truly leaves that margin, re-resolves via `hitTestDropZone`.
 */
export function withHysteresis(
  point: Point,
  previousTarget: DropTarget | null,
  leafRects: readonly LeafRectInput[],
  rootRect: Rect,
  margin: number = HYSTERESIS_MARGIN_PX
): DropTarget | null {
  if (previousTarget) {
    const highlight = dropHighlightRect(previousTarget, leafRects, rootRect)
    if (highlight && pointInRect(point, expandRect(highlight, margin))) {
      return previousTarget
    }
  }
  return hitTestDropZone(point, leafRects, rootRect)
}
