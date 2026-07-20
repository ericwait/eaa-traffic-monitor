import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { DropTarget, PanelId, Rect } from '@shared/panelLayout'
import {
  dropHighlightRect,
  hitTestDropZone,
  withHysteresis,
  type LeafRectInput,
  type Point
} from './dropZones'
import { useAppStore } from '../state/store'

// The header drag-to-dock gesture (docs/Panel-System-Plan.md § Key
// interactions § Header drag-to-dock): pointerdown on a `.panel-head` (never
// on its own `.panel-head-actions` buttons, so the move/maximize/close/fit/
// pop-out chrome stays plain-clickable) with a 4px slop before a drag
// actually starts, `setPointerCapture` on the canvas container the instant it
// does, and hit-testing purely against the SAME leaf rects PanelCanvas already
// computed from the store's tree (`computeLayoutRects`) — NEVER
// `elementFromPoint`, which the live YouTube iframes and the FR24 native view
// would swallow (a captured pointer's own move/up events bypass hit-testing
// entirely, which is what makes this safe over them in the first place; the
// `pointer-events: none` PanelCanvas applies to video/iframe hosts while
// `dragPanelId` is set is belt-and-suspenders on top of that, per the plan).
//
// One event-delegation pointerdown/move/up/cancel listener set lives on
// `.panel-canvas` itself (wired by PanelCanvas.tsx) rather than one per header
// — AudioPanel/WeatherPanel/Fr24Panel/LeafFrame's video head each render their
// own `.panel-head`, so delegating up to the shared canvas ancestor is what
// lets this hook work across all four without touching each of them beyond
// the cosmetic `.panel-head--draggable`/`--dragging` class.
//
// Coordinate system: every point/rect this hook produces or consumes is
// VIEWPORT coordinates (clientX/clientY), NOT the canvas-local coordinates
// `computeLayoutRects` returns — `DragOverlay`'s `.drag-layer` is
// `position: fixed`, so its highlight/ghost must live in that same space.
// `leaves`/`rootRect` (canvas-local, as PanelCanvas computed them) are shifted
// into viewport space by `toViewport` on every pointer event, using the
// canvas container's OWN freshly-read `getBoundingClientRect()` — recomputed
// every time rather than cached at drag start, so even a (very unlikely)
// mid-drag window resize can never leave the overlay reading stale
// coordinates.
//
// `dragPanelId` (the store field) is the ONLY thing LayoutShell's consolidated
// FR24 visibility rule keys on for a drag; it is set the instant a drag
// actually starts (slop exceeded) and cleared by the SAME single `commitDrag`
// store write that applies the move on a successful drop — see
// docs/Panel-System-Plan.md § Store slice's single-writer sequencing, and
// state/store.ts's `commitDrag` doc comment.
//
// (decision 2026-07-20) Header drag-to-dock is custom pointer-event handling
// plus pure hit-testing (this file + dropZones.ts) — no drag-and-drop
// library and not the browser's native HTML5 Drag and Drop API, which has no
// way to hit-test against a live cross-origin iframe or a WebContentsView
// short of the same pointer-capture trick this file already uses, and adds
// its own ghost-image/dataTransfer machinery this app has no use for. The
// native "Move panel…" menu commands and the DOM Move-panel modal
// (MovePanelModal.tsx, landed in `feature/panel-menu-move`) remain the
// FR24-safe, keyboard-accessible, e2e-deterministic fallbacks for the exact
// same move — see docs/decisions/README.md.

/** Pixels of pointer movement past pointerdown before a "pending" gesture becomes a real drag (docs/Panel-System-Plan.md § Key interactions § Header drag-to-dock). Below this, a pointerdown+pointerup is left alone as a plain click/double-click (maximize). */
const SLOP_PX = 4

export interface HeaderDragState {
  draggedId: PanelId
  /** Current pointer position, VIEWPORT coordinates (`.drag-layer`'s own `position: fixed` space). */
  pointer: Point
  dropTarget: DropTarget | null
  /** `dropHighlightRect` resolved against the SAME viewport-space rects used for hit-testing this exact pointer sample — precomputed here (not in DragOverlay) so nothing downstream needs its own leaves/rootRect conversion. */
  highlightRect: Rect | null
}

export interface HeaderDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
}

type DragMachine =
  | { phase: 'pending'; panelId: PanelId; pointerId: number; startPoint: Point }
  | { phase: 'dragging'; panelId: PanelId; pointerId: number; dropTarget: DropTarget | null }

/**
 * The ancestor `.leaf-frame`'s panel id for a pointerdown that landed on its
 * `.panel-head`, or `null` if this event isn't a header-drag candidate at all
 * (not over a header, or over that header's own `.panel-head-actions`
 * buttons — move/maximize/close/fit/pop-out stay plain clicks, never a drag
 * source).
 */
function panelIdForHeaderPointerDown(target: EventTarget | null): PanelId | null {
  if (!(target instanceof Element)) return null
  if (target.closest('.panel-head-actions')) return null
  const head = target.closest('.panel-head')
  if (!head) return null
  const leaf = head.closest('.leaf-frame')
  const panelId = leaf instanceof HTMLElement ? leaf.dataset.panelId : undefined
  return panelId ? (panelId as PanelId) : null
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * `setPointerCapture` defensively: some pointer ids the browser doesn't
 * recognize as an actively-pressed pointer (e.g. a synthetically-dispatched
 * PointerEvent, as tests/e2e/panelDrag.spec.ts's pointer simulation and
 * tests/e2e/channels.spec.ts's own strip-drag simulation both use, per that
 * file's own comment on why `page.mouse` can't be used here) throw
 * `InvalidPointerId` rather than silently no-op. The drag state machine
 * itself only ever compares `pointerId` across events for gesture identity —
 * it does not depend on the OS-level capture actually taking effect to stay
 * correct — so a refusal here is safe to swallow rather than let it abort
 * the rest of this handler (which would otherwise leave `dragPanelId`/
 * `dragState` never set, breaking the whole gesture).
 */
function trySetPointerCapture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    /* see doc comment above */
  }
}

function tryReleasePointerCapture(el: Element, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
  } catch {
    /* see trySetPointerCapture's doc comment */
  }
}

export function useHeaderDrag(params: {
  containerRef: RefObject<HTMLDivElement | null>
  leaves: readonly LeafRectInput[]
  rootRect: Rect
}): { dragState: HeaderDragState | null; handlers: HeaderDragHandlers } {
  const { containerRef, leaves, rootRect } = params
  const setDragPanelId = useAppStore((s) => s.setDragPanelId)
  const commitDrag = useAppStore((s) => s.commitDrag)

  const machineRef = useRef<DragMachine | null>(null)
  const [dragState, setDragState] = useState<HeaderDragState | null>(null)

  /** Shift the canvas-local `leaves`/`rootRect` (as PanelCanvas computed them) into viewport coordinates via the container's current on-screen offset. */
  const toViewport = useCallback((): { leaves: LeafRectInput[]; rootRect: Rect } => {
    const el = containerRef.current
    const offset = el ? el.getBoundingClientRect() : { left: 0, top: 0 }
    const shift = (r: Rect): Rect => ({
      x: r.x + offset.left,
      y: r.y + offset.top,
      width: r.width,
      height: r.height
    })
    return {
      leaves: leaves.map((l) => ({ id: l.id, rect: shift(l.rect) })),
      rootRect: shift(rootRect)
    }
  }, [containerRef, leaves, rootRect])

  const resolveState = useCallback(
    (panelId: PanelId, pointer: Point, dropTarget: DropTarget | null): HeaderDragState => {
      const { leaves: vLeaves, rootRect: vRoot } = toViewport()
      const highlightRect = dropTarget ? dropHighlightRect(dropTarget, vLeaves, vRoot) : null
      return { draggedId: panelId, pointer, dropTarget, highlightRect }
    },
    [toViewport]
  )

  // Escape cancels a live drag from anywhere (mirrors LayoutShell's
  // maximize-Escape pattern) — no commit, the tree is untouched. Only
  // registered once a drag is actually visible (dragState non-null); the
  // pre-slop 'pending' phase has nothing to cancel yet.
  useEffect(() => {
    if (dragState === null) return undefined
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const m = machineRef.current
      const container = containerRef.current
      if (m && container) tryReleasePointerCapture(container, m.pointerId)
      machineRef.current = null
      setDragState(null)
      setDragPanelId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dragState, containerRef, setDragPanelId])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    if (machineRef.current) return // a gesture is already in flight for another pointer
    const panelId = panelIdForHeaderPointerDown(e.target)
    if (panelId === null) return
    machineRef.current = {
      phase: 'pending',
      panelId,
      pointerId: e.pointerId,
      startPoint: { x: e.clientX, y: e.clientY }
    }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const m = machineRef.current
      if (!m || m.pointerId !== e.pointerId) return
      const point: Point = { x: e.clientX, y: e.clientY }

      if (m.phase === 'pending') {
        if (distance(point, m.startPoint) < SLOP_PX) return
        trySetPointerCapture(e.currentTarget, e.pointerId)
        setDragPanelId(m.panelId)
        const { leaves: vLeaves, rootRect: vRoot } = toViewport()
        const dropTarget = hitTestDropZone(point, vLeaves, vRoot)
        machineRef.current = {
          phase: 'dragging',
          panelId: m.panelId,
          pointerId: m.pointerId,
          dropTarget
        }
        setDragState(resolveState(m.panelId, point, dropTarget))
        return
      }

      e.preventDefault()
      const { leaves: vLeaves, rootRect: vRoot } = toViewport()
      const dropTarget = withHysteresis(point, m.dropTarget, vLeaves, vRoot)
      machineRef.current = { ...m, dropTarget }
      setDragState(resolveState(m.panelId, point, dropTarget))
    },
    [resolveState, setDragPanelId, toViewport]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const m = machineRef.current
      if (!m || m.pointerId !== e.pointerId) return
      machineRef.current = null
      tryReleasePointerCapture(e.currentTarget, e.pointerId)
      setDragState(null)
      if (m.phase !== 'dragging') return // released before the slop was ever exceeded — a plain click/dblclick, untouched
      if (m.dropTarget) {
        commitDrag(m.panelId, m.dropTarget) // single store write: tree + dragPanelId = null together
      } else {
        setDragPanelId(null) // no resolvable target (shouldn't happen once leaves tile the container) — cancel, don't commit
      }
    },
    [commitDrag, setDragPanelId]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const m = machineRef.current
      if (!m || m.pointerId !== e.pointerId) return
      machineRef.current = null
      setDragState(null)
      if (m.phase === 'dragging') setDragPanelId(null) // an aborted gesture (e.g. OS-level interruption) never commits
    },
    [setDragPanelId]
  )

  return { dragState, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } }
}
