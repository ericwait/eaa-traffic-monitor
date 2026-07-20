import { useCallback, useRef } from 'react'
import { clampSizesToMinPx, type Orientation, type Rect } from '@shared/panelLayout'
import { FR24_RELAYOUT_EVENT } from './relayoutEvent'

// A single splitter/divider between two adjacent children of one split node.
// Pointer capture + pure clamp math (reused from @shared/panelLayout, not
// reimplemented here) — no react-resizable-panels involved. `sizes` is the
// OWNING split's current (possibly ephemeral, mid-drag) sizes array;
// `availablePx`/`minPx` are precomputed by PanelCanvas (the split's own
// bounding-box main-axis pixel span, and the per-split minimum floor — see
// PanelCanvas.tsx's collectSplitMeta).

/** Discrete step (percentage points) for one arrow-key press. */
const ARROW_STEP_PCT = 2
/** Minimum interactive hit-area thickness in px, independent of the thinner reserved/visual gap `computeLayoutRects` allocates (see docs/Panel-System-Plan.md's Splitter spec — "≥10px hit area"). */
const MIN_HIT_AREA_PX = 10

export interface SplitterProps {
  splitId: string
  /** Index of this splitter among its split's gaps (the gap after child[index]) — also used as part of the React key alongside splitId. */
  index: number
  /** The OWNING split's orientation: 'horizontal' (children side by side) renders as a vertical divider bar; 'vertical' (stacked children) renders as a horizontal bar — mirrors the react-resizable-panels convention this replaces. */
  orientation: Orientation
  /** This splitter's own rect, from computeLayoutRects. */
  rect: Rect
  /** The owning split's current sizes (percentages, length = child count). */
  sizes: readonly number[]
  /** The owning split's own main-axis pixel span (post-gap), for px<->pct conversion. */
  availablePx: number
  /** The per-split minimum-px floor passed to clampSizesToMinPx. */
  minPx: number
  /** Fired on every pointer move / arrow-key press — ephemeral preview, not yet a store commit. */
  onLiveChange: (sizes: number[]) => void
  /** Fired on pointer release / after each arrow-key press — the store commit. */
  onCommit: (sizes: number[]) => void
}

function applyDelta(
  sizes: readonly number[],
  index: number,
  deltaPct: number,
  availablePx: number,
  minPx: number
): number[] {
  const next = sizes.slice()
  next[index] += deltaPct
  next[index + 1] -= deltaPct
  return clampSizesToMinPx(next, availablePx, minPx)
}

function Splitter({
  splitId,
  index,
  orientation,
  rect,
  sizes,
  availablePx,
  minPx,
  onLiveChange,
  onCommit
}: SplitterProps): React.JSX.Element {
  // A vertical BAR (side-by-side children) tracks horizontal pointer movement.
  const isBarVertical = orientation === 'horizontal'
  const dragRef = useRef<{ startClient: number; startSizes: number[] } | null>(null)

  const clientPos = useCallback(
    (e: { clientX: number; clientY: number }): number => (isBarVertical ? e.clientX : e.clientY),
    [isBarVertical]
  )

  const deltaPctFor = useCallback(
    (client: number, startClient: number): number =>
      availablePx > 0 ? ((client - startClient) / availablePx) * 100 : 0,
    [availablePx]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startClient: clientPos(e), startSizes: sizes.slice() }
    },
    [clientPos, sizes]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current
      if (!drag) return
      const deltaPct = deltaPctFor(clientPos(e), drag.startClient)
      onLiveChange(applyDelta(drag.startSizes, index, deltaPct, availablePx, minPx))
      // Live relayout during the drag, same as a settled commit — Fr24Panel's
      // own rAF-throttled listener collapses a storm of these into one measure.
      window.dispatchEvent(new Event(FR24_RELAYOUT_EVENT))
    },
    [availablePx, clientPos, deltaPctFor, index, minPx, onLiveChange]
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      const deltaPct = deltaPctFor(clientPos(e), drag.startClient)
      onCommit(applyDelta(drag.startSizes, index, deltaPct, availablePx, minPx))
    },
    [availablePx, clientPos, deltaPctFor, index, minPx, onCommit]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const forwardKey = isBarVertical ? 'ArrowRight' : 'ArrowDown'
      const backwardKey = isBarVertical ? 'ArrowLeft' : 'ArrowUp'
      let direction = 0
      if (e.key === forwardKey) direction = 1
      else if (e.key === backwardKey) direction = -1
      else return
      e.preventDefault()
      onCommit(applyDelta(sizes, index, direction * ARROW_STEP_PCT, availablePx, minPx))
    },
    [availablePx, index, isBarVertical, minPx, onCommit, sizes]
  )

  // The reserved layout gap (computeLayoutRects' splitterPx) is the thin
  // visible line; the interactive hit target is enlarged to >= MIN_HIT_AREA_PX
  // so a 6px divider stays easy to grab (docs/Panel-System-Plan.md's CSS
  // section: "≥10px hit area, visible 1px line via the existing separator
  // look"). The extra margin is centered on the reserved rect and may overlap
  // the edges of the adjacent leaves by a couple of px — harmless, since the
  // splitter paints after them and captures the pointer directly.
  const barThickness = isBarVertical ? rect.width : rect.height
  const hitExtra = Math.max(0, MIN_HIT_AREA_PX - barThickness) / 2
  const style: React.CSSProperties = isBarVertical
    ? {
        left: rect.x - hitExtra,
        top: rect.y,
        width: rect.width + hitExtra * 2,
        height: rect.height
      }
    : {
        left: rect.x,
        top: rect.y - hitExtra,
        width: rect.width,
        height: rect.height + hitExtra * 2
      }

  return (
    <div
      className={`splitter ${isBarVertical ? '-vertical' : '-horizontal'}`}
      style={style}
      role="separator"
      aria-orientation={isBarVertical ? 'vertical' : 'horizontal'}
      aria-label={`Resize ${splitId}`}
      data-testid={`splitter-${splitId}-${index}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    />
  )
}

export default Splitter
