import { describe, it, expect } from 'vitest'
import {
  backoffDelayMs,
  isFeedDown,
  FAST_BACKOFF_SECONDS,
  SLOW_BACKOFF_SECONDS,
  FEED_DOWN_AFTER_ATTEMPTS
} from '@renderer/audio/backoff'

// Guardian suite for the on-demand reconnect back-off (decision 2026-07-19). The
// AirVenture-prep failure this protects against: a dead mount hammered LiveATC
// and alarmed the operator with an ever-climbing counter. So the schedule must
// (a) recover quickly from a blip, then (b) settle onto a slow, steady cadence
// and read as calm "feed down" once a mount is durably down — verified here
// rather than by watching four dead feeds at 6 a.m.

describe('backoff schedule', () => {
  it('uses the fast exponential schedule for the first attempts', () => {
    // Attempt is the 1-based consecutive-failure count.
    expect(backoffDelayMs(1)).toBe(FAST_BACKOFF_SECONDS[0] * 1000)
    expect(backoffDelayMs(2)).toBe(FAST_BACKOFF_SECONDS[1] * 1000)
    expect(backoffDelayMs(3)).toBe(FAST_BACKOFF_SECONDS[2] * 1000)
    expect(backoffDelayMs(4)).toBe(FAST_BACKOFF_SECONDS[3] * 1000)
  })

  it('is monotonically non-decreasing across the fast window', () => {
    for (let a = 2; a < FEED_DOWN_AFTER_ATTEMPTS; a++) {
      expect(backoffDelayMs(a)).toBeGreaterThanOrEqual(backoffDelayMs(a - 1))
    }
  })

  it('settles onto the slow cadence at and past the feed-down threshold', () => {
    expect(backoffDelayMs(FEED_DOWN_AFTER_ATTEMPTS)).toBe(SLOW_BACKOFF_SECONDS * 1000)
    expect(backoffDelayMs(FEED_DOWN_AFTER_ATTEMPTS + 1)).toBe(SLOW_BACKOFF_SECONDS * 1000)
    expect(backoffDelayMs(999)).toBe(SLOW_BACKOFF_SECONDS * 1000)
  })

  it('the slow cadence is a genuine slowdown, not a faster hammer', () => {
    const lastFast = backoffDelayMs(FEED_DOWN_AFTER_ATTEMPTS - 1)
    expect(backoffDelayMs(FEED_DOWN_AFTER_ATTEMPTS)).toBeGreaterThan(lastFast)
    // 60 s is polite — never sub-second, so a dead mount is never hammered.
    expect(SLOW_BACKOFF_SECONDS * 1000).toBeGreaterThanOrEqual(30_000)
  })

  it('clamps a zero/negative attempt to the first step rather than throwing', () => {
    expect(backoffDelayMs(0)).toBe(FAST_BACKOFF_SECONDS[0] * 1000)
    expect(backoffDelayMs(-3)).toBe(FAST_BACKOFF_SECONDS[0] * 1000)
  })
})

describe('isFeedDown', () => {
  it('is false while a stream is still on the fast schedule', () => {
    expect(isFeedDown(1)).toBe(false)
    expect(isFeedDown(FEED_DOWN_AFTER_ATTEMPTS - 1)).toBe(false)
  })

  it('latches true once the consecutive-failure count reaches the threshold', () => {
    expect(isFeedDown(FEED_DOWN_AFTER_ATTEMPTS)).toBe(true)
    expect(isFeedDown(FEED_DOWN_AFTER_ATTEMPTS + 50)).toBe(true)
  })
})
