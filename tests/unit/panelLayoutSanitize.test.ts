import { describe, it, expect } from 'vitest'
import { collectLeafIds, sanitizeLayoutTree, sanitizePanelLayoutSession } from '@shared/panelLayout'
import { sanitizeSessionState } from '@shared/session'

// Guardian tests for the never-throw panel-layout sanitizers (see
// docs/Panel-System-Plan.md § Data model and persistence): a hand-edited or
// corrupt session.json must never crash a relaunch. Every case here degrades
// to null/a default rather than throwing — the reliability mandate this
// suite exists to hold the line on (same mandate as src/shared/session.ts).

describe('sanitizeLayoutTree', () => {
  it('never throws on garbage input, and returns null', () => {
    for (const garbage of [null, undefined, 42, 'nope', true, [], {}, { type: 'wat' }]) {
      expect(() => sanitizeLayoutTree(garbage)).not.toThrow()
      expect(sanitizeLayoutTree(garbage)).toBeNull()
    }
  })

  it('keeps a well-formed tree unchanged', () => {
    const tree = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'fr24' }
      ],
      sizes: [22, 78]
    }
    expect(sanitizeLayoutTree(tree)).toEqual(tree)
  })

  it('drops a leaf with an unrecognized/malformed id', () => {
    const tree = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'not-a-real-panel' },
        { type: 'leaf', id: 42 },
        { type: 'leaf' } // no id at all
      ],
      sizes: [25, 25, 25, 25]
    }
    expect(collectLeafIds(sanitizeLayoutTree(tree))).toEqual(['audio'])
  })

  it('accepts a well-formed video: leaf id', () => {
    const tree = { type: 'leaf', id: 'video:warbirds' }
    expect(sanitizeLayoutTree(tree)).toEqual(tree)
  })

  it('drops duplicate leaves anywhere in the tree, keeping the first occurrence', () => {
    const tree = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        {
          type: 'split',
          id: 'right',
          orientation: 'vertical',
          children: [
            { type: 'leaf', id: 'audio' }, // duplicate — dropped
            { type: 'leaf', id: 'fr24' }
          ],
          sizes: [50, 50]
        }
      ],
      sizes: [30, 70]
    }
    const result = sanitizeLayoutTree(tree)
    expect(collectLeafIds(result)).toEqual(['audio', 'fr24'])
  })

  it('collapses a 1-child split (whether given that way, or after a bad sibling is dropped)', () => {
    const givenDirectly = { type: 'split', id: 'lonely', orientation: 'horizontal', children: [{ type: 'leaf', id: 'fr24' }], sizes: [100] } // prettier-ignore
    expect(sanitizeLayoutTree(givenDirectly)).toEqual({ type: 'leaf', id: 'fr24' })

    const afterPruning = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'fr24' },
        { type: 'leaf', id: 'garbage-id' }
      ],
      sizes: [50, 50]
    }
    expect(sanitizeLayoutTree(afterPruning)).toEqual({ type: 'leaf', id: 'fr24' })
  })

  it('renormalizes bad sizes (wrong length, non-finite, negative) to an equal split rather than rejecting the tree', () => {
    const tree = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'weather' },
        { type: 'leaf', id: 'fr24' }
      ],
      sizes: [50, Number.NaN] // too short AND contains a non-finite entry
    }
    const result = sanitizeLayoutTree(tree) as { sizes: number[] }
    expect(result.sizes).toHaveLength(3)
    expect(result.sizes.every((s) => Number.isFinite(s) && s > 0)).toBe(true)
    expect(result.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
  })

  it('defaults an unrecognized orientation rather than rejecting the split', () => {
    const tree = {
      type: 'split',
      id: 'root',
      orientation: 'diagonal',
      children: [
        { type: 'leaf', id: 'audio' },
        { type: 'leaf', id: 'fr24' }
      ],
      sizes: [50, 50]
    }
    const result = sanitizeLayoutTree(tree) as { orientation: string }
    expect(result.orientation).toBe('horizontal')
  })

  it('never throws and terminates on a pathologically deep (or effectively cyclic) chain — a depth bomb sanitizes to null', () => {
    // A 500-level-deep chain of single-child splits, each wrapping the next.
    // Every level is individually well-formed; only the NESTING depth is
    // pathological, so this specifically exercises the recursion depth cap
    // rather than any per-node validation.
    let bomb: unknown = { type: 'leaf', id: 'fr24' }
    for (let i = 0; i < 500; i++) {
      bomb = {
        type: 'split',
        id: `d${i}`,
        orientation: 'horizontal',
        children: [bomb],
        sizes: [100]
      }
    }
    expect(() => sanitizeLayoutTree(bomb)).not.toThrow()
    // The cap bails the whole branch out past MAX_TREE_DEPTH, so the entire
    // chain (being one single-child path with nothing else) collapses to null
    // rather than silently truncating to some arbitrary partial tree — a safe,
    // well-defined degradation (the caller substitutes buildDefaultTree).
    expect(sanitizeLayoutTree(bomb)).toBeNull()
  })

  it('a shallow, legitimate nesting depth (well under the cap) survives fully intact', () => {
    let tree: unknown = { type: 'leaf', id: 'fr24' }
    for (let i = 0; i < 5; i++) {
      tree = {
        type: 'split',
        id: `s${i}`,
        orientation: 'horizontal',
        children: [{ type: 'leaf', id: `video:${i}` }, tree],
        sizes: [50, 50]
      }
    }
    const result = sanitizeLayoutTree(tree)
    expect(collectLeafIds(result)).toHaveLength(6) // 5 video leaves + fr24
  })
})

describe('sanitizePanelLayoutSession', () => {
  it('is null for garbage (non-object) input', () => {
    for (const garbage of [null, undefined, 42, 'nope', [], true]) {
      expect(() => sanitizePanelLayoutSession(garbage)).not.toThrow()
      expect(sanitizePanelLayoutSession(garbage)).toBeNull()
    }
  })

  it('is null when the tree itself is unsalvageable, even if other fields are fine', () => {
    const result = sanitizePanelLayoutSession({
      tree: { type: 'nonsense' },
      maximizedPanelId: 'fr24',
      videoFit: { warbirds: 'fill' },
      profiles: []
    })
    expect(result).toBeNull()
  })

  it('a legacy (pre-panel-canvas) session fixture sanitizes to panelLayout: null, with every surviving section intact', () => {
    // What a session.json written by an older (pre-PR2) build actually looks
    // like: `layout` (react-resizable-panels' own LayoutStorage strings) and a
    // top-level `video` (VideoLayoutState), and no `panelLayout` key at all.
    // Migration is drop-and-default (see @shared/ipc's SessionState.panelLayout
    // doc): those two legacy keys are simply no longer read, rather than
    // crashing the sanitizer. Run it through the FULL session sanitizer (not
    // just this module) so "everything else intact" is actually checked.
    const legacyFixture = {
      fr24: { lastUrl: 'https://www.flightradar24.com/x' },
      audio: { devices: { tower: { deviceId: 'abc', deviceLabel: 'Headphones' } }, streams: {} },
      window: { x: 10, y: 20, width: 1280, height: 800, displayId: 2 },
      layout: { 'group:cols': '{"atc":22}' },
      video: { mode: 'emphasized', emphasizedFeedId: 'warbirds', fillPanelFeedId: null },
      popouts: []
      // panelLayout intentionally absent — this is the shape of every session.json written before this PR.
    }
    const result = sanitizeSessionState(legacyFixture)
    expect(result.panelLayout).toBeNull()
    expect(result.fr24).toEqual(legacyFixture.fr24)
    expect(result.audio).toEqual(legacyFixture.audio)
    expect(result.window).toEqual(legacyFixture.window)
    expect(result.popouts).toEqual(legacyFixture.popouts)
    // The removed legacy keys are gone from the sanitized shape, not carried through.
    expect(result).not.toHaveProperty('layout')
    expect(result).not.toHaveProperty('video')
  })

  it('keeps a well-formed session fully intact', () => {
    const raw = {
      tree: {
        type: 'split',
        id: 'root',
        orientation: 'horizontal',
        children: [
          { type: 'leaf', id: 'audio' },
          { type: 'leaf', id: 'fr24' }
        ],
        sizes: [22, 78]
      },
      maximizedPanelId: 'fr24',
      videoFit: { warbirds: 'fill', stale: 'nonsense' },
      profiles: [
        { name: 'Air show', tree: { type: 'leaf', id: 'fr24' } },
        { name: 42, tree: { type: 'leaf', id: 'audio' } }, // bad name — dropped
        { name: 'Broken', tree: { type: 'nonsense' } } // bad tree — dropped
      ]
    }
    const result = sanitizePanelLayoutSession(raw)!
    expect(result.tree).toEqual(raw.tree)
    expect(result.maximizedPanelId).toBe('fr24')
    expect(result.videoFit).toEqual({ warbirds: 'fill' }) // 'nonsense' dropped, not defaulted
    expect(result.profiles).toEqual([{ name: 'Air show', tree: { type: 'leaf', id: 'fr24' } }])
  })

  it('resets maximizedPanelId to null when it does not name a leaf actually in the (sanitized) tree', () => {
    const raw = {
      tree: { type: 'leaf', id: 'fr24' },
      maximizedPanelId: 'video:warbirds', // not in the tree
      videoFit: {},
      profiles: []
    }
    expect(sanitizePanelLayoutSession(raw)!.maximizedPanelId).toBeNull()
  })

  it('defaults missing videoFit/profiles to empty rather than rejecting the session', () => {
    const result = sanitizePanelLayoutSession({ tree: { type: 'leaf', id: 'fr24' } })!
    expect(result.videoFit).toEqual({})
    expect(result.profiles).toEqual([])
    expect(result.maximizedPanelId).toBeNull()
  })
})
