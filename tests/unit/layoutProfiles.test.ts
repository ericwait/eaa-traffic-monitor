import { describe, it, expect } from 'vitest'
import {
  applyProfileByIndex,
  cloneLayoutNode,
  deleteProfile,
  renameProfile,
  saveProfile
} from '@shared/layoutProfiles'
import type {
  LayoutLeaf,
  LayoutProfile,
  LayoutSplit,
  Orientation,
  PanelId
} from '@shared/panelLayout'

// Guardian tests for the named-profile CRUD ops (PR5 of the panel-system
// effort, "snaps" — the named-saved-layouts half; the template-gallery half
// is layoutTemplates.test.ts). Every op follows the same no-op-on-rejection
// discipline as panelLayout.ts's tree ops: an invalid edit returns the EXACT
// SAME array reference rather than a copy, so LayoutManagerModal.tsx/the
// store's profile actions can cheaply detect "nothing happened."

function leaf(id: PanelId): LayoutLeaf {
  return { type: 'leaf', id }
}

function split(
  id: string,
  orientation: Orientation,
  children: LayoutSplit['children']
): LayoutSplit {
  return {
    type: 'split',
    id,
    orientation,
    children,
    sizes: children.map(() => 100 / children.length)
  }
}

function profile(name: string, tree: LayoutSplit | LayoutLeaf): LayoutProfile {
  return { name, tree }
}

describe('cloneLayoutNode', () => {
  it('deep-clones a leaf (a different object, same shape)', () => {
    const original = leaf('audio')
    const clone = cloneLayoutNode(original)
    expect(clone).toEqual(original)
    expect(clone).not.toBe(original)
  })

  it('deep-clones a split: children and sizes are fresh arrays/objects at every level', () => {
    const original = split('root', 'horizontal', [leaf('audio'), leaf('fr24')])
    const clone = cloneLayoutNode(original) as LayoutSplit
    expect(clone).toEqual(original)
    expect(clone).not.toBe(original)
    expect(clone.children).not.toBe(original.children)
    expect(clone.children[0]).not.toBe(original.children[0])
    expect(clone.sizes).not.toBe(original.sizes)

    // Mutating the original after cloning must never disturb the clone —
    // this is the whole point of a profile "snapshot."
    original.sizes[0] = 1
    ;(original.children[0] as LayoutLeaf).id = 'weather'
    expect(clone.sizes[0]).not.toBe(1)
    expect((clone.children[0] as LayoutLeaf).id).toBe('audio')
  })
})

describe('saveProfile', () => {
  it('appends a new profile at the end when the name is new', () => {
    const existing = [profile('A', leaf('audio'))]
    const next = saveProfile(existing, 'B', leaf('fr24'))
    expect(next).toHaveLength(2)
    expect(next[0].name).toBe('A')
    expect(next[1]).toMatchObject({ name: 'B', tree: leaf('fr24') })
  })

  it('trims the name', () => {
    const next = saveProfile([], '  Show Day  ', leaf('audio'))
    expect(next[0].name).toBe('Show Day')
  })

  it('upserts by exact name match — overwrites the existing entry in place rather than appending a duplicate', () => {
    const existing = [profile('A', leaf('audio')), profile('B', leaf('fr24'))]
    const next = saveProfile(existing, 'A', leaf('weather'))
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ name: 'A', tree: leaf('weather') })
    expect(next[1].name).toBe('B') // untouched, still at its own index
  })

  it('stores a deep clone of the tree, not the same reference (and normalizes it)', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')])
    const next = saveProfile([], 'A', tree)
    expect(next[0].tree).not.toBe(tree)
    expect(next[0].tree).toEqual(tree)
  })

  it('is a no-op (same array reference) for a blank/whitespace name', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(saveProfile(existing, '', leaf('fr24'))).toBe(existing)
    expect(saveProfile(existing, '   ', leaf('fr24'))).toBe(existing)
  })
})

describe('renameProfile', () => {
  it('renames the profile at the given index', () => {
    const existing = [profile('A', leaf('audio')), profile('B', leaf('fr24'))]
    const next = renameProfile(existing, 1, 'B2')
    expect(next[0].name).toBe('A')
    expect(next[1].name).toBe('B2')
    expect(next[1].tree).toEqual(existing[1].tree) // tree untouched by a rename
  })

  it('trims the new name', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(renameProfile(existing, 0, '  A2  ')[0].name).toBe('A2')
  })

  it('is a no-op (same array reference) for an out-of-range index', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(renameProfile(existing, 5, 'X')).toBe(existing)
    expect(renameProfile(existing, -1, 'X')).toBe(existing)
  })

  it('is a no-op for a blank/whitespace new name', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(renameProfile(existing, 0, '')).toBe(existing)
    expect(renameProfile(existing, 0, '   ')).toBe(existing)
  })

  it('is a no-op when the name is unchanged', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(renameProfile(existing, 0, 'A')).toBe(existing)
  })

  it('is a no-op when another profile already has that exact name (names stay unique)', () => {
    const existing = [profile('A', leaf('audio')), profile('B', leaf('fr24'))]
    expect(renameProfile(existing, 0, 'B')).toBe(existing)
  })
})

describe('deleteProfile', () => {
  it('removes the entry at the given index, shifting the rest', () => {
    const existing = [
      profile('A', leaf('audio')),
      profile('B', leaf('fr24')),
      profile('C', leaf('weather'))
    ]
    const next = deleteProfile(existing, 1)
    expect(next.map((p) => p.name)).toEqual(['A', 'C'])
  })

  it('is a no-op (same array reference) for an out-of-range index', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(deleteProfile(existing, 5)).toBe(existing)
    expect(deleteProfile(existing, -1)).toBe(existing)
  })
})

describe('applyProfileByIndex', () => {
  it('returns the tree saved at the given index', () => {
    const tree = split('root', 'horizontal', [leaf('audio'), leaf('fr24')])
    const existing = [profile('A', tree)]
    expect(applyProfileByIndex(existing, 0)).toBe(tree)
  })

  it('returns null for an out-of-range index', () => {
    const existing = [profile('A', leaf('audio'))]
    expect(applyProfileByIndex(existing, 5)).toBeNull()
    expect(applyProfileByIndex(existing, -1)).toBeNull()
  })

  it('returns null for an empty profile list', () => {
    expect(applyProfileByIndex([], 0)).toBeNull()
  })
})
