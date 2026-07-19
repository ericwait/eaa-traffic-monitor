import { describe, it, expect } from 'vitest'
import { Vad } from '@renderer/audio/vad'
import type { VadParams } from '@renderer/audio/vad'
import { DEFAULT_CONFIG } from '@shared/defaultConfig'

// Guardian suite for the activity-light detector. The activity lights are the
// product's answer to "which stream is talking?", so their math is protected
// here rather than eyeballed at the show. Every scenario below maps to a
// real-world behaviour the design calls out (docs/design/Audio.md): squelched
// hiss must not light, a real transmission must, inter-word gaps must not
// flicker, and a long call must not drag its own floor up.

/** The shipped defaults — the params the app actually runs — as the baseline. */
function baseParams(overrides: Partial<VadParams> = {}): VadParams {
  return { ...DEFAULT_CONFIG.vad, ...overrides }
}

/** Feed one level `count` times; return the activity state after the last tick. */
function feed(vad: Vad, levelDb: number, count: number): boolean {
  let active = vad.active
  for (let i = 0; i < count; i++) active = vad.push(levelDb)
  return active
}

describe('Vad — attack', () => {
  it('lights after exactly attackTicks consecutive bursts, not before', () => {
    const p = baseParams()
    const vad = new Vad(p)

    // Squelched hiss first — the light stays off while the floor settles.
    expect(feed(vad, -75, 8)).toBe(false)

    // A loud transmission (well above floor + activeThresholdDb) arrives.
    const burst = -20
    for (let i = 1; i < p.attackTicks; i++) {
      expect(vad.push(burst)).toBe(false) // not yet — attack not satisfied
    }
    expect(vad.push(burst)).toBe(true) // the attackTicks-th tick latches it on
  })

  it('resets the attack count if the signal dips before latching', () => {
    const p = baseParams({ attackTicks: 3 })
    const vad = new Vad(p)
    feed(vad, -75, 5)
    expect(vad.push(-20)).toBe(false) // attack 1
    expect(vad.push(-20)).toBe(false) // attack 2
    expect(vad.push(-80)).toBe(false) // dip — attack resets
    expect(vad.push(-20)).toBe(false) // attack 1 again, not 3
    expect(vad.push(-20)).toBe(false) // attack 2
    expect(vad.push(-20)).toBe(true) // attack 3 — latched
  })
})

describe('Vad — hang bridges inter-word gaps', () => {
  it('stays lit through a 300 ms gap between words', () => {
    const p = baseParams()
    const vad = new Vad(p)
    feed(vad, -75, 5)
    // Latch on.
    feed(vad, -20, p.attackTicks)
    expect(vad.active).toBe(true)

    // A 300 ms un-key/re-key gap = 6 ticks of near-floor level. hangMs (700) far
    // exceeds it, so the light must not drop.
    const gapTicks = Math.round(300 / p.tickMs)
    expect(feed(vad, -85, gapTicks)).toBe(true)

    // The next word re-keys and refreshes the hang window.
    expect(vad.push(-20)).toBe(true)
  })
})

describe('Vad — release after hang', () => {
  it('holds for hangMs after the signal drops, then releases', () => {
    const p = baseParams()
    const vad = new Vad(p)
    feed(vad, -75, 5)
    feed(vad, -20, p.attackTicks)
    expect(vad.active).toBe(true)

    // hangMs / tickMs ticks below release are needed to drop the light. It must
    // still be lit one tick short of that, and released on it.
    const hangTicks = p.hangMs / p.tickMs // 700 / 50 = 14
    expect(feed(vad, -85, hangTicks - 1)).toBe(true)
    expect(vad.push(-85)).toBe(false)
  })
})

describe('Vad — adaptive floor', () => {
  it('does not false-trigger on steady hiss, and the floor rises only slowly', () => {
    const p = baseParams({ floorInitDb: -60 })
    const vad = new Vad(p)

    // Steady hiss below the active threshold (floor -60 + 8 = -52; hiss -58).
    let everActive = false
    for (let i = 0; i < 200; i++) everActive = vad.push(-58) || everActive
    expect(everActive).toBe(false)

    // The floor rose toward the hiss, but slowly — still much nearer its start
    // than the hiss level after 200 ticks.
    expect(vad.floorDb).toBeGreaterThan(-60)
    expect(vad.floorDb).toBeLessThan(-59)
  })

  it('falls fast toward a newly-quiet level', () => {
    const p = baseParams({ floorInitDb: -40 })
    const fast = new Vad(p)
    const slow = new Vad(baseParams({ floorInitDb: -40, floorFallAlpha: 0.001 }))
    // Same quiet input; the fast-fall detector must track down much further in
    // the same number of ticks.
    feed(fast, -80, 10)
    feed(slow, -80, 10)
    expect(fast.floorDb).toBeLessThan(slow.floorDb)
  })

  it('freezes the floor for the length of a 10 s transmission', () => {
    const p = baseParams()
    const vad = new Vad(p)
    feed(vad, -70, 5)
    feed(vad, -18, p.attackTicks) // latch on
    expect(vad.active).toBe(true)
    const frozen = vad.floorDb

    // 10 s of sustained signal = 200 ticks. The floor must not move a hair.
    for (let i = 0; i < 200; i++) vad.push(-18)
    expect(vad.active).toBe(true)
    expect(vad.floorDb).toBe(frozen)
  })
})

describe('Vad — hysteresis band', () => {
  it('keeps an active stream lit in the band between release and active thresholds', () => {
    const p = baseParams({ floorInitDb: -60 })
    const vad = new Vad(p)
    feed(vad, -70, 3) // let the floor settle a little
    const floor = vad.floorDb
    feed(vad, -18, p.attackTicks) // latch on (floor now frozen)

    // A level between release (floor+4) and active (floor+8): should hold the
    // light (>= release refreshes the hang), never dropping it.
    const bandLevel = floor + 6
    expect(feed(vad, bandLevel, 50)).toBe(true)
  })

  it('does not latch from a level in the hysteresis band when inactive', () => {
    const p = baseParams({ floorInitDb: -60 })
    const vad = new Vad(p)
    feed(vad, -70, 3)
    const floor = vad.floorDb
    // A level above release but below the active threshold must not turn the
    // light on from cold.
    const bandLevel = floor + 6
    expect(feed(vad, bandLevel, 50)).toBe(false)
  })
})

describe('Vad — floor clamps', () => {
  it('clamps the initial floor into [min, max] at construction', () => {
    const lo = new Vad(baseParams({ floorInitDb: -200, floorClampDb: [-90, -35] }))
    const hi = new Vad(baseParams({ floorInitDb: -5, floorClampDb: [-90, -35] }))
    expect(lo.floorDb).toBe(-90)
    expect(hi.floorDb).toBe(-35)
  })

  it('never lets the floor fall below the min clamp, even on digital silence', () => {
    const vad = new Vad(baseParams({ floorInitDb: -60, floorClampDb: [-90, -35] }))
    feed(vad, Number.NEGATIVE_INFINITY, 20)
    expect(vad.floorDb).toBe(-90)
  })

  it('never lets the floor rise above the max clamp', () => {
    const vad = new Vad(baseParams({ floorInitDb: -36, floorClampDb: [-90, -35] }))
    // Hiss just above the clamp, but below the active threshold (floor+8), so it
    // pulls the floor up without ever latching. It must pin at the max clamp.
    const everActive = (() => {
      let a = false
      for (let i = 0; i < 2000; i++) a = vad.push(-30) || a
      return a
    })()
    expect(everActive).toBe(false)
    expect(vad.floorDb).toBe(-35)
  })
})
