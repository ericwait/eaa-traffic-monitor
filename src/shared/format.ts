// Pure UI helpers shared across renderer windows. These are the first real
// vitest targets (see tests/unit/format.test.ts) and stand in for the pure
// audio math — vad.ts, ducking.ts, plsParser.ts — that arrives in later
// phases. No DOM, no Electron, no I/O: pure input -> output.

/**
 * Clamp `value` into the inclusive range [min, max].
 *
 * Used wherever a control feeds an audio parameter that has a hard domain —
 * volume gain [0, 1], stereo pan [-1, 1] — so a stray slider value can never
 * drive a Web Audio node out of range.
 *
 * @throws RangeError if `min` is greater than `max` (a caller bug worth
 *   surfacing loudly rather than silently returning nonsense).
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) must not exceed max (${max})`)
  }
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Format a whole number of seconds as `M:SS` (or `H:MM:SS` past an hour) for
 * countdown / elapsed displays — reconnect backoff timers, "next show in",
 * stream uptime. Negative input is treated as zero.
 */
export function formatCountdown(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const two = (n: number): string => n.toString().padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${two(minutes)}:${two(seconds)}`
  }
  return `${minutes}:${two(seconds)}`
}
