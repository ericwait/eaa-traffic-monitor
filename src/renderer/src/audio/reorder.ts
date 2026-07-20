import { useAppStore } from '../state/store'
import { audioEngine } from './engine'
import { moveTo } from './orderMath'

// Drag-to-reorder for the stream strips — priority IS vertical order (top = 1).
// Hand-rolled on pointer events (no drag-and-drop dependency; the list is a
// handful of fixed-height strips) with a keyboard path on the same grip, so
// reordering is operable — and e2e-testable — without synthetic drag gestures.
//
// Mechanics: pointerdown on a strip's grip starts a drag; window-level
// pointermove hit-tests the pointer's Y against every strip's midpoint (live
// DOM rects, so it follows scrolling) and PREVIEWS the new order by rewriting
// store.audioOrder; pointerup commits through engine.reorderChannels (which
// renumbers priorities 1..N and persists to config.json) or reverts the
// preview if the commit fails. Escape during a drag cancels it.

/** data attribute each strip carries so the hit test can map DOM → stream id. */
export const STRIP_ID_ATTR = 'data-strip-id'

/** The list's strips in visual order, with their live rects. */
function stripRects(): { id: string; rect: DOMRect }[] {
  return [...document.querySelectorAll<HTMLElement>(`[${STRIP_ID_ATTR}]`)].map((el) => ({
    id: el.getAttribute(STRIP_ID_ATTR) as string,
    rect: el.getBoundingClientRect()
  }))
}

/** The order index the pointer's Y lands on (index in the CURRENT preview order). */
function indexForY(y: number): number {
  const rects = stripRects()
  for (let i = 0; i < rects.length; i += 1) {
    const { rect } = rects[i]
    if (y < rect.top + rect.height / 2) return i
  }
  return rects.length - 1
}

/**
 * Commit a reorder through the engine, reverting the on-screen order if the
 * write fails (config.json unwritable / invalid) so the UI never shows an
 * order that didn't persist.
 */
async function commitOrder(next: string[], revertTo: string[]): Promise<void> {
  const outcome = await audioEngine.reorderChannels(next)
  if (!outcome.ok) {
    console.error('[audio] reorder failed:', outcome.error)
    useAppStore.getState().setAudioOrder(revertTo)
  }
}

/**
 * Begin a pointer drag from a strip's grip. Call from the grip's onPointerDown;
 * everything after that (move preview, commit, cancel) is window-level.
 */
export function beginStripDrag(id: string, e: React.PointerEvent): void {
  // Only a primary-button / touch/pen contact starts a drag.
  if (e.button !== 0) return
  e.preventDefault()

  const store = useAppStore.getState()
  const originalOrder = [...store.audioOrder]
  store.setAudioDragId(id)

  const onMove = (ev: PointerEvent): void => {
    const s = useAppStore.getState()
    const current = s.audioOrder
    const from = current.indexOf(id)
    const to = indexForY(ev.clientY)
    if (from !== -1 && to !== from) s.setAudioOrder(moveTo(current, id, to))
  }

  const finish = (commit: boolean): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey)
    const s = useAppStore.getState()
    s.setAudioDragId(null)
    const next = s.audioOrder
    const changed = next.join('\n') !== originalOrder.join('\n')
    if (commit && changed) void commitOrder(next, originalOrder)
    if (!commit) s.setAudioOrder(originalOrder)
  }

  const onUp = (): void => finish(true)
  const onCancel = (): void => finish(false)
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      // Swallow it: Escape mid-drag cancels the drag, never a held solo too.
      ev.stopImmediatePropagation()
      finish(false)
    }
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  // Capture phase so the drag's Escape wins over the solo-release listener.
  window.addEventListener('keydown', onKey, { capture: true })
}

/**
 * Move a strip one step up (-1) or down (+1) — the grip's ArrowUp/ArrowDown
 * path. Commits immediately (one config write per step) and reverts on failure.
 */
export function moveStrip(id: string, delta: -1 | 1): void {
  const store = useAppStore.getState()
  const order = store.audioOrder
  const from = order.indexOf(id)
  if (from === -1) return
  const to = from + delta
  if (to < 0 || to >= order.length) return
  const next = moveTo(order, id, to)
  store.setAudioOrder(next)
  void commitOrder(next, order)
}
