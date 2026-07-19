import { describe, it, expect } from 'vitest'
import { computeDuckTargets, chooseDuckTau, DEFAULT_DUCK_LEVEL } from '@renderer/audio/ducking'
import type { DuckStreamState } from '@renderer/audio/ducking'

// Guardian suite for priority ducking + solo. Ducking is the product's "let the
// important channel win automatically" answer (docs/design/Audio.md), so the
// strictly-higher-priority rule, the equal-rank tie behaviour, the solo
// override, and the muted-ducker decision are protected here rather than judged
// by ear — especially important the night before the show when only ATIS is
// transmitting and the mix can't be heard.

/** Build a stream snapshot with sensible defaults. */
function s(
  overrides: Partial<DuckStreamState> & Pick<DuckStreamState, 'id' | 'priority'>
): DuckStreamState {
  return { vadActive: false, muted: false, ...overrides }
}

describe('computeDuckTargets — strictly-higher-priority rule', () => {
  it('ducks a lower-priority stream when a strictly-higher one is active', () => {
    const streams = [
      s({ id: 'tower', priority: 2, vadActive: true }),
      s({ id: 'fisk', priority: 3, vadActive: false })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('tower')).toBe(1) // nothing outranks Tower
    expect(targets.get('fisk')).toBe(DEFAULT_DUCK_LEVEL) // Tower outranks Fisk
  })

  it('does NOT duck a higher-priority stream when a lower one is active', () => {
    const streams = [
      s({ id: 'tower', priority: 2, vadActive: false }),
      s({ id: 'fisk', priority: 3, vadActive: true })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('tower')).toBe(1) // Fisk (lower) cannot duck Tower
    expect(targets.get('fisk')).toBe(1) // Fisk is top of the active set here
  })

  it('honours a custom duck level', () => {
    const streams = [s({ id: 'a', priority: 1, vadActive: true }), s({ id: 'b', priority: 2 })]
    const targets = computeDuckTargets(streams, null, 0.1)
    expect(targets.get('b')).toBe(0.1)
  })

  it('leaves everything at full when nothing is active', () => {
    const streams = [
      s({ id: 'a', priority: 1 }),
      s({ id: 'b', priority: 2 }),
      s({ id: 'c', priority: 3 })
    ]
    const targets = computeDuckTargets(streams, null)
    expect([...targets.values()]).toEqual([1, 1, 1])
  })
})

describe('computeDuckTargets — priority chains', () => {
  it('a mid-priority active stream ducks everything below it, not above', () => {
    // Guard(1) silent, Tower(2) active, Fisk(3) silent, Gnd(4) silent.
    const streams = [
      s({ id: 'guard', priority: 1 }),
      s({ id: 'tower', priority: 2, vadActive: true }),
      s({ id: 'fisk', priority: 3 }),
      s({ id: 'gnd', priority: 4 })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('guard')).toBe(1) // above the active Tower
    expect(targets.get('tower')).toBe(1) // the active stream itself
    expect(targets.get('fisk')).toBe(DEFAULT_DUCK_LEVEL) // below Tower
    expect(targets.get('gnd')).toBe(DEFAULT_DUCK_LEVEL) // below Tower
  })

  it('the highest active stream sets the duck floor; lower actives do not lift it', () => {
    // Guard(1) active AND Fisk(3) active: Tower(2) ducks under Guard; Fisk stays
    // ducked under Guard; Guard rides full.
    const streams = [
      s({ id: 'guard', priority: 1, vadActive: true }),
      s({ id: 'tower', priority: 2 }),
      s({ id: 'fisk', priority: 3, vadActive: true }),
      s({ id: 'gnd', priority: 4 })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('guard')).toBe(1)
    expect(targets.get('tower')).toBe(DEFAULT_DUCK_LEVEL) // under active Guard
    expect(targets.get('fisk')).toBe(DEFAULT_DUCK_LEVEL) // under active Guard
    expect(targets.get('gnd')).toBe(DEFAULT_DUCK_LEVEL) // under Guard and Fisk
  })
})

describe('computeDuckTargets — equal priorities never duck each other', () => {
  it('two active streams at the same rank both ride full', () => {
    const streams = [
      s({ id: 'twr-n', priority: 2, vadActive: true }),
      s({ id: 'twr-s', priority: 2, vadActive: true })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('twr-n')).toBe(1)
    expect(targets.get('twr-s')).toBe(1)
  })

  it('an equal-rank active stream still ducks a lower-rank one', () => {
    const streams = [
      s({ id: 'twr-n', priority: 2, vadActive: true }),
      s({ id: 'twr-s', priority: 2, vadActive: false }),
      s({ id: 'fisk', priority: 3, vadActive: false })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('twr-n')).toBe(1)
    expect(targets.get('twr-s')).toBe(1) // equal rank — not ducked by twr-n
    expect(targets.get('fisk')).toBe(DEFAULT_DUCK_LEVEL) // below both towers
  })
})

describe('computeDuckTargets — solo override', () => {
  it('soloed stream rides full; every other stream is silenced', () => {
    const streams = [
      s({ id: 'guard', priority: 1, vadActive: true }),
      s({ id: 'tower', priority: 2, vadActive: true }),
      s({ id: 'fisk', priority: 3 })
    ]
    const targets = computeDuckTargets(streams, 'fisk')
    expect(targets.get('fisk')).toBe(1)
    expect(targets.get('guard')).toBe(0)
    expect(targets.get('tower')).toBe(0)
  })

  it('solo ignores priorities and activity entirely', () => {
    // The soloed stream is the lowest-priority one and silent; it still wins.
    const streams = [
      s({ id: 'a', priority: 1, vadActive: true }),
      s({ id: 'b', priority: 9, vadActive: false })
    ]
    const targets = computeDuckTargets(streams, 'b')
    expect(targets.get('b')).toBe(1)
    expect(targets.get('a')).toBe(0)
  })
})

describe('computeDuckTargets — muted streams do not duck others (decision 2026-07-19)', () => {
  it('a muted active higher-priority stream does NOT duck a lower one', () => {
    const streams = [
      s({ id: 'guard', priority: 1, vadActive: true, muted: true }),
      s({ id: 'fisk', priority: 3, vadActive: false })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('fisk')).toBe(1) // Guard is muted → does not duck Fisk
  })

  it('an unmuted active stream still ducks lower ones even if a muted peer is active', () => {
    const streams = [
      s({ id: 'guard', priority: 1, vadActive: true, muted: true }), // muted — no duck
      s({ id: 'tower', priority: 2, vadActive: true, muted: false }), // unmuted — ducks below
      s({ id: 'fisk', priority: 3 })
    ]
    const targets = computeDuckTargets(streams, null)
    expect(targets.get('tower')).toBe(1) // Guard muted, cannot duck Tower
    expect(targets.get('fisk')).toBe(DEFAULT_DUCK_LEVEL) // Tower (unmuted) ducks Fisk
  })
})

describe('computeDuckTargets — degenerate sets', () => {
  it('handles an empty set', () => {
    expect(computeDuckTargets([], null).size).toBe(0)
  })

  it('a single stream never ducks itself', () => {
    const targets = computeDuckTargets([s({ id: 'only', priority: 1, vadActive: true })], null)
    expect(targets.get('only')).toBe(1)
  })

  it('a single soloed stream rides full', () => {
    const targets = computeDuckTargets([s({ id: 'only', priority: 5 })], 'only')
    expect(targets.get('only')).toBe(1)
  })
})

describe('chooseDuckTau — asymmetric ramps', () => {
  const DUCK = 0.05
  const RELEASE = 0.2

  it('uses the fast duck τ when moving down (full → ducked)', () => {
    expect(chooseDuckTau(1, DEFAULT_DUCK_LEVEL, DUCK, RELEASE)).toBe(DUCK)
  })

  it('uses the slow release τ when moving up (ducked → full)', () => {
    expect(chooseDuckTau(DEFAULT_DUCK_LEVEL, 1, DUCK, RELEASE)).toBe(RELEASE)
  })

  it('uses the fast duck τ for a solo silence (full → 0)', () => {
    expect(chooseDuckTau(1, 0, DUCK, RELEASE)).toBe(DUCK)
  })

  it('uses the slow release τ for a solo release (0 → full)', () => {
    expect(chooseDuckTau(0, 1, DUCK, RELEASE)).toBe(RELEASE)
  })

  it('treats an unchanged target as a hold on the release τ (never a spurious fast ramp)', () => {
    expect(chooseDuckTau(DEFAULT_DUCK_LEVEL, DEFAULT_DUCK_LEVEL, DUCK, RELEASE)).toBe(RELEASE)
  })
})
