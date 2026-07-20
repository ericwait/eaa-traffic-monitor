import { describe, it, expect } from 'vitest'
import { collectLeafIds, treesEqual, type LayoutSplit, type PanelId } from '@shared/panelLayout'
import {
  instantiateTemplate,
  layoutTemplates,
  VIDEO_REST_ZONE,
  type LayoutTemplate
} from '@shared/layoutTemplates'

// Guardian tests for the snap-template gallery: the catalog shape, and
// instantiateTemplate's zone-substitution rules (docs/Panel-System-Plan.md §
// Key interactions § Snaps) — an unassigned zone collapses out of the tree,
// video-rest becomes a balanced grid of whatever open feed nothing else
// claimed, and every result is a well-formed LayoutNode (or null).

function findTemplate(id: string): LayoutTemplate {
  const template = layoutTemplates.find((t) => t.id === id)
  if (!template) throw new Error(`template ${id} not found in catalog`)
  return template
}

describe('layoutTemplates catalog', () => {
  it('contains exactly the five documented templates', () => {
    expect(layoutTemplates.map((t) => t.id)).toEqual([
      'default',
      '2x2',
      'big-left',
      'tall-right',
      'three-columns'
    ])
  })

  it('every template has a non-empty name and a well-formed zone tree', () => {
    for (const template of layoutTemplates) {
      expect(template.name.length).toBeGreaterThan(0)
      expect(template.tree).toBeDefined()
    }
  })
})

describe('instantiateTemplate — default template', () => {
  it('reproduces the buildDefaultTree shape when every zone is assigned and video-rest gets the open feeds', () => {
    const result = instantiateTemplate(
      findTemplate('default'),
      { audio: 'audio', weather: 'weather', fr24: 'fr24' },
      ['warbirds', 'ultralights']
    )
    expect(collectLeafIds(result)).toEqual([
      'audio',
      'weather',
      'fr24',
      'video:warbirds',
      'video:ultralights'
    ])
  })

  it('an unassigned zone collapses out of the tree', () => {
    const result = instantiateTemplate(
      findTemplate('default'),
      { audio: 'audio', fr24: 'fr24' },
      []
    ) // weather unassigned
    expect(collectLeafIds(result)).toEqual(['audio', 'fr24'])
  })

  it('video-rest excludes feeds already placed by another zone assignment', () => {
    const result = instantiateTemplate(
      findTemplate('default'),
      { audio: 'audio', weather: 'video:warbirds', fr24: 'fr24' }, // 'warbirds' explicitly pinned to the weather zone
      ['warbirds', 'ultralights']
    )
    expect(collectLeafIds(result)).toEqual(
      expect.arrayContaining(['audio', 'video:warbirds', 'fr24', 'video:ultralights'])
    )
    // Only ultralights lands in the video-rest grid — warbirds isn't duplicated.
    const ids = collectLeafIds(result)
    expect(ids.filter((id) => id === 'video:warbirds')).toHaveLength(1)
  })

  it('null when every zone is unassigned and there are no open videos for video-rest', () => {
    expect(instantiateTemplate(findTemplate('default'), {}, [])).toBeNull()
  })

  it('every split in the result sums its sizes to ~100', () => {
    const result = instantiateTemplate(
      findTemplate('default'),
      { audio: 'audio', weather: 'weather', fr24: 'fr24' },
      ['a', 'b', 'c']
    )
    function checkSizes(node: typeof result): void {
      if (!node || node.type === 'leaf') return
      expect(node.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
      for (const child of node.children) checkSizes(child)
    }
    checkSizes(result)
  })
})

describe('instantiateTemplate — geometric templates', () => {
  it('2x2 assigns four zones into a 2-row grid', () => {
    const result = instantiateTemplate(
      findTemplate('2x2'),
      { 'zone-a': 'audio', 'zone-b': 'fr24', 'zone-c': 'weather', 'zone-d': 'video:warbirds' },
      []
    ) as LayoutSplit
    expect(result.orientation).toBe('vertical')
    expect(result.children).toHaveLength(2)
    expect(collectLeafIds(result)).toEqual(['audio', 'fr24', 'weather', 'video:warbirds'])
  })

  it('2x2 with only two zones assigned collapses to a single row (the other row disappears)', () => {
    const result = instantiateTemplate(
      findTemplate('2x2'),
      { 'zone-a': 'audio', 'zone-b': 'fr24' },
      []
    )
    expect(collectLeafIds(result)).toEqual(['audio', 'fr24'])
  })

  it('three-columns assigns three zones side by side', () => {
    const result = instantiateTemplate(
      findTemplate('three-columns'),
      { 'zone-a': 'audio', 'zone-b': 'fr24', 'zone-c': 'weather' },
      []
    ) as LayoutSplit
    expect(result.orientation).toBe('horizontal')
    expect(collectLeafIds(result)).toEqual(['audio', 'fr24', 'weather'])
  })

  it('big-left keeps the big zone whole and stacks the remaining two', () => {
    const result = instantiateTemplate(
      findTemplate('big-left'),
      { 'zone-a': 'fr24', 'zone-b': 'audio', 'zone-c': 'weather' },
      []
    ) as LayoutSplit
    expect(collectLeafIds(result)).toEqual(['fr24', 'audio', 'weather'])
    expect(result.children[0]).toEqual({ type: 'leaf', id: 'fr24' })
  })

  it('a null assignment value behaves the same as an absent one (both collapse the zone)', () => {
    const withNull = instantiateTemplate(findTemplate('three-columns'), { 'zone-a': 'audio', 'zone-b': null, 'zone-c': 'fr24' }, []) // prettier-ignore
    const withAbsent = instantiateTemplate(
      findTemplate('three-columns'),
      { 'zone-a': 'audio', 'zone-c': 'fr24' },
      []
    )
    expect(treesEqual(withNull, withAbsent)).toBe(true)
  })
})

describe('VIDEO_REST_ZONE', () => {
  it('is a stable, well-known zone id (not a PanelId shape) referenced by the default template only', () => {
    expect(VIDEO_REST_ZONE).toBe('video-rest')
    const usesRest = (node: { type: string; zone?: string; children?: unknown[] }): boolean => {
      if (node.type === 'leaf') return node.zone === VIDEO_REST_ZONE
      return (node.children as (typeof node)[]).some(usesRest)
    }
    expect(usesRest(findTemplate('default').tree)).toBe(true)
    expect(usesRest(findTemplate('2x2').tree)).toBe(false)
  })

  it('an all-video-rest assignment balances every open feed the same way buildBalancedGrid would', () => {
    const feeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const result = instantiateTemplate(findTemplate('default'), {}, feeds)
    expect(collectLeafIds(result)).toEqual(feeds.map((f): PanelId => `video:${f}`))
  })
})
