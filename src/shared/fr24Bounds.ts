import type { Fr24Bounds } from './ipc'

// Pure conversion from a measured DOM rect to the integer bounds a
// WebContentsView needs — the rounding/clamping/coercion the FR24 bounds-sync
// depends on, lifted out of the renderer so it is testable in isolation (no DOM,
// no Electron). This is the FR24 analogue of the audio guardian functions
// (vad.ts, ducking.ts) that arrive in later phases.

/**
 * The subset of a `DOMRect` this conversion reads. `getBoundingClientRect()`
 * returns a full DOMRect, which is assignable to this — but declaring only what
 * we use keeps the function trivially unit-testable with plain objects.
 */
export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Coerce one measurement to a safe integer. Fractional pixels round to the
 * nearest whole DIP; NaN / ±Infinity (which a mid-collapse layout can briefly
 * produce) collapse to 0 rather than propagating a garbage value into a native
 * `setBounds` call.
 */
function toInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

/**
 * Convert a measured rect into integer FR24 view bounds.
 *
 * - `x` / `y` are rounded and integer-coerced but NOT clamped — the region can
 *   legitimately sit anywhere in the window's content area.
 * - `width` / `height` are additionally clamped to `>= 0`: a resizable panel
 *   collapsing can momentarily report a negative or fractional size, and a
 *   negative dimension is meaningless (and can throw) at the native layer, so it
 *   floors to a zero-size (invisible) view instead.
 */
export function rectToBounds(rect: RectLike): Fr24Bounds {
  return {
    x: toInt(rect.x),
    y: toInt(rect.y),
    width: Math.max(0, toInt(rect.width)),
    height: Math.max(0, toInt(rect.height))
  }
}

/**
 * True when two bounds are identical. The renderer uses this to skip redundant
 * `fr24:setBounds` IPC calls when a resize event fires but the rounded bounds
 * did not actually change — cheaper than crossing the process boundary for a
 * no-op.
 */
export function boundsEqual(a: Fr24Bounds, b: Fr24Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
