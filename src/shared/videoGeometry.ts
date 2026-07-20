// Pure aspect-ratio geometry for a single video panel's fit/fill toggle (see
// docs/Panel-System-Plan.md § Key interactions § Video fit/fill). `LeafFrame`
// (PR2) applies the returned rect to a `.video-tile-stage` wrapper inside the
// leaf's overflow-hidden body, so the player itself never has to know which
// mode it's in.
//
// Electron/DOM-free like panelLayout.ts (compiles in both tsconfigs).

import type { VideoFitMode } from './panelLayout'

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_ASPECT = 16 / 9

/**
 * The rect a video should occupy inside `containerSize` for `mode`:
 * - `fit`: the largest `aspect`-ratio rect that INSCRIBES inside the
 *   container (letterboxed/pillarboxed, never cropped) — the default.
 * - `fill`: the smallest `aspect`-ratio rect that COVERS the container
 *   (cropped by the caller's `overflow: hidden`, never letterboxed).
 *
 * Always centered, always integer (rounded), and zero-safe: a zero/negative/
 * non-finite container dimension or aspect ratio yields a zero rect rather
 * than NaN or a throw.
 */
export function computeAspectRect(
  containerSize: Size,
  mode: VideoFitMode,
  aspect: number = DEFAULT_ASPECT
): Rect {
  const cw = Number.isFinite(containerSize.width) ? Math.max(0, containerSize.width) : 0
  const ch = Number.isFinite(containerSize.height) ? Math.max(0, containerSize.height) : 0

  if (cw === 0 || ch === 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  const containerAspect = cw / ch
  const wider = containerAspect > aspect // container is wider (relative to its height) than the target aspect
  const coveringNeedsFullWidth = mode === 'fill' ? wider : !wider

  let width: number
  let height: number
  if (coveringNeedsFullWidth) {
    width = cw
    height = cw / aspect
  } else {
    height = ch
    width = ch * aspect
  }

  const x = Math.round((cw - width) / 2)
  const y = Math.round((ch - height) / 2)
  return { x, y, width: Math.round(width), height: Math.round(height) }
}
