import { describe, it, expect } from 'vitest'
import { clamp, formatCountdown } from '@shared/format'

// A real unit test over real pure logic — the pattern the audio guardians
// (vad.ts, ducking.ts, plsParser.ts) will follow in later phases. No
// placeholder assertions.

describe('clamp', () => {
  it('returns the value when already in range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })

  it('clamps below the minimum', () => {
    expect(clamp(-3, 0, 1)).toBe(0)
  })

  it('clamps above the maximum', () => {
    expect(clamp(4.2, 0, 1)).toBe(1)
  })

  it('handles the audio-pan range [-1, 1]', () => {
    expect(clamp(-2, -1, 1)).toBe(-1)
    expect(clamp(2, -1, 1)).toBe(1)
    expect(clamp(0, -1, 1)).toBe(0)
  })

  it('treats NaN as the minimum rather than propagating it', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0)
  })

  it('throws when min exceeds max (a caller bug)', () => {
    expect(() => clamp(0.5, 1, 0)).toThrow(RangeError)
  })
})

describe('formatCountdown', () => {
  it('formats sub-minute values as M:SS', () => {
    expect(formatCountdown(5)).toBe('0:05')
    expect(formatCountdown(45)).toBe('0:45')
  })

  it('formats minute values with zero-padded seconds', () => {
    expect(formatCountdown(90)).toBe('1:30')
    expect(formatCountdown(600)).toBe('10:00')
  })

  it('rolls over into H:MM:SS past an hour', () => {
    expect(formatCountdown(3661)).toBe('1:01:01')
    expect(formatCountdown(7325)).toBe('2:02:05')
  })

  it('floors fractional seconds', () => {
    expect(formatCountdown(59.9)).toBe('0:59')
  })

  it('treats negative and non-finite input as zero', () => {
    expect(formatCountdown(-10)).toBe('0:00')
    expect(formatCountdown(Number.NaN)).toBe('0:00')
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})
