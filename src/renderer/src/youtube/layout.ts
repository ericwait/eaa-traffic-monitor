// Pure grid-layout math for the video panel — no DOM, no React, fully
// vitest-able (see tests/unit/videoLayout.test.ts). VideoGrid consumes the
// result to drive inline CSS grid properties; VideoTile consumes
// `tileArea(index)` to place itself when in emphasized mode.
//
// Two modes (see docs/design/Video.md):
//   - uniform: every feed the same size, `ceil(sqrt(n))` columns.
//   - emphasized: one 2x2 "big" tile plus a single-column thumbnail rail for
//     the rest, via named grid-template-areas.

export type VideoLayoutMode = 'uniform' | 'emphasized'

export interface VideoLayoutResult {
  mode: VideoLayoutMode
  gridTemplateColumns: string
  gridTemplateRows: string
  /** Only set in emphasized mode (grid-template-areas needs a real value or none at all). */
  gridTemplateAreas?: string
  /**
   * The grid-area name a tile at this DOM-order index should apply, or
   * `undefined` in uniform mode (tiles rely on normal grid auto-placement in
   * DOM order and need no explicit area).
   */
  tileArea: (index: number) => string | undefined
}

/**
 * Compute the video grid layout for `count` tiles.
 *
 * @param count Number of feeds to lay out. Negative or fractional input is
 *   treated as 0 (a caller bug, not worth throwing over for a layout function).
 * @param emphasizedIndex The DOM-order index of the tile to emphasize, or
 *   `null` for the uniform grid. An out-of-range index (stale/removed feed,
 *   negative, non-finite) clamps into range rather than throwing — a bad
 *   emphasized-id degrades to emphasizing the first tile, never crashes the
 *   grid.
 */
export function computeVideoLayout(
  count: number,
  emphasizedIndex: number | null
): VideoLayoutResult {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0

  if (emphasizedIndex == null || n <= 1) {
    return computeUniformLayout(n)
  }

  return computeEmphasizedLayout(n, emphasizedIndex)
}

function computeUniformLayout(n: number): VideoLayoutResult {
  const cols = n === 0 ? 1 : Math.ceil(Math.sqrt(n))
  const rows = n === 0 ? 1 : Math.ceil(n / cols)
  return {
    mode: 'uniform',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    tileArea: () => undefined
  }
}

function clampIndex(index: number, n: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(0, Math.floor(index)), n - 1)
}

function computeEmphasizedLayout(n: number, requestedIndex: number): VideoLayoutResult {
  const bigIndex = clampIndex(requestedIndex, n)
  const railIndices: number[] = []
  for (let i = 0; i < n; i++) {
    if (i !== bigIndex) railIndices.push(i)
  }

  // n <= 1 is already routed to the uniform layout above, but stay defensive:
  // a single tile emphasized with nothing else to rail just fills the panel.
  if (railIndices.length === 0) {
    return {
      mode: 'emphasized',
      gridTemplateColumns: '1fr',
      gridTemplateRows: '1fr',
      gridTemplateAreas: '"big"',
      tileArea: (index) => (index === bigIndex ? 'big' : undefined)
    }
  }

  // 3 columns: the "big" tile spans the first two, the rail occupies the
  // third. Rows: at least 2 (the big tile's own span), growing to fit every
  // rail tile its own row once there are more than 2 of them.
  const rows = Math.max(2, railIndices.length)
  const areaRows: string[] = []
  for (let r = 0; r < rows; r++) {
    const railIdx = railIndices[r]
    const railCell = railIdx !== undefined ? `rail${railIdx}` : '.'
    const bigCell = r < 2 ? 'big big' : '. .'
    areaRows.push(`"${bigCell} ${railCell}"`)
  }

  const areaByIndex = new Map<number, string>()
  areaByIndex.set(bigIndex, 'big')
  for (const idx of railIndices) areaByIndex.set(idx, `rail${idx}`)

  return {
    mode: 'emphasized',
    gridTemplateColumns: '2fr 2fr 1fr',
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gridTemplateAreas: areaRows.join(' '),
    tileArea: (index) => areaByIndex.get(index)
  }
}
