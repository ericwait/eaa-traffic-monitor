// The reconnect back-off schedule for a WANTED-but-down stream. Pure and
// side-effect-free (no timers, no DOM), so the whole cadence is exercised in
// vitest — the alternative is discovering at the show that a dead mount either
// hammered LiveATC or looked like a crisis.
//
// Policy (decision 2026-07-19): a stream the operator connected keeps
// reconnecting on its own, but the first few tries use a fast exponential
// back-off and, after FEED_DOWN_AFTER_ATTEMPTS consecutive failures, it settles
// into a slow, steady cadence and is reported as calmly "feed down" — an
// event-only mount that 404s for hours (verified at AirVenture prep) must not
// read as an ever-climbing alarm, and must never be polled aggressively.

/**
 * Consecutive-failure count at (and past) which a wanted-but-down stream is
 * treated as durably down: it stops the climbing counter and retries on the slow
 * cadence rather than hammering. Chosen so a brief blip still recovers fast, but
 * a mount that is simply not broadcasting yet calms down within a few seconds.
 */
export const FEED_DOWN_AFTER_ATTEMPTS = 5

/**
 * Fast exponential back-off (seconds) for the first reconnect attempts, indexed
 * by (attempt − 1). Covers attempts 1..(FEED_DOWN_AFTER_ATTEMPTS − 1); the last
 * attempt in this window uses the final entry.
 */
export const FAST_BACKOFF_SECONDS: readonly number[] = [1, 2, 4, 8]

/** The slow, calm retry cadence (seconds) once a mount looks durably down. */
export const SLOW_BACKOFF_SECONDS = 60

/**
 * True once a stream has failed `attempt` times in a row and should be shown as
 * calmly "feed down · retrying" (and retried on the slow cadence) rather than
 * with a climbing counter. `attempt` is the 1-based count of consecutive
 * failures so far.
 */
export function isFeedDown(attempt: number): boolean {
  return attempt >= FEED_DOWN_AFTER_ATTEMPTS
}

/**
 * The base retry delay in milliseconds before the given attempt, from the
 * schedule above (no jitter — the caller adds any). `attempt` is the 1-based
 * consecutive-failure count; values below 1 are treated as 1. Once
 * `isFeedDown(attempt)` holds, the delay is the flat slow cadence.
 */
export function backoffDelayMs(attempt: number): number {
  if (isFeedDown(attempt)) return SLOW_BACKOFF_SECONDS * 1000
  const idx = Math.min(Math.max(attempt, 1) - 1, FAST_BACKOFF_SECONDS.length - 1)
  return FAST_BACKOFF_SECONDS[idx] * 1000
}
