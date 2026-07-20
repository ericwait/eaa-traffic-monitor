import { describe, it, expect } from 'vitest'
import {
  defaultSessionState,
  sanitizeSessionState,
  applySessionPatch,
  upsertPopout,
  removePopout,
  patchPopout,
  mergePopouts,
  nextPopoutId,
  poppedOutFeedIds,
  popoutSummaries
} from '@shared/session'
import {
  buildBalancedGrid,
  collectLeafIds,
  insertVideoLeafBottom,
  type PanelId
} from '@shared/panelLayout'
import type { PopoutState, SessionState, WindowBoundsState } from '@shared/ipc'

// The full session restore contract lives here — the merge and pop-out
// bookkeeping the app depends on for "relaunch reproduces the entire setup",
// exercised without electron-store or a BrowserWindow. The reliability mandate
// is a first-class assertion: no malformed input may throw or crash a relaunch.

function bounds(
  x = 0,
  y = 0,
  width = 800,
  height = 600,
  displayId: number | null = 1
): WindowBoundsState {
  return { x, y, width, height, displayId }
}

/** `video:${feedId}` as a typed PanelId — avoids a cast at every call site below. */
function videoLeaf(feedId: string): PanelId {
  return `video:${feedId}`
}

/**
 * A well-formed pop-out slice — decision 2026-07-20: `tree` is a fresh
 * balanced grid over `feedIds` (the panel canvas's own leaf shape, same as a
 * from-scratch main-window video region), replacing the old `video:
 * VideoLayoutState` field. Mirrors `main/popouts.ts`'s `openPopout`.
 */
function popout(id: number, feedIds: string[]): PopoutState {
  return {
    id,
    bounds: bounds(),
    feedIds,
    tree: buildBalancedGrid(feedIds.map(videoLeaf)),
    videoFit: {},
    volumes: {}
  }
}

describe('defaultSessionState', () => {
  it('is fully formed and a fresh object each call', () => {
    const a = defaultSessionState()
    const b = defaultSessionState()
    expect(a).toEqual({
      fr24: { lastUrl: null },
      audio: { devices: {}, streams: {} },
      window: null,
      panelLayout: null,
      popouts: [],
      theme: 'system'
    })
    expect(a).not.toBe(b)
    expect(a.audio).not.toBe(b.audio)
  })
})

describe('sanitizeSessionState', () => {
  it('returns defaults for a non-object (null / string / number)', () => {
    expect(sanitizeSessionState(null)).toEqual(defaultSessionState())
    expect(sanitizeSessionState('nope')).toEqual(defaultSessionState())
    expect(sanitizeSessionState(42)).toEqual(defaultSessionState())
  })

  it('keeps well-formed sections and drops malformed entries per-key', () => {
    const raw = {
      fr24: { lastUrl: 'https://www.flightradar24.com/x' },
      audio: {
        devices: {
          tower: { deviceId: 'abc', deviceLabel: 'Headphones' },
          bad: { deviceId: 123 } // wrong type → dropped
        },
        streams: {
          tower: { volume: 0.5, muted: true, pan: -0.3 },
          gnd: { volume: 'loud' } // volume wrong type → object kept, field dropped
        }
      },
      window: { x: 10, y: 20, width: 1280, height: 800, displayId: 2 },
      popouts: [
        // Legacy shape (no tree/videoFit, an old `video` field instead) — see
        // the dedicated migration tests below for what this becomes.
        { id: 1, bounds: bounds(100, 100), feedIds: ['warbirds'], video: {}, volumes: {} },
        { id: 2 } // no bounds → dropped
      ]
    }
    const s = sanitizeSessionState(raw)
    expect(s.fr24.lastUrl).toBe('https://www.flightradar24.com/x')
    expect(s.audio.devices).toEqual({ tower: { deviceId: 'abc', deviceLabel: 'Headphones' } })
    expect(s.audio.streams).toEqual({ tower: { volume: 0.5, muted: true, pan: -0.3 }, gnd: {} })
    expect(s.window).toEqual({ x: 10, y: 20, width: 1280, height: 800, displayId: 2 })
    expect(s.popouts).toHaveLength(1)
    expect(s.popouts[0].id).toBe(1)
  })

  it('clamps out-of-range volumes/pans', () => {
    const s = sanitizeSessionState({
      audio: { streams: { a: { volume: 5, pan: -9 } } }
    })
    expect(s.audio.streams.a).toEqual({ volume: 1, pan: -1 })
  })

  it('keeps a boolean connected flag (on-demand set) and drops a non-boolean one', () => {
    const s = sanitizeSessionState({
      audio: {
        streams: {
          tower: { connected: true, volume: 0.5 },
          gnd: { connected: 'yes' } // wrong type → field dropped, object kept
        }
      }
    })
    expect(s.audio.streams.tower).toEqual({ connected: true, volume: 0.5 })
    expect(s.audio.streams.gnd).toEqual({})
  })

  it('nulls a window with a non-finite dimension rather than restoring garbage', () => {
    const s = sanitizeSessionState({ window: { x: 0, y: 0, width: Infinity, height: 600 } })
    expect(s.window).toBeNull()
  })

  it('defaults a missing displayId to null but keeps valid bounds', () => {
    const s = sanitizeSessionState({ window: { x: 5, y: 6, width: 700, height: 500 } })
    expect(s.window).toEqual({ x: 5, y: 6, width: 700, height: 500, displayId: null })
  })

  it('panelLayout is null when absent (every pre-existing session.json)', () => {
    expect(sanitizeSessionState({}).panelLayout).toBeNull()
  })

  it('sanitizes a well-formed panelLayout section, leaving the other sections untouched', () => {
    const s = sanitizeSessionState({
      fr24: { lastUrl: 'https://x' },
      panelLayout: {
        tree: { type: 'leaf', id: 'fr24' },
        maximizedPanelId: 'fr24',
        videoFit: { warbirds: 'fill' },
        profiles: []
      }
    })
    expect(s.panelLayout).toEqual({
      tree: { type: 'leaf', id: 'fr24' },
      maximizedPanelId: 'fr24',
      videoFit: { warbirds: 'fill' },
      profiles: []
    })
    expect(s.fr24.lastUrl).toBe('https://x')
  })

  it('ignores the removed legacy layout/video keys rather than choking on them (an old session.json still has them until its next flush)', () => {
    const s = sanitizeSessionState({
      fr24: { lastUrl: 'https://x' },
      layout: { 'group:cols': '{"atc":22}' },
      video: { mode: 'emphasized', emphasizedFeedId: 'warbirds', fillPanelFeedId: null }
    })
    expect(s.fr24.lastUrl).toBe('https://x')
    expect(s.panelLayout).toBeNull()
    expect(s).not.toHaveProperty('layout')
    expect(s).not.toHaveProperty('video')
  })

  it('a corrupt panelLayout sanitizes to null without disturbing any other section', () => {
    const s = sanitizeSessionState({
      fr24: { lastUrl: 'https://x' },
      panelLayout: { tree: { type: 'nonsense' } }
    })
    expect(s.panelLayout).toBeNull()
    expect(s.fr24.lastUrl).toBe('https://x')
  })

  it('keeps a valid theme and defaults an absent/invalid one to system', () => {
    expect(sanitizeSessionState({ theme: 'light' }).theme).toBe('light')
    expect(sanitizeSessionState({ theme: 'dark' }).theme).toBe('dark')
    expect(sanitizeSessionState({}).theme).toBe('system')
    expect(sanitizeSessionState({ theme: 'ember' }).theme).toBe('system')
    expect(sanitizeSessionState({ theme: 42 }).theme).toBe('system')
  })

  // A pop-out's own panel-canvas tree/videoFit (decision 2026-07-20; see
  // src/shared/ipc.ts's PopoutState) replace the old `video: VideoLayoutState`
  // uniform/emphasized/fill-panel field — these exercise sanitizePopout's
  // migration/never-throw contract the same way the panelLayout tests above
  // exercise sanitizePanelLayoutSession's.
  describe('pop-out tree migration/sanitize', () => {
    it('a legacy pop-out slice (old video: VideoLayoutState, no tree/videoFit at all) migrates to a fresh tree built from its own feedIds', () => {
      const s = sanitizeSessionState({
        popouts: [
          {
            id: 1,
            bounds: bounds(100, 100),
            feedIds: ['warbirds', 'vintage'],
            video: { mode: 'emphasized', emphasizedFeedId: 'warbirds', fillPanelFeedId: null },
            volumes: {}
          }
        ]
      })
      expect(s.popouts).toHaveLength(1)
      const p = s.popouts[0]
      expect(p.tree).toEqual(buildBalancedGrid(['warbirds', 'vintage'].map(videoLeaf)))
      expect(p.videoFit).toEqual({})
      expect(p).not.toHaveProperty('video')
    })

    it('a corrupt tree sanitizes to a fresh grid from feedIds rather than nulling the whole slice, and malformed videoFit entries drop individually', () => {
      const s = sanitizeSessionState({
        popouts: [
          {
            id: 1,
            bounds: bounds(),
            feedIds: ['warbirds'],
            tree: { type: 'nonsense' },
            videoFit: { warbirds: 'bogus', vintage: 'fill' },
            volumes: {}
          }
        ]
      })
      const p = s.popouts[0]
      expect(p.tree).toEqual({ type: 'leaf', id: 'video:warbirds' })
      expect(p.videoFit).toEqual({ vintage: 'fill' }) // 'bogus' dropped, valid entry kept
    })

    it('a pop-out slice with zero feeds and no tree sanitizes to a null tree rather than throwing', () => {
      const s = sanitizeSessionState({
        popouts: [{ id: 1, bounds: bounds(), feedIds: [], volumes: {} }]
      })
      expect(s.popouts[0].tree).toBeNull()
      expect(s.popouts[0].feedIds).toEqual([])
    })

    it('keeps an already well-formed pop-out tree as-is', () => {
      const tree = buildBalancedGrid(['warbirds'].map(videoLeaf))
      const s = sanitizeSessionState({
        popouts: [
          { id: 1, bounds: bounds(), feedIds: ['warbirds'], tree, videoFit: {}, volumes: {} }
        ]
      })
      expect(s.popouts[0].tree).toEqual(tree)
    })
  })
})

describe('applySessionPatch', () => {
  it('does not mutate the input state', () => {
    const state = defaultSessionState()
    const next = applySessionPatch(state, { fr24: { lastUrl: 'https://x' } })
    expect(state.fr24.lastUrl).toBeNull()
    expect(next.fr24.lastUrl).toBe('https://x')
    expect(next).not.toBe(state)
  })

  it('merges device selections and clears one with null', () => {
    let state = defaultSessionState()
    state = applySessionPatch(state, {
      audio: { devices: { tower: { deviceId: 'a', deviceLabel: 'A' } } }
    })
    expect(state.audio.devices.tower).toEqual({ deviceId: 'a', deviceLabel: 'A' })
    state = applySessionPatch(state, { audio: { devices: { tower: null } } })
    expect(state.audio.devices.tower).toBeUndefined()
  })

  it('shallow-merges per-stream settings and clears overrides with null', () => {
    let state = defaultSessionState()
    state = applySessionPatch(state, { audio: { streams: { tower: { volume: 0.4 } } } })
    state = applySessionPatch(state, { audio: { streams: { tower: { muted: true } } } })
    expect(state.audio.streams.tower).toEqual({ volume: 0.4, muted: true })
    state = applySessionPatch(state, { audio: { streams: { tower: null } } })
    expect(state.audio.streams.tower).toBeUndefined()
  })

  it('merges the connected flag beside volume/mute/pan and toggles it in place', () => {
    let state = defaultSessionState()
    // Connect persists connected:true without disturbing an existing volume.
    state = applySessionPatch(state, { audio: { streams: { tower: { volume: 0.7 } } } })
    state = applySessionPatch(state, { audio: { streams: { tower: { connected: true } } } })
    expect(state.audio.streams.tower).toEqual({ volume: 0.7, connected: true })
    // Disconnect flips only the flag; the arranged volume survives.
    state = applySessionPatch(state, { audio: { streams: { tower: { connected: false } } } })
    expect(state.audio.streams.tower).toEqual({ volume: 0.7, connected: false })
  })

  it('replaces window bounds and clears them with null', () => {
    let state = applySessionPatch(defaultSessionState(), { window: bounds(1, 2, 900, 700, 3) })
    expect(state.window).toEqual({ x: 1, y: 2, width: 900, height: 700, displayId: 3 })
    state = applySessionPatch(state, { window: null })
    expect(state.window).toBeNull()
  })

  it('replaces panelLayout wholesale (whole-section replace, like window)', () => {
    const section = {
      tree: { type: 'leaf' as const, id: 'fr24' as const },
      maximizedPanelId: null,
      videoFit: {},
      profiles: []
    }
    const state = applySessionPatch(defaultSessionState(), { panelLayout: section })
    expect(state.panelLayout).toEqual(section)
  })

  it('clears panelLayout with an explicit null, but an absent key leaves it untouched', () => {
    const section = {
      tree: { type: 'leaf' as const, id: 'fr24' as const },
      maximizedPanelId: null,
      videoFit: {},
      profiles: []
    }
    let state = applySessionPatch(defaultSessionState(), { panelLayout: section })
    state = applySessionPatch(state, { fr24: { lastUrl: 'https://x' } }) // no panelLayout key at all
    expect(state.panelLayout).toEqual(section)
    state = applySessionPatch(state, { panelLayout: null })
    expect(state.panelLayout).toBeNull()
  })

  it('replaces the theme and is a no-op when the patch omits it', () => {
    let state = applySessionPatch(defaultSessionState(), { theme: 'dark' })
    expect(state.theme).toBe('dark')
    state = applySessionPatch(state, { fr24: { lastUrl: 'https://x' } })
    expect(state.theme).toBe('dark')
    state = applySessionPatch(state, { theme: 'light' })
    expect(state.theme).toBe('light')
  })
})

describe('pop-out operations', () => {
  const withTwo: SessionState = (() => {
    let s = defaultSessionState()
    s = upsertPopout(s, popout(1, ['warbirds']))
    s = upsertPopout(s, popout(2, ['vintage', 'ultralights']))
    return s
  })()

  it('assigns the next id past the current maximum', () => {
    expect(nextPopoutId(defaultSessionState())).toBe(1)
    expect(nextPopoutId(withTwo)).toBe(3)
  })

  it('upsert replaces an entry with the same id rather than duplicating', () => {
    const replaced = upsertPopout(withTwo, popout(1, ['green-dot']))
    expect(replaced.popouts).toHaveLength(2)
    expect(replaced.popouts.find((p) => p.id === 1)?.feedIds).toEqual(['green-dot'])
  })

  it('removePopout drops the entry and is a no-op for an unknown id', () => {
    expect(removePopout(withTwo, 1).popouts.map((p) => p.id)).toEqual([2])
    expect(removePopout(withTwo, 99).popouts).toHaveLength(2)
  })

  it('patchPopout merges tree / videoFit / volumes / feeds into the matching pop-out only', () => {
    const newTree = buildBalancedGrid(['vintage', 'ultralights'].map(videoLeaf))
    const patched = patchPopout(withTwo, 2, {
      tree: newTree,
      videoFit: { vintage: 'fill' },
      volumes: { vintage: { volume: 30, muted: false } }
    })
    const two = patched.popouts.find((p) => p.id === 2)!
    expect(two.tree).toEqual(newTree)
    expect(two.videoFit).toEqual({ vintage: 'fill' })
    expect(two.volumes.vintage).toEqual({ volume: 30, muted: false })
    // Pop-out 1 untouched.
    const one = patched.popouts.find((p) => p.id === 1)!
    expect(one.tree).toEqual(popout(1, ['warbirds']).tree)
    expect(one.videoFit).toEqual({})
  })

  it('patchPopout clears tree with an explicit null (distinct from an absent key)', () => {
    const patched = patchPopout(withTwo, 1, { tree: null, feedIds: [] })
    const one = patched.popouts.find((p) => p.id === 1)!
    expect(one.tree).toBeNull()
    expect(one.feedIds).toEqual([])
    // An absent tree key leaves the existing tree untouched.
    const untouched = patchPopout(withTwo, 1, { feedIds: ['warbirds'] })
    expect(untouched.popouts.find((p) => p.id === 1)?.tree).toEqual(popout(1, ['warbirds']).tree)
  })

  it('poppedOutFeedIds unions every open pop-out feed', () => {
    expect(poppedOutFeedIds(withTwo)).toEqual(new Set(['warbirds', 'vintage', 'ultralights']))
  })

  it('popoutSummaries returns id + feeds with copied arrays', () => {
    const summaries = popoutSummaries(withTwo)
    expect(summaries).toEqual([
      { id: 1, feedIds: ['warbirds'] },
      { id: 2, feedIds: ['vintage', 'ultralights'] }
    ])
    expect(summaries[0].feedIds).not.toBe(withTwo.popouts[0].feedIds)
  })
})

// The "Merge into…" control's math (decision 2026-07-20): moving one pop-out's
// feeds + volumes + fit/fill + TREE into another and dropping the source,
// exercised pure so it is testable without a BrowserWindow (see
// src/main/popouts.ts's mergePopout).
describe('mergePopouts', () => {
  const withTwo: SessionState = (() => {
    let s = defaultSessionState()
    s = upsertPopout(s, popout(1, ['warbirds']))
    s = upsertPopout(s, popout(2, ['vintage', 'ultralights']))
    return s
  })()

  it('moves the source feeds + per-feed volumes into the target and drops the source', () => {
    let state = withTwo
    state = patchPopout(state, 1, { volumes: { warbirds: { volume: 40, muted: true } } })
    state = patchPopout(state, 2, { volumes: { vintage: { volume: 60, muted: false } } })

    const merged = mergePopouts(state, 1, 2)
    expect(merged).not.toBeNull()
    expect(merged!.popouts.map((p) => p.id)).toEqual([2])

    const target = merged!.popouts[0]
    expect(target.feedIds).toEqual(['vintage', 'ultralights', 'warbirds'])
    expect(target.volumes).toEqual({
      vintage: { volume: 60, muted: false },
      warbirds: { volume: 40, muted: true }
    })
  })

  it("combines the source's feeds into the target's tree via insertVideoLeafBottom, rather than discarding the target's own arrangement", () => {
    const merged = mergePopouts(withTwo, 1, 2)
    expect(merged).not.toBeNull()
    const target = merged!.popouts[0]

    // Every feed from both source and target ends up in the combined tree,
    // exactly once.
    expect(new Set(collectLeafIds(target.tree))).toEqual(
      new Set(['video:vintage', 'video:ultralights', 'video:warbirds'])
    )
    // Matches what insertVideoLeafBottom itself produces when applied
    // directly to the TARGET's original tree — proving the target's own
    // arrangement is the base, not a from-scratch rebuild.
    const expected = insertVideoLeafBottom(popout(2, ['vintage', 'ultralights']).tree, {
      type: 'leaf',
      id: 'video:warbirds'
    })
    expect(target.tree).toEqual(expected)
  })

  it('seeds the tree directly from a lone source feed when the target itself starts with no tree (zero feeds)', () => {
    let state = defaultSessionState()
    state = upsertPopout(state, popout(1, ['warbirds']))
    state = upsertPopout(state, popout(2, []))
    expect(state.popouts.find((p) => p.id === 2)!.tree).toBeNull()

    const merged = mergePopouts(state, 1, 2)
    expect(merged!.popouts[0].tree).toEqual({ type: 'leaf', id: 'video:warbirds' })
  })

  it('combines per-feed fit/fill from both slices', () => {
    let state = withTwo
    state = patchPopout(state, 1, { videoFit: { warbirds: 'fill' } })
    state = patchPopout(state, 2, { videoFit: { vintage: 'fill' } })
    const merged = mergePopouts(state, 1, 2)
    expect(merged!.popouts[0].videoFit).toEqual({ warbirds: 'fill', vintage: 'fill' })
  })

  it('dedupes feed ids defensively if a feed somehow appears in both slices, without inserting it twice into the tree', () => {
    let state = defaultSessionState()
    state = upsertPopout(state, popout(1, ['warbirds']))
    state = upsertPopout(state, popout(2, ['warbirds', 'vintage']))

    const merged = mergePopouts(state, 1, 2)
    expect(merged!.popouts[0].feedIds).toEqual(['warbirds', 'vintage'])
    expect(collectLeafIds(merged!.popouts[0].tree)).toEqual(['video:warbirds', 'video:vintage'])
  })

  it('leaves the target bounds untouched — only the feed set and tree grow', () => {
    const merged = mergePopouts(withTwo, 1, 2)
    expect(merged!.popouts[0].bounds).toEqual(bounds())
  })

  it('returns null (no-op) for equal ids or an unknown id', () => {
    expect(mergePopouts(withTwo, 1, 1)).toBeNull()
    expect(mergePopouts(withTwo, 1, 99)).toBeNull()
    expect(mergePopouts(withTwo, 99, 1)).toBeNull()
  })

  it('does not mutate the input state', () => {
    const before = structuredClone(withTwo)
    mergePopouts(withTwo, 1, 2)
    expect(withTwo).toEqual(before)
  })
})
