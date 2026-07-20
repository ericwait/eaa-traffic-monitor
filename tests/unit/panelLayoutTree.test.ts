import { describe, it, expect } from 'vitest'
import {
  buildBalancedGrid,
  buildDefaultTree,
  collectLeafIds,
  insertPanelBalanced,
  insertVideoLeafBottom,
  movePanel,
  normalizeTree,
  pruneVideoLeaves,
  removePanel,
  splitPanel,
  swapPanels,
  treesEqual,
  updateSplitSizes,
  type LayoutLeaf,
  type LayoutNode,
  type LayoutSplit,
  type Orientation,
  type PanelId
} from '@shared/panelLayout'

// Guardian tests for the panel-layout split tree's pure ops (the domain model
// PanelCanvas/the store slice will drive in PR2 — this suite is the zero-UI
// contract those consumers build on). Every op is checked for the two things
// that make the canvas architecture work at all (see docs/Panel-System-Plan.md
// § Architecture): it never throws on a stale/absent id, and it never disturbs
// the object identity of a subtree it didn't touch.

function leaf(id: PanelId): LayoutLeaf {
  return { type: 'leaf', id }
}

function split(
  id: string,
  orientation: Orientation,
  children: LayoutNode[],
  sizes: number[]
): LayoutSplit {
  return { type: 'split', id, orientation, children, sizes }
}

describe('collectLeafIds', () => {
  it('returns [] for a null tree', () => {
    expect(collectLeafIds(null)).toEqual([])
  })

  it('returns the single id for a bare leaf', () => {
    expect(collectLeafIds(leaf('fr24'))).toEqual(['fr24'])
  })

  it('walks nested splits in tree order', () => {
    const tree = split(
      'root',
      'horizontal',
      [leaf('audio'), split('right', 'vertical', [leaf('fr24'), leaf('video:warbirds')], [60, 40])],
      [30, 70]
    )
    expect(collectLeafIds(tree)).toEqual(['audio', 'fr24', 'video:warbirds'])
  })
})

describe('normalizeTree', () => {
  it('is idempotent on an already-normal tree, preserving object identity', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    const once = normalizeTree(tree)
    const twice = normalizeTree(once)
    expect(once).toBe(tree)
    expect(twice).toBe(tree)
  })

  it('drops a duplicate leaf id, keeping the first occurrence in tree order', () => {
    const tree = split(
      'root',
      'horizontal',
      [leaf('audio'), split('dup', 'vertical', [leaf('audio'), leaf('fr24')], [50, 50])],
      [30, 70]
    )
    const result = normalizeTree(tree)
    expect(collectLeafIds(result)).toEqual(['audio', 'fr24'])
    // The duplicate's split collapsed to its one surviving child.
    expect(result).toEqual(split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [30, 70]))
  })

  it('collapses a 1-child split into its child', () => {
    const tree = split('lonely', 'horizontal', [leaf('fr24')], [100])
    expect(normalizeTree(tree)).toEqual(leaf('fr24'))
  })

  it('renormalizes sizes that do not sum to 100', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [10, 10])
    const result = normalizeTree(tree) as LayoutSplit
    expect(result.sizes[0] + result.sizes[1]).toBeCloseTo(100, 5)
    expect(result.sizes[0]).toBeCloseTo(50, 5)
  })

  it('replaces non-finite/non-positive sizes with an equal split', () => {
    const tree = split(
      'root',
      'horizontal',
      [leaf('audio'), leaf('fr24'), leaf('weather')],
      [Number.NaN, 50, -5]
    )
    const result = normalizeTree(tree) as LayoutSplit
    expect(result.sizes[0]).toBeCloseTo(100 / 3, 9)
    expect(result.sizes[1]).toBeCloseTo(100 / 3, 9)
    expect(result.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9)
  })

  it('preserves the reference of an untouched sibling subtree', () => {
    const untouched = split('untouched', 'vertical', [leaf('fr24'), leaf('weather')], [60, 40])
    const tree = split(
      'root',
      'horizontal',
      [split('dup', 'vertical', [leaf('audio'), leaf('audio')], [50, 50]), untouched],
      [30, 70]
    )
    const result = normalizeTree(tree) as LayoutSplit
    expect(result.children[1]).toBe(untouched)
  })
})

describe('removePanel', () => {
  it('removing the last leaf yields null', () => {
    expect(removePanel(leaf('fr24'), 'fr24')).toBeNull()
  })

  it('collapses the parent split when one child remains', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(removePanel(tree, 'audio')).toEqual(leaf('fr24'))
  })

  it('is a no-op (same reference) for an id not in the tree', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(removePanel(tree, 'weather')).toBe(tree)
  })

  it('preserves the reference of a sibling subtree untouched by the removal', () => {
    const untouched = split('untouched', 'vertical', [leaf('fr24'), leaf('weather')], [60, 40])
    const tree = split(
      'root',
      'horizontal',
      [split('left', 'vertical', [leaf('audio'), leaf('video:a')], [50, 50]), untouched],
      [30, 70]
    )
    const result = removePanel(tree, 'video:a') as LayoutSplit
    expect(result.children[1]).toBe(untouched)
  })
})

describe('pruneVideoLeaves', () => {
  it('passes through a null tree', () => {
    expect(pruneVideoLeaves(null, ['warbirds'])).toBeNull()
  })

  it('drops video leaves whose feed id is not allowed, keeps every non-video leaf', () => {
    const tree = split(
      'root',
      'horizontal',
      [leaf('audio'), leaf('weather'), leaf('fr24'), leaf('video:warbirds'), leaf('video:stale')],
      [20, 10, 40, 15, 15]
    )
    const result = pruneVideoLeaves(tree, new Set(['warbirds']))
    expect(collectLeafIds(result)).toEqual(['audio', 'weather', 'fr24', 'video:warbirds'])
  })

  it('an emptied tree (every leaf pruned) becomes null', () => {
    const tree = split('grid', 'horizontal', [leaf('video:a'), leaf('video:b')], [50, 50])
    expect(pruneVideoLeaves(tree, [])).toBeNull()
  })

  it('accepts a plain array of allowed ids as well as a Set', () => {
    const tree = split('grid', 'horizontal', [leaf('video:a'), leaf('video:b')], [50, 50])
    expect(collectLeafIds(pruneVideoLeaves(tree, ['a']))).toEqual(['video:a'])
  })
})

describe('splitPanel', () => {
  it('splits a leaf into a 2-child split on the requested edge, sized by sharePct', () => {
    const tree = leaf('fr24')
    const result = splitPanel(tree, 'fr24', leaf('video:a'), 'right', 30) as LayoutSplit
    expect(result.type).toBe('split')
    expect(result.orientation).toBe('horizontal')
    expect(result.children).toEqual([leaf('fr24'), leaf('video:a')])
    expect(result.sizes).toEqual([70, 30])
  })

  it('puts the new leaf first for left/top edges', () => {
    const top = splitPanel(leaf('fr24'), 'fr24', leaf('weather'), 'top', 25) as LayoutSplit
    expect(top.orientation).toBe('vertical')
    expect(top.children).toEqual([leaf('weather'), leaf('fr24')])
    expect(top.sizes).toEqual([25, 75])
  })

  it('is a no-op (same reference) when the target id is absent', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(splitPanel(tree, 'weather', leaf('video:a'), 'right')).toBe(tree)
  })

  it('preserves sibling references and assigns a fresh, collision-free split id', () => {
    const sibling = leaf('weather')
    const tree = split('root', 'horizontal', [sibling, leaf('fr24')], [22, 78])
    const result = splitPanel(tree, 'fr24', leaf('video:a'), 'bottom', 40) as LayoutSplit
    expect(result.children[0]).toBe(sibling)
    const inner = result.children[1] as LayoutSplit
    expect(inner.id).toMatch(/^split-\d+$/)
    expect(inner.id).not.toBe('root')
  })

  it('clamps an out-of-range sharePct into [1, 99]', () => {
    const zero = splitPanel(leaf('fr24'), 'fr24', leaf('weather'), 'right', 0) as LayoutSplit
    expect(zero.sizes[1]).toBe(1)
    const huge = splitPanel(leaf('fr24'), 'fr24', leaf('weather'), 'right', 500) as LayoutSplit
    expect(huge.sizes[1]).toBe(99)
  })
})

describe('swapPanels', () => {
  it('exchanges the two leaves in place', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    const result = swapPanels(tree, 'audio', 'fr24') as LayoutSplit
    expect(result.children).toEqual([leaf('fr24'), leaf('audio')])
    expect(result.sizes).toEqual([22, 78]) // positions swap, sizes stay put
  })

  it('is a no-op (same reference) for the same id twice, or an absent id', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(swapPanels(tree, 'audio', 'audio')).toBe(tree)
    expect(swapPanels(tree, 'audio', 'weather')).toBe(tree)
  })

  it('preserves the reference of a subtree containing neither swapped leaf', () => {
    const untouched = split('untouched', 'vertical', [leaf('fr24'), leaf('weather')], [60, 40])
    const tree = split(
      'root',
      'horizontal',
      [split('left', 'vertical', [leaf('audio'), leaf('video:a')], [50, 50]), untouched],
      [30, 70]
    )
    const result = swapPanels(tree, 'audio', 'video:a') as LayoutSplit
    expect(result.children[1]).toBe(untouched)
  })
})

describe('movePanel', () => {
  function sampleTree(): LayoutSplit {
    return split(
      'root',
      'horizontal',
      [
        split('left', 'vertical', [leaf('audio'), leaf('weather')], [70, 30]),
        split('right', 'vertical', [leaf('fr24'), leaf('video:a')], [62, 38])
      ],
      [22, 78]
    )
  }

  it('moving a panel onto itself is the identity (same reference)', () => {
    const tree = sampleTree()
    expect(movePanel(tree, 'audio', { kind: 'panel', targetId: 'audio', zone: 'right' })).toBe(tree)
    expect(movePanel(tree, 'audio', { kind: 'panel', targetId: 'audio', zone: 'center' })).toBe(
      tree
    )
  })

  it('is a no-op for an id absent from the tree or a stale target', () => {
    const tree = sampleTree()
    expect(movePanel(tree, 'video:ghost', { kind: 'panel', targetId: 'fr24', zone: 'right' })).toBe(
      tree
    )
    expect(
      movePanel(tree, 'audio', { kind: 'panel', targetId: 'video:ghost', zone: 'right' })
    ).toBe(tree)
  })

  it('a center-zone drop swaps the two panels', () => {
    const tree = sampleTree()
    const result = movePanel(tree, 'weather', { kind: 'panel', targetId: 'fr24', zone: 'center' })
    expect(treesEqual(result, swapPanels(tree, 'weather', 'fr24'))).toBe(true)
  })

  it('an edge drop removes the panel from its old spot and splits it in beside the target, preserving untouched-subtree references', () => {
    const tree = sampleTree()
    const result = movePanel(tree, 'weather', { kind: 'panel', targetId: 'fr24', zone: 'right' })
    expect(collectLeafIds(result)).toEqual(
      expect.arrayContaining(['audio', 'weather', 'fr24', 'video:a'])
    )
    // 'audio' was weather's sibling; removing weather collapses `left` down to
    // the bare 'audio' leaf, which never needed to change identity-wise.
    const resultSplit = result as LayoutSplit
    const leftSide = resultSplit.children.find(
      (c): c is LayoutLeaf => c.type === 'leaf' && c.id === 'audio'
    )
    expect(leftSide).toBeDefined()
  })

  it('root-edge docking wraps the tree in a new outer split at the documented 25% share', () => {
    const tree = sampleTree()
    const result = movePanel(tree, 'weather', { kind: 'root', edge: 'left' }) as LayoutSplit
    expect(result.orientation).toBe('horizontal')
    expect(result.sizes).toEqual([25, 75])
    expect((result.children[0] as LayoutLeaf).id).toBe('weather')
  })

  it('root docking on the only remaining leaf is a no-op', () => {
    expect(movePanel(leaf('fr24'), 'fr24', { kind: 'root', edge: 'top' })).toEqual(leaf('fr24'))
  })
})

describe('insertPanelBalanced', () => {
  it('a null tree becomes just the new leaf', () => {
    expect(insertPanelBalanced(null, leaf('audio'))).toEqual(leaf('audio'))
  })

  it('an id already present is a no-op (same reference)', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(insertPanelBalanced(tree, leaf('audio'))).toBe(tree)
  })

  it('wraps a bare leaf 50/50 when there is no all-leaf group to join', () => {
    const result = insertPanelBalanced(leaf('fr24'), leaf('weather')) as LayoutSplit
    expect(result.children).toEqual([leaf('fr24'), leaf('weather')])
    expect(result.sizes).toEqual([50, 50])
  })

  it('joins the largest all-leaf group and rebalances it to equal shares', () => {
    const smallGroup = split('small', 'horizontal', [leaf('video:a'), leaf('video:b')], [50, 50])
    const bigGroup = split(
      'big',
      'horizontal',
      [leaf('video:c'), leaf('video:d'), leaf('video:e')],
      [34, 33, 33]
    )
    const tree = split('root', 'vertical', [smallGroup, bigGroup], [40, 60])
    const result = insertPanelBalanced(tree, leaf('video:f')) as LayoutSplit
    const joined = result.children[1] as LayoutSplit
    expect(joined.id).toBe('big')
    expect(collectLeafIds(joined)).toEqual(['video:c', 'video:d', 'video:e', 'video:f'])
    expect(joined.sizes).toEqual([25, 25, 25, 25])
    // The smaller, untouched group keeps its exact reference.
    expect(result.children[0]).toBe(smallGroup)
  })
})

describe('insertVideoLeafBottom', () => {
  // Mirrors docs/Panel-System-Plan.md's default tree shape: an audio/weather
  // left column, fr24 + a video grid on the right.
  function sampleTree(videoNode: LayoutNode): LayoutSplit {
    return split(
      'default-root',
      'horizontal',
      [
        split('default-audio-weather', 'vertical', [leaf('audio'), leaf('weather')], [70, 30]),
        split('default-right', 'vertical', [leaf('fr24'), videoNode], [62, 38])
      ],
      [22, 78]
    )
  }

  it('a null tree becomes just the new leaf', () => {
    expect(insertVideoLeafBottom(null, leaf('video:a'))).toEqual(leaf('video:a'))
  })

  it('an id already present is a no-op (same reference)', () => {
    const tree = sampleTree(leaf('video:a'))
    expect(insertVideoLeafBottom(tree, leaf('video:a'))).toBe(tree)
  })

  it("the bug this replaces: a single remaining video feed is a bare leaf (not a split), so insertPanelBalanced's largest-all-leaf-group heuristic would join the audio/weather pair instead — insertVideoLeafBottom must never do that", () => {
    const tree = sampleTree(leaf('video:a'))
    // Confirm the premise: this is exactly the shape that fools insertPanelBalanced.
    const wrongWay = insertPanelBalanced(tree, leaf('video:b')) as LayoutSplit
    const wrongLeft = wrongWay.children[0] as LayoutSplit
    expect(collectLeafIds(wrongLeft)).toEqual(['audio', 'weather', 'video:b']) // the bug

    const result = insertVideoLeafBottom(tree, leaf('video:b')) as LayoutSplit
    const left = result.children[0] as LayoutSplit
    const right = result.children[1] as LayoutSplit
    expect(collectLeafIds(left)).toEqual(['audio', 'weather']) // untouched
    expect(collectLeafIds(right)).toEqual(['fr24', 'video:a', 'video:b'])
    const videoRegion = right.children[1] as LayoutSplit
    expect(collectLeafIds(videoRegion)).toEqual(['video:a', 'video:b'])
  })

  it('joins the existing video region and lands the new leaf in the bottom row, never the left column or paired with fr24 as a leaf', () => {
    // 3 existing feeds (one row: ceil(sqrt(3)) = 2 rows, [2,1]) + a 4th
    // returning feed makes 4 (2 rows of 2) — the new feed must land in the
    // LAST row.
    const videoGrid = buildBalancedGrid(['video:a', 'video:b', 'video:c'])!
    const tree = sampleTree(videoGrid)
    const result = insertVideoLeafBottom(tree, leaf('video:d')) as LayoutSplit

    const left = result.children[0] as LayoutSplit
    expect(collectLeafIds(left)).toEqual(['audio', 'weather']) // untouched left column

    const right = result.children[1] as LayoutSplit
    expect((right.children[0] as LayoutLeaf).id).toBe('fr24') // fr24 untouched, still on top

    const newVideoRegion = right.children[1] as LayoutSplit
    expect(newVideoRegion.orientation).toBe('vertical') // rows stacked
    const rows = newVideoRegion.children as LayoutSplit[]
    const bottomRow = rows[rows.length - 1]
    expect(collectLeafIds(bottomRow)).toContain('video:d')
    // Matches a from-scratch buildBalancedGrid over the same 4 feeds.
    expect(
      treesEqual(newVideoRegion, buildBalancedGrid(['video:a', 'video:b', 'video:c', 'video:d']))
    ).toBe(true)
  })

  it('no existing video leaves: docks the new leaf as a new outermost bottom row rather than guessing a location', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    const result = insertVideoLeafBottom(tree, leaf('video:a')) as LayoutSplit
    expect(result.orientation).toBe('vertical')
    expect((result.children[1] as LayoutLeaf).id).toBe('video:a')
    expect(result.children[0]).toBe(tree) // the whole prior tree is untouched, just relocated as the top sibling
  })
})

describe('updateSplitSizes', () => {
  it('an epsilon-equal request returns the exact same tree reference', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(updateSplitSizes(tree, 'root', [22.001, 77.999])).toBe(tree)
  })

  it('a real change updates just the targeted split, preserving sibling references', () => {
    const untouched = split('untouched', 'vertical', [leaf('fr24'), leaf('weather')], [60, 40])
    const tree = split('root', 'horizontal', [leaf('audio'), untouched], [22, 78])
    const result = updateSplitSizes(tree, 'root', [30, 70]) as LayoutSplit
    expect(result.sizes).toEqual([30, 70])
    expect(result.children[1]).toBe(untouched)
    expect(result).not.toBe(tree)
  })

  it('is a no-op for an unknown split id or a size-count mismatch', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(updateSplitSizes(tree, 'nope', [50, 50])).toBe(tree)
    expect(updateSplitSizes(tree, 'root', [33, 33, 34])).toBe(tree)
  })
})

describe('buildBalancedGrid', () => {
  it('null for an empty list, a bare leaf for one item', () => {
    expect(buildBalancedGrid([])).toBeNull()
    expect(buildBalancedGrid(['video:a'] as PanelId[])).toEqual(leaf('video:a'))
  })

  it.each([
    [2, [1, 1]],
    [3, [2, 1]],
    [4, [2, 2]],
    [5, [2, 2, 1]],
    [6, [2, 2, 2]],
    [7, [3, 2, 2]],
    [8, [3, 3, 2]],
    [9, [3, 3, 3]]
  ])('n=%i lays out rows of %j items', (n, expectedRowCounts) => {
    const ids = Array.from({ length: n }, (_, i) => `video:${i}` as PanelId)
    const grid = buildBalancedGrid(ids)
    expect(collectLeafIds(grid)).toEqual(ids) // every id present, none dropped, tree order preserved

    if (expectedRowCounts.length === 1) {
      // A single row collapses straight to that row's own node.
      expect(grid?.type).toBe(n === 1 ? 'leaf' : 'split')
    } else {
      const rows = grid as LayoutSplit
      expect(rows.orientation).toBe('vertical')
      expect(rows.children).toHaveLength(expectedRowCounts.length)
      const actualRowCounts = rows.children.map((row) =>
        row.type === 'leaf' ? 1 : row.children.length
      )
      expect(actualRowCounts).toEqual(expectedRowCounts)
    }
  })

  it('every row and the outer grid sum their sizes to 100', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `video:${i}` as PanelId)
    const rows = buildBalancedGrid(ids) as LayoutSplit
    expect(rows.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
    for (const row of rows.children) {
      if (row.type === 'split') expect(row.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
    }
  })
})

describe('buildDefaultTree', () => {
  it("mirrors today's 22/78 left/right and 62/38 fr24/video split, with weather below audio", () => {
    const tree = buildDefaultTree(['warbirds', 'ultralights']) as LayoutSplit
    expect(tree.orientation).toBe('horizontal')
    expect(tree.sizes).toEqual([22, 78])

    const leftCol = tree.children[0] as LayoutSplit
    expect(leftCol.orientation).toBe('vertical')
    expect(collectLeafIds(leftCol)).toEqual(['audio', 'weather'])

    const rightCol = tree.children[1] as LayoutSplit
    expect(rightCol.orientation).toBe('vertical')
    expect(rightCol.sizes).toEqual([62, 38])
    expect((rightCol.children[0] as LayoutLeaf).id).toBe('fr24')
    expect(collectLeafIds(rightCol.children[1])).toEqual(['video:warbirds', 'video:ultralights'])
  })

  it('matches the seven-feed scrape shape (rows of [3, 2, 2])', () => {
    const feeds = [
      'warbirds',
      'ultralights',
      'seaplane-base',
      'green-dot',
      'vintage',
      'boeing-plaza',
      'featured'
    ]
    const tree = buildDefaultTree(feeds) as LayoutSplit
    const videoGrid = (tree.children[1] as LayoutSplit).children[1] as LayoutSplit
    expect(
      videoGrid.children.map((row) => (row.type === 'leaf' ? 1 : row.children.length))
    ).toEqual([3, 2, 2])
  })

  it('collapses the right column to a bare fr24 leaf when there are no video feeds', () => {
    const tree = buildDefaultTree([]) as LayoutSplit
    expect(tree.children[1]).toEqual(leaf('fr24'))
  })

  it('every leaf id is unique and every split sums its sizes to 100', () => {
    const tree = buildDefaultTree(['a', 'b', 'c'])
    const ids = collectLeafIds(tree)
    expect(new Set(ids).size).toBe(ids.length)
    expect(treesEqual(tree, normalizeTree(tree))).toBe(true) // already fully normal
  })
})

describe('treesEqual', () => {
  it('is true for the same reference and for structurally identical-but-distinct trees', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    const clone = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(treesEqual(tree, tree)).toBe(true)
    expect(treesEqual(tree, clone)).toBe(true)
  })

  it('is false for a different id, orientation, child order, or size', () => {
    const base = split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78])
    expect(
      treesEqual(base, split('other', 'horizontal', [leaf('audio'), leaf('fr24')], [22, 78]))
    ).toBe(false)
    expect(
      treesEqual(base, split('root', 'vertical', [leaf('audio'), leaf('fr24')], [22, 78]))
    ).toBe(false)
    expect(
      treesEqual(base, split('root', 'horizontal', [leaf('fr24'), leaf('audio')], [22, 78]))
    ).toBe(false)
    expect(
      treesEqual(base, split('root', 'horizontal', [leaf('audio'), leaf('fr24')], [50, 50]))
    ).toBe(false)
  })

  it('treats null vs a tree as unequal, and null vs null as equal', () => {
    expect(treesEqual(null, null)).toBe(true)
    expect(treesEqual(null, leaf('fr24'))).toBe(false)
    expect(treesEqual(leaf('fr24'), null)).toBe(false)
  })
})
