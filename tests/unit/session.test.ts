import { describe, it, expect } from 'vitest'
import {
  defaultSessionState,
  sanitizeSessionState,
  applySessionPatch,
  upsertPopout,
  removePopout,
  patchPopout,
  nextPopoutId,
  poppedOutFeedIds,
  popoutSummaries
} from '@shared/session'
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

function popout(id: number, feedIds: string[]): PopoutState {
  return {
    id,
    bounds: bounds(),
    feedIds,
    video: { mode: 'uniform', emphasizedFeedId: null, fillPanelFeedId: null },
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
      layout: {},
      video: { mode: 'uniform', emphasizedFeedId: null, fillPanelFeedId: null },
      panelLayout: null,
      popouts: []
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
      layout: { 'group:main': '{"atc":22}', bad: 5 },
      video: { mode: 'emphasized', emphasizedFeedId: 'warbirds', fillPanelFeedId: null },
      popouts: [
        { id: 1, bounds: bounds(100, 100), feedIds: ['warbirds'], video: {}, volumes: {} },
        { id: 2 } // no bounds → dropped
      ]
    }
    const s = sanitizeSessionState(raw)
    expect(s.fr24.lastUrl).toBe('https://www.flightradar24.com/x')
    expect(s.audio.devices).toEqual({ tower: { deviceId: 'abc', deviceLabel: 'Headphones' } })
    expect(s.audio.streams).toEqual({ tower: { volume: 0.5, muted: true, pan: -0.3 }, gnd: {} })
    expect(s.window).toEqual({ x: 10, y: 20, width: 1280, height: 800, displayId: 2 })
    expect(s.layout).toEqual({ 'group:main': '{"atc":22}' })
    expect(s.video).toEqual({
      mode: 'emphasized',
      emphasizedFeedId: 'warbirds',
      fillPanelFeedId: null
    })
    expect(s.popouts).toHaveLength(1)
    expect(s.popouts[0].id).toBe(1)
  })

  it('clamps out-of-range volumes/pans and defaults a bad video mode', () => {
    const s = sanitizeSessionState({
      audio: { streams: { a: { volume: 5, pan: -9 } } },
      video: { mode: 'wild', emphasizedFeedId: 42 }
    })
    expect(s.audio.streams.a).toEqual({ volume: 1, pan: -1 })
    expect(s.video).toEqual({ mode: 'uniform', emphasizedFeedId: null, fillPanelFeedId: null })
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

  it('sanitizes a well-formed panelLayout section, leaving the legacy layout/video fields untouched', () => {
    const s = sanitizeSessionState({
      layout: { 'group:cols': '{"atc":22}' },
      video: { mode: 'emphasized', emphasizedFeedId: 'warbirds', fillPanelFeedId: null },
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
    // The additive contract: legacy fields are still read/sanitized exactly as before.
    expect(s.layout).toEqual({ 'group:cols': '{"atc":22}' })
    expect(s.video).toEqual({
      mode: 'emphasized',
      emphasizedFeedId: 'warbirds',
      fillPanelFeedId: null
    })
  })

  it('a corrupt panelLayout sanitizes to null without disturbing any other section', () => {
    const s = sanitizeSessionState({
      fr24: { lastUrl: 'https://x' },
      panelLayout: { tree: { type: 'nonsense' } }
    })
    expect(s.panelLayout).toBeNull()
    expect(s.fr24.lastUrl).toBe('https://x')
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

  it('merges layout entries without dropping existing keys', () => {
    let state = applySessionPatch(defaultSessionState(), { layout: { g1: 'a' } })
    state = applySessionPatch(state, { layout: { g2: 'b' } })
    expect(state.layout).toEqual({ g1: 'a', g2: 'b' })
  })

  it('replaces the video layout wholesale', () => {
    const state = applySessionPatch(defaultSessionState(), {
      video: { mode: 'emphasized', emphasizedFeedId: 'x', fillPanelFeedId: null }
    })
    expect(state.video).toEqual({
      mode: 'emphasized',
      emphasizedFeedId: 'x',
      fillPanelFeedId: null
    })
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

  it('patchPopout merges layout / volumes / feeds into the matching pop-out only', () => {
    const patched = patchPopout(withTwo, 2, {
      video: { mode: 'emphasized', emphasizedFeedId: 'vintage', fillPanelFeedId: null },
      volumes: { vintage: { volume: 30, muted: false } }
    })
    const two = patched.popouts.find((p) => p.id === 2)!
    expect(two.video.mode).toBe('emphasized')
    expect(two.volumes.vintage).toEqual({ volume: 30, muted: false })
    // Pop-out 1 untouched.
    expect(patched.popouts.find((p) => p.id === 1)?.video.mode).toBe('uniform')
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
