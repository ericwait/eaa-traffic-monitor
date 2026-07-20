// The panel-layout domain model: a serializable split tree (splits with
// orientation + percentage sizes; leaves = panel ids) that replaces
// react-resizable-panels' own uncontrolled Group/Panel layout and its opaque
// `LayoutStorage` strings, plus the pure operations that edit and measure it.
//
// (decision 2026-07-19) Panel layout is a serializable split tree stored in
// `session.panelLayout`, rendered by a single-container canvas (one absolutely
// positioned container, leaves placed by `computeLayoutRects`), retiring rrp
// and its `LayoutStorage` strings. See docs/Panel-System-Plan.md for the full
// architecture rationale (rrp v4's uncontrolled Group fights a dynamic,
// profile-switched tree) and docs/decisions/README.md for the index row.
//
// This module MUST stay free of Electron and DOM APIs (see src/shared/README.md)
// so it compiles under both tsconfig.node.json and tsconfig.web.json and is
// importable from vitest, the main process, the preload, and the renderer alike.
// Every op here is a pure function: given the same inputs it returns the same
// (structurally) output, and untouched subtrees keep their exact object
// reference so a store can cheaply skip re-renders/persists on a no-op edit.
//
// PR1 (this file) ships the domain model, the guillotine-partition geometry,
// and the never-throw sanitizers as pure, unit-tested modules with ZERO UI
// wiring — nothing here is imported by the renderer yet. PR2 wires PanelCanvas/
// LeafFrame/the store slice on top of it (see docs/Panel-System-Plan.md's PR
// slicing). Leaves must render sorted by panel id, never by tree position, once
// PR2 lands: a keyed DOM reorder (`insertBefore`) reloads every video iframe.

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Every panel this app can show: the two audio-column panels, FR24, and one per video feed. */
export type PanelId = 'audio' | 'weather' | 'fr24' | `video:${string}`

/** A split's children lay out side by side (`horizontal`) or stacked (`vertical`) — matches the react-resizable-panels Group `orientation` convention this replaces. */
export type Orientation = 'horizontal' | 'vertical'

export interface LayoutLeaf {
  type: 'leaf'
  id: PanelId
}

export interface LayoutSplit {
  type: 'split'
  /** Stable id for this split node — the handle `updateSplitSizes`/the splitter drag targets. */
  id: string
  orientation: Orientation
  children: LayoutNode[]
  /** Percentage shares, one per child, summing to ~100 (never persisted mid-drift — every op renormalizes). */
  sizes: number[]
}

export type LayoutNode = LayoutLeaf | LayoutSplit

/** A named, saved arrangement — a full tree snapshot under session.panelLayout.profiles. */
export interface LayoutProfile {
  name: string
  tree: LayoutNode
}

/** Per-video-panel display mode: `fit` (default) inscribes 16:9, `fill` crops to cover. */
export type VideoFitMode = 'fit' | 'fill'

/** The whole panel-layout session slice — additive to SessionState (see src/shared/ipc.ts). */
export interface PanelLayoutSession {
  tree: LayoutNode
  maximizedPanelId: PanelId | null
  /** Keyed by the bare feed id (not the `video:` panel id) — see VideoFitMode. */
  videoFit: Record<string, VideoFitMode>
  profiles: LayoutProfile[]
}

// ---------------------------------------------------------------------------
// Drag / drop docking targets. `DropTarget` is produced renderer-side by
// `src/renderer/src/layout/dropZones.ts` (hit-testing pointer position against
// computed leaf rects) and consumed here by `movePanel`. It lives in this
// shared module — not in the renderer-only dropZones module — because
// `movePanel`'s signature is fixed by the pure-function inventory and both
// sides need the same vocabulary.
// ---------------------------------------------------------------------------

/** Where, relative to a panel's own rect, a drag was released. `center` swaps; the four edges split. */
export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center'

/** Which edge of the whole canvas a root dock targets (`.app-body`'s outer 24px margin — see the plan's Key interactions). */
export type RootEdge = 'top' | 'bottom' | 'left' | 'right'

/** The edge a new sibling is inserted against when splitting an existing leaf. */
export type SplitEdge = 'top' | 'bottom' | 'left' | 'right'

export type DropTarget =
  { kind: 'panel'; targetId: PanelId; zone: DropZone } | { kind: 'root'; edge: RootEdge }

// ---------------------------------------------------------------------------
// Geometry types (computeLayoutRects).
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LeafRectResult {
  id: PanelId
  rect: Rect
}

export interface SplitterRectResult {
  splitId: string
  /** Index of the splitter within its split's children — the gap after child[index]. */
  index: number
  orientation: Orientation
  rect: Rect
}

export interface LayoutRects {
  leaves: LeafRectResult[]
  splitters: SplitterRectResult[]
}

// ---------------------------------------------------------------------------
// Tunable constants. Named so the "why 50/25" question has one answer, and so
// tests assert behavior against the same constant the implementation uses.
// ---------------------------------------------------------------------------

/** Header-drag onto an existing panel's edge splits it 50/50 (see the plan's Key interactions § Header drag-to-dock). */
const PANEL_SPLIT_SHARE_PCT = 50
/** Header-drag onto a root/`.app-body` edge docks the new column/row at 25% (see the plan's Key interactions). */
const ROOT_DOCK_SHARE_PCT = 25
/** Sizes within this many percentage points of a target are treated as unchanged — `updateSplitSizes`' epsilon no-op. */
const SIZE_EPSILON = 0.01
/** A sizes array summing within this tolerance of 100 is corrected in place (last entry absorbs drift) rather than fully rescaled. */
const SIZE_SUM_EPSILON = 0.05
/** Recursion/nesting cap for sanitizing a hand-edited or corrupt tree — generous for any layout a human would actually build via drag/split, but bounded so a pathological (or cyclic) blob can never blow the stack. */
const MAX_TREE_DEPTH = 32
/** Default splitter hit/paint thickness in px, used when a caller doesn't override it. */
const DEFAULT_SPLITTER_PX = 6

// ---------------------------------------------------------------------------
// Small local guards/helpers. Duplicated-but-tiny rather than imported across
// modules on purpose (see src/shared/session.ts, which does the same) — each
// shared module stays self-contained and Electron/DOM-free.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPanelId(value: unknown): value is PanelId {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value === 'audio' || value === 'weather' || value === 'fr24') return true
  return value.startsWith('video:') && value.length > 'video:'.length
}

function isVideoPanelId(id: PanelId): boolean {
  return id.startsWith('video:')
}

function videoFeedIdOf(id: PanelId): string {
  return id.slice('video:'.length)
}

/** A fresh array of `n` equal percentage shares, summing to exactly 100 (float drift absorbed by the last entry). */
function equalSizes(n: number): number[] {
  if (n <= 0) return []
  const base = 100 / n
  const sizes = new Array<number>(n).fill(base)
  const sum = sizes.reduce((a, b) => a + b, 0)
  sizes[n - 1] += 100 - sum
  return sizes
}

function sizesRoughlyEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > SIZE_EPSILON) return false
  }
  return true
}

/**
 * Coerce a sizes array into one that sums to exactly 100: non-finite/non-positive
 * entries (or a length-0 input) fall back to an equal split; a sum already close
 * to 100 is nudged exact (last entry absorbs the drift); anything else is
 * rescaled proportionally.
 */
export function normalizeSizes(sizes: readonly number[]): number[] {
  const n = sizes.length
  if (n === 0) return []
  const allFinitePositive = sizes.every((s) => Number.isFinite(s) && s > 0)
  if (!allFinitePositive) return equalSizes(n)
  const sum = sizes.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 100) <= SIZE_SUM_EPSILON) {
    const exact = sizes.slice()
    exact[n - 1] += 100 - sum
    return exact
  }
  const scale = 100 / sum
  const scaled = sizes.map((s) => s * scale)
  const scaledSum = scaled.reduce((a, b) => a + b, 0)
  scaled[n - 1] += 100 - scaledSum
  return scaled
}

const SPLIT_ID_PATTERN = /^split-(\d+)$/

function collectSplitIds(node: LayoutNode, out: Set<string>): void {
  if (node.type !== 'split') return
  out.add(node.id)
  for (const child of node.children) collectSplitIds(child, out)
}

/** The next `split-N` id not already used anywhere in `tree` — deterministic and collision-free, no randomness (mirrors `nextPopoutId` in src/shared/session.ts). */
function nextSplitId(tree: LayoutNode): string {
  const ids = new Set<string>()
  collectSplitIds(tree, ids)
  let max = 0
  for (const id of ids) {
    const m = SPLIT_ID_PATTERN.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `split-${max + 1}`
}

// ---------------------------------------------------------------------------
// Tree-shape utilities shared by removePanel/pruneVideoLeaves/normalizeTree.
// `finalizeSplit` is the single place that decides: drop an empty split,
// collapse a 1-child split into its child, renormalize sizes, and — the part
// that matters for drag/move — return the EXACT SAME node reference when
// nothing about this split actually changed, so an edit elsewhere in the tree
// never disturbs sibling subtrees' identity.
// ---------------------------------------------------------------------------

function finalizeSplit(
  original: LayoutSplit,
  survivors: LayoutNode[],
  survivorSizes: number[],
  anyChildChanged: boolean
): LayoutNode | null {
  if (survivors.length === 0) return null
  if (survivors.length === 1) return survivors[0]
  const normalizedSizes = normalizeSizes(survivorSizes)
  const countChanged = survivors.length !== original.children.length
  if (!anyChildChanged && !countChanged && sizesRoughlyEqual(normalizedSizes, original.sizes)) {
    return original
  }
  return {
    type: 'split',
    id: original.id,
    orientation: original.orientation,
    children: survivors,
    sizes: normalizedSizes
  }
}

/** Recursively drop every leaf for which `shouldDrop` is true, collapsing/renormalizing as needed. `null` means the whole tree emptied out. */
function filterNode(
  node: LayoutNode,
  shouldDrop: (leaf: LayoutLeaf) => boolean
): LayoutNode | null {
  if (node.type === 'leaf') return shouldDrop(node) ? null : node
  let changed = false
  const survivors: LayoutNode[] = []
  const survivorSizes: number[] = []
  for (let i = 0; i < node.children.length; i++) {
    const next = filterNode(node.children[i], shouldDrop)
    if (next === null) {
      changed = true
      continue
    }
    if (next !== node.children[i]) changed = true
    survivors.push(next)
    survivorSizes.push(node.sizes[i] ?? 0)
  }
  return finalizeSplit(node, survivors, survivorSizes, changed)
}

/** Recursively replace every leaf via `transform`, preserving reference identity for every leaf/split `transform` leaves untouched. */
function mapLeaves(node: LayoutNode, transform: (leaf: LayoutLeaf) => LayoutLeaf): LayoutNode {
  if (node.type === 'leaf') {
    const next = transform(node)
    return next.id === node.id ? node : next
  }
  let changed = false
  const children = node.children.map((child) => {
    const next = mapLeaves(child, transform)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...node, children } : node
}

function normalizeNode(node: LayoutNode, seen: Set<PanelId>): LayoutNode | null {
  if (node.type === 'leaf') {
    if (seen.has(node.id)) return null // duplicate leaf id — first occurrence in tree order wins
    seen.add(node.id)
    return node
  }
  let changed = false
  const survivors: LayoutNode[] = []
  const survivorSizes: number[] = []
  for (let i = 0; i < node.children.length; i++) {
    const next = normalizeNode(node.children[i], seen)
    if (next === null) {
      changed = true
      continue
    }
    if (next !== node.children[i]) changed = true
    survivors.push(next)
    survivorSizes.push(node.sizes[i] ?? 0)
  }
  return finalizeSplit(node, survivors, survivorSizes, changed)
}

// ---------------------------------------------------------------------------
// Pure-function inventory
// ---------------------------------------------------------------------------

/** Every leaf's panel id, in tree (DOM) order. */
export function collectLeafIds(tree: LayoutNode | null): PanelId[] {
  if (tree === null) return []
  if (tree.type === 'leaf') return [tree.id]
  return tree.children.flatMap((child) => collectLeafIds(child))
}

/**
 * Enforce the tree invariants: duplicate leaf ids dropped (first occurrence in
 * tree order wins), 1-child splits collapsed, empty splits dropped, sizes
 * renormalized to sum to 100. Idempotent — normalizing an already-normal tree
 * returns it structurally unchanged (and, for any subtree that needed no
 * change, the exact same object reference).
 */
export function normalizeTree(tree: LayoutNode): LayoutNode {
  const seen = new Set<PanelId>()
  const result = normalizeNode(tree, seen)
  // A well-formed, non-empty input's very first leaf can never already be in
  // `seen`, so the top-level call cannot itself collapse to null; the fallback
  // just documents that invariant without a non-null assertion.
  return result ?? tree
}

/** Remove the leaf `id`, collapsing/renormalizing as needed. `null` when it was the last leaf. */
export function removePanel(tree: LayoutNode, id: PanelId): LayoutNode | null {
  return filterNode(tree, (leaf) => leaf.id === id)
}

/** Drop every `video:` leaf whose feed id is not in `allowedFeedIds` (hydrate-time pruning against the current config / restored pop-outs). Non-video leaves are always kept. */
export function pruneVideoLeaves(
  tree: LayoutNode | null,
  allowedFeedIds: ReadonlySet<string> | readonly string[]
): LayoutNode | null {
  if (tree === null) return null
  const allowed = allowedFeedIds instanceof Set ? allowedFeedIds : new Set(allowedFeedIds)
  return filterNode(tree, (leaf) => isVideoPanelId(leaf.id) && !allowed.has(videoFeedIdOf(leaf.id)))
}

/**
 * Split the leaf `targetId` into a new 2-child split containing it plus
 * `newLeaf`, positioned on `edge` with `newLeaf` taking `sharePct` (clamped
 * into [1, 99]; default 50). A `targetId` absent from the tree is a no-op
 * (returns the same reference) rather than a throw.
 */
export function splitPanel(
  tree: LayoutNode,
  targetId: PanelId,
  newLeaf: LayoutLeaf,
  edge: SplitEdge,
  sharePct = PANEL_SPLIT_SHARE_PCT
): LayoutNode {
  const share = Math.min(
    99,
    Math.max(1, Number.isFinite(sharePct) ? sharePct : PANEL_SPLIT_SHARE_PCT)
  )
  const splitId = nextSplitId(tree)
  const orientation: Orientation = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
  const newFirst = edge === 'left' || edge === 'top'

  function replace(node: LayoutNode): LayoutNode {
    if (node.type === 'leaf') {
      if (node.id !== targetId) return node
      const children = newFirst ? [newLeaf, node] : [node, newLeaf]
      const sizes = newFirst ? [share, 100 - share] : [100 - share, share]
      return { type: 'split', id: splitId, orientation, children, sizes }
    }
    let changed = false
    const children = node.children.map((child) => {
      const next = replace(child)
      if (next !== child) changed = true
      return next
    })
    return changed ? { ...node, children } : node
  }

  return replace(tree)
}

/** Exchange the positions of two leaves. A no-op (same reference) if either id is absent, or if idA === idB. */
export function swapPanels(tree: LayoutNode, idA: PanelId, idB: PanelId): LayoutNode {
  if (idA === idB) return tree
  const ids = collectLeafIds(tree)
  if (!ids.includes(idA) || !ids.includes(idB)) return tree
  return mapLeaves(tree, (leaf) => {
    if (leaf.id === idA) return { type: 'leaf', id: idB }
    if (leaf.id === idB) return { type: 'leaf', id: idA }
    return leaf
  })
}

/**
 * Move panel `id` to `target` (a drop computed by dropZones.hitTestDropZone).
 * A no-op (same tree reference) when: `id` isn't in the tree, the target panel
 * doesn't exist, `id` is dropped onto itself, or `id` is the tree's only leaf.
 * `zone: 'center'` swaps; the four edges (and root docking) remove `id` then
 * re-split it in beside the target — every subtree not on the path between the
 * old and new location keeps its exact object reference.
 */
export function movePanel(tree: LayoutNode, id: PanelId, target: DropTarget): LayoutNode {
  const leafIds = new Set(collectLeafIds(tree))
  if (!leafIds.has(id)) return tree

  if (target.kind === 'panel') {
    if (target.targetId === id) return tree // move-onto-self: identity
    if (!leafIds.has(target.targetId)) return tree // stale target
    if (target.zone === 'center') return swapPanels(tree, id, target.targetId)
    const removed = removePanel(tree, id)
    if (removed === null) return tree // id was the only leaf — nothing to dock against
    return splitPanel(
      removed,
      target.targetId,
      { type: 'leaf', id },
      target.zone,
      PANEL_SPLIT_SHARE_PCT
    )
  }

  // Root dock: id becomes a new outer sibling of everything else.
  const removed = removePanel(tree, id)
  if (removed === null) return tree
  const splitId = nextSplitId(tree)
  const orientation: Orientation =
    target.edge === 'left' || target.edge === 'right' ? 'horizontal' : 'vertical'
  const newFirst = target.edge === 'left' || target.edge === 'top'
  const newLeaf: LayoutLeaf = { type: 'leaf', id }
  const children = newFirst ? [newLeaf, removed] : [removed, newLeaf]
  const sizes = newFirst
    ? [ROOT_DOCK_SHARE_PCT, 100 - ROOT_DOCK_SHARE_PCT]
    : [100 - ROOT_DOCK_SHARE_PCT, ROOT_DOCK_SHARE_PCT]
  return { type: 'split', id: splitId, orientation, children, sizes }
}

/** The split with the most leaf-only children anywhere in `node` (first-found wins ties) — the "video grid"-shaped group `insertPanelBalanced` joins. */
function findLargestLeafGroup(node: LayoutNode): LayoutSplit | null {
  if (node.type === 'leaf') return null
  let best: LayoutSplit | null = node.children.every((child) => child.type === 'leaf') ? node : null
  for (const child of node.children) {
    const candidate = findLargestLeafGroup(child)
    if (candidate && (best === null || candidate.children.length > best.children.length))
      best = candidate
  }
  return best
}

/**
 * Reopen path: insert `leaf` back into the tree in a balanced way rather than
 * as an afterthought sliver. `null` tree (everything closed) makes `leaf` the
 * whole tree. An id already present is a no-op. Otherwise the leaf joins the
 * largest all-leaf group (rebalanced to equal shares) — typically the video
 * grid — or, if no such group exists, splits the tree 50/50.
 */
export function insertPanelBalanced(tree: LayoutNode | null, leaf: LayoutLeaf): LayoutNode {
  if (tree === null) return leaf
  if (collectLeafIds(tree).includes(leaf.id)) return tree

  const target = findLargestLeafGroup(tree)
  if (target === null) {
    const splitId = nextSplitId(tree)
    return {
      type: 'split',
      id: splitId,
      orientation: 'horizontal',
      children: [tree, leaf],
      sizes: [50, 50]
    }
  }

  function replace(node: LayoutNode): LayoutNode {
    if (node.type === 'leaf') return node
    if (node.id === target!.id) {
      const children = [...node.children, leaf]
      return {
        type: 'split',
        id: node.id,
        orientation: node.orientation,
        children,
        sizes: equalSizes(children.length)
      }
    }
    let changed = false
    const children = node.children.map((child) => {
      const next = replace(child)
      if (next !== child) changed = true
      return next
    })
    return changed ? { ...node, children } : node
  }

  return replace(tree)
}

/**
 * Set `splitId`'s sizes to `sizes` (renormalized to sum to 100). If the
 * renormalized sizes are within epsilon of the split's current sizes, returns
 * the EXACT SAME tree reference (the drag-release commit's no-op fast path) —
 * a `splitId` not found in the tree is likewise a no-op.
 */
export function updateSplitSizes(
  tree: LayoutNode,
  splitId: string,
  sizes: readonly number[]
): LayoutNode {
  function replace(node: LayoutNode): LayoutNode {
    if (node.type === 'leaf') return node
    if (node.id === splitId) {
      if (sizes.length !== node.children.length) return node // shape mismatch — ignore rather than corrupt
      const normalized = normalizeSizes(sizes)
      if (sizesRoughlyEqual(normalized, node.sizes)) return node
      return { ...node, sizes: normalized }
    }
    let changed = false
    const children = node.children.map((child) => {
      const next = replace(child)
      if (next !== child) changed = true
      return next
    })
    return changed ? { ...node, children } : node
  }
  return replace(tree)
}

/** How many items land in each of `groups` rows for `n` total, as evenly as possible with any remainder front-loaded (e.g. n=7, groups=3 → [3, 2, 2]). */
function distributeCounts(n: number, groups: number): number[] {
  const base = Math.floor(n / groups)
  const rem = n % groups
  return Array.from({ length: groups }, (_, i) => base + (i < rem ? 1 : 0))
}

/**
 * A balanced grid of `panelIds`: `ceil(sqrt(n))` rows, items distributed as
 * evenly as possible per row (front-loaded remainder — 7 items → rows of
 * [3, 2, 2]). `null` for an empty list; a bare leaf for a single item.
 */
export function buildBalancedGrid(panelIds: readonly PanelId[]): LayoutNode | null {
  const n = panelIds.length
  if (n === 0) return null
  if (n === 1) return { type: 'leaf', id: panelIds[0] }

  const rowCount = Math.ceil(Math.sqrt(n))
  const rowCounts = distributeCounts(n, rowCount)

  let cursor = 0
  const rows: LayoutNode[] = rowCounts.map((count, rowIndex) => {
    const rowIds = panelIds.slice(cursor, cursor + count)
    cursor += count
    if (rowIds.length === 1) return { type: 'leaf', id: rowIds[0] }
    return {
      type: 'split',
      id: `grid-row-${rowIndex}`,
      orientation: 'horizontal',
      children: rowIds.map((id): LayoutLeaf => ({ type: 'leaf', id })),
      sizes: equalSizes(rowIds.length)
    }
  })

  if (rows.length === 1) return rows[0]
  return {
    type: 'split',
    id: 'grid-rows',
    orientation: 'vertical',
    children: rows,
    sizes: equalSizes(rows.length)
  }
}

/** Audio's share of the left column above the weather panel (see buildDefaultTree). Not measured from today's UI — weather is un-split content inside AudioPanel today; this is the new tree's first-run default. */
const DEFAULT_AUDIO_SHARE_PCT = 70
const DEFAULT_WEATHER_SHARE_PCT = 100 - DEFAULT_AUDIO_SHARE_PCT
/** Mirrors today's LayoutShell `cols` group (22 atc / 78 right). */
const DEFAULT_LEFT_COLUMN_SHARE_PCT = 22
const DEFAULT_RIGHT_COLUMN_SHARE_PCT = 100 - DEFAULT_LEFT_COLUMN_SHARE_PCT
/** Mirrors today's LayoutShell `rows` group (62 fr24 / 38 video). */
const DEFAULT_FR24_SHARE_PCT = 62
const DEFAULT_VIDEO_SHARE_PCT = 100 - DEFAULT_FR24_SHARE_PCT

/**
 * The first-run tree: mirrors today's hard-coded 22/78 (audio column / right
 * column) and 62/38 (FR24 / video) split, with weather promoted to its own
 * panel below audio (today it is un-split content inside AudioPanel — see
 * docs/Panel-System-Plan.md § Context). `videoFeedIds` are bare feed ids (e.g.
 * from youtube/defaultFeeds.ts, which this module cannot import — it is
 * renderer-owned); they are laid out via `buildBalancedGrid`. An empty feed
 * list collapses the right column to FR24 alone.
 */
export function buildDefaultTree(videoFeedIds: readonly string[]): LayoutNode {
  const audioWeather: LayoutNode = {
    type: 'split',
    id: 'default-audio-weather',
    orientation: 'vertical',
    children: [
      { type: 'leaf', id: 'audio' },
      { type: 'leaf', id: 'weather' }
    ],
    sizes: [DEFAULT_AUDIO_SHARE_PCT, DEFAULT_WEATHER_SHARE_PCT]
  }

  const videoIds = videoFeedIds.map((id): PanelId => `video:${id}`)
  const videoNode = buildBalancedGrid(videoIds)

  const right: LayoutNode = videoNode
    ? {
        type: 'split',
        id: 'default-right',
        orientation: 'vertical',
        children: [{ type: 'leaf', id: 'fr24' }, videoNode],
        sizes: [DEFAULT_FR24_SHARE_PCT, DEFAULT_VIDEO_SHARE_PCT]
      }
    : { type: 'leaf', id: 'fr24' }

  return {
    type: 'split',
    id: 'default-root',
    orientation: 'horizontal',
    children: [audioWeather, right],
    sizes: [DEFAULT_LEFT_COLUMN_SHARE_PCT, DEFAULT_RIGHT_COLUMN_SHARE_PCT]
  }
}

/** Deep structural equality (ignores object identity; sizes compared within epsilon). */
export function treesEqual(a: LayoutNode | null, b: LayoutNode | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.type !== b.type) return false
  if (a.type === 'leaf' && b.type === 'leaf') return a.id === b.id
  if (a.type === 'split' && b.type === 'split') {
    if (a.id !== b.id) return false
    if (a.orientation !== b.orientation) return false
    if (a.children.length !== b.children.length) return false
    if (a.sizes.length !== b.sizes.length) return false
    for (let i = 0; i < a.children.length; i++) {
      if (!treesEqual(a.children[i], b.children[i])) return false
    }
    return sizesRoughlyEqual(a.sizes, b.sizes)
  }
  return false
}

// ---------------------------------------------------------------------------
// Geometry: computeLayoutRects + the splitter min-px clamp helper.
// ---------------------------------------------------------------------------

/**
 * Map `tree` onto `containerRect` as a guillotine partition: every leaf gets a
 * rect, every gap between siblings gets a `splitterPx`-wide splitter rect.
 * Cumulative (not per-child-independent) rounding guarantees exact tiling —
 * leaf rects plus splitter rects exactly cover the container with no gaps or
 * overlaps, to the pixel. `null` tree yields no leaves/splitters.
 */
export function computeLayoutRects(
  tree: LayoutNode | null,
  containerRect: Rect,
  splitterPx: number = DEFAULT_SPLITTER_PX
): LayoutRects {
  const leaves: LeafRectResult[] = []
  const splitters: SplitterRectResult[] = []

  function walk(node: LayoutNode, rect: Rect): void {
    if (node.type === 'leaf') {
      leaves.push({ id: node.id, rect })
      return
    }

    const horizontal = node.orientation === 'horizontal'
    const mainAxisSize = horizontal ? rect.width : rect.height
    const n = node.children.length
    const gapTotal = splitterPx * Math.max(0, n - 1)
    const available = Math.max(0, Math.round(mainAxisSize - gapTotal))

    const cumPct: number[] = [0]
    for (const pct of node.sizes) cumPct.push(cumPct[cumPct.length - 1] + pct)
    const totalPct = cumPct[cumPct.length - 1] || 1
    const boundaries = cumPct.map((pct) => Math.round((pct / totalPct) * available))

    let mainCursor = horizontal ? rect.x : rect.y
    for (let i = 0; i < n; i++) {
      const childMainSize = boundaries[i + 1] - boundaries[i]
      const childRect: Rect = horizontal
        ? { x: mainCursor, y: rect.y, width: childMainSize, height: rect.height }
        : { x: rect.x, y: mainCursor, width: rect.width, height: childMainSize }
      walk(node.children[i], childRect)
      mainCursor += childMainSize

      if (i < n - 1) {
        const splitterRect: Rect = horizontal
          ? { x: mainCursor, y: rect.y, width: splitterPx, height: rect.height }
          : { x: rect.x, y: mainCursor, width: rect.width, height: splitterPx }
        splitters.push({
          splitId: node.id,
          index: i,
          orientation: node.orientation,
          rect: splitterRect
        })
        mainCursor += splitterPx
      }
    }
  }

  if (tree !== null) walk(tree, containerRect)
  return { leaves, splitters }
}

/**
 * Clamp a sizes array (percentages) so every child's pixel share of `totalPx`
 * is at least `minPx`, redistributing the deficit from the other children
 * proportionally to their current share. Falls back to an equal split when
 * even an equal share can't clear the floor (the requested minimums simply
 * don't fit). Used by the splitter drag handler to keep a live drag from
 * shrinking a panel past its usable minimum.
 */
export function clampSizesToMinPx(
  sizes: readonly number[],
  totalPx: number,
  minPx: number
): number[] {
  const n = sizes.length
  if (n === 0) return []
  if (totalPx <= 0) return equalSizes(n)

  const minPctEach = (minPx / totalPx) * 100
  if (minPctEach * n >= 100) return equalSizes(n) // the minimums themselves don't fit — best effort

  const result = normalizeSizes(sizes)
  for (let iter = 0; iter < n; iter++) {
    let deficit = 0
    const locked = new Array<boolean>(n).fill(false)
    for (let i = 0; i < n; i++) {
      if (result[i] < minPctEach) {
        deficit += minPctEach - result[i]
        result[i] = minPctEach
        locked[i] = true
      }
    }
    if (deficit <= SIZE_EPSILON) break
    const freeIndices = result.map((_, i) => i).filter((i) => !locked[i])
    const freeTotal = freeIndices.reduce((sum, i) => sum + result[i], 0)
    if (freeTotal <= 0) break
    for (const i of freeIndices) {
      result[i] -= (deficit * result[i]) / freeTotal
    }
  }
  return normalizeSizes(result)
}

// ---------------------------------------------------------------------------
// Never-throw sanitizers. A missing field, a hand-edited value of the wrong
// type, or a whole non-object degrades to null/a default rather than throwing
// — a relaunch is never blocked by one bad value (same reliability mandate as
// src/shared/session.ts). See docs/Panel-System-Plan.md § Data model and
// persistence for the exact contract each branch below implements.
// ---------------------------------------------------------------------------

function sanitizeShape(raw: unknown, depth: number): LayoutNode | null {
  if (depth > MAX_TREE_DEPTH) return null
  if (!isPlainObject(raw)) return null

  if (raw.type === 'leaf') {
    return isValidPanelId(raw.id) ? { type: 'leaf', id: raw.id } : null
  }

  if (raw.type === 'split') {
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
    if (id === null) return null
    const orientation: Orientation = raw.orientation === 'vertical' ? 'vertical' : 'horizontal'
    const rawChildren = Array.isArray(raw.children) ? raw.children : []
    const rawSizes = Array.isArray(raw.sizes) ? raw.sizes : []

    const survivors: LayoutNode[] = []
    const survivorSizes: number[] = []
    for (let i = 0; i < rawChildren.length; i++) {
      const child = sanitizeShape(rawChildren[i], depth + 1)
      if (child === null) continue
      survivors.push(child)
      const size = rawSizes[i]
      survivorSizes.push(
        typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : Number.NaN
      )
    }

    if (survivors.length === 0) return null
    if (survivors.length === 1) return survivors[0] // 1-child splits collapsed
    const sizes = survivorSizes.some((s) => Number.isNaN(s))
      ? equalSizes(survivors.length)
      : survivorSizes
    return { type: 'split', id, orientation, children: survivors, sizes }
  }

  return null // unknown node kind
}

/**
 * Sanitize a raw (possibly hand-edited or corrupt) layout tree: unknown leaf
 * kinds are dropped, 1-child splits collapse, non-finite/non-positive sizes
 * renormalize (else equal split), recursion is capped at `MAX_TREE_DEPTH`
 * (defends against a cyclic or pathologically deep blob without ever
 * throwing), and duplicate leaf ids anywhere in the tree are deduplicated
 * (first occurrence wins). Anything irrecoverable — not an object, an unknown
 * root node kind, everything pruned away — becomes `null`.
 */
export function sanitizeLayoutTree(raw: unknown): LayoutNode | null {
  const shaped = sanitizeShape(raw, 0)
  if (shaped === null) return null
  return normalizeTree(shaped)
}

function sanitizeVideoFitRecord(value: unknown): Record<string, VideoFitMode> {
  const out: Record<string, VideoFitMode> = {}
  if (!isPlainObject(value)) return out
  for (const [feedId, mode] of Object.entries(value)) {
    if (mode === 'fit' || mode === 'fill') out[feedId] = mode
  }
  return out
}

function sanitizeProfiles(value: unknown): LayoutProfile[] {
  if (!Array.isArray(value)) return []
  const out: LayoutProfile[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) continue
    const name = typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : null
    const tree = sanitizeLayoutTree(entry.tree)
    if (name === null || tree === null) continue
    out.push({ name, tree })
  }
  return out
}

/**
 * Sanitize a raw `PanelLayoutSession`. If `raw` isn't an object, or its `tree`
 * can't be salvaged (see sanitizeLayoutTree), the WHOLE session becomes `null`
 * — the caller substitutes `buildDefaultTree` (this is also what an old
 * (pre-panel-layout) session looks like: no `panelLayout` key at all, so `raw`
 * is `undefined` and this returns `null`). `maximizedPanelId` not present
 * among the sanitized tree's leaves resets to `null`; malformed `videoFit`
 * entries and malformed profiles are dropped individually rather than nulling
 * the whole session.
 */
export function sanitizePanelLayoutSession(raw: unknown): PanelLayoutSession | null {
  if (!isPlainObject(raw)) return null
  const tree = sanitizeLayoutTree(raw.tree)
  if (tree === null) return null

  const leafIds = new Set(collectLeafIds(tree))
  const maximizedPanelId =
    isValidPanelId(raw.maximizedPanelId) && leafIds.has(raw.maximizedPanelId)
      ? raw.maximizedPanelId
      : null

  return {
    tree,
    maximizedPanelId,
    videoFit: sanitizeVideoFitRecord(raw.videoFit),
    profiles: sanitizeProfiles(raw.profiles)
  }
}
