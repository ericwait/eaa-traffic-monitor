// Priority ducking + solo — the math behind "let the important channel win".
//
// PURE by design (like vad.ts): this module maps a snapshot of the streams to a
// duck-gain TARGET per stream and imports nothing (no Web Audio, no React, no
// config), so the whole strictly-higher-priority rule is exercised directly in
// vitest. The engine feeds it the current per-stream state each time a VAD
// boolean, a mute, or the solo selection changes, then applies each target to
// that stream's duckGain node with asymmetric ramps (fast duck, slow release).
//
// The rules (see docs/design/Audio.md § "Priority ranks with auto-ducking" and
// § "One-click solo"):
//
//   * Solo overrides everything. When a stream is soloed, it sits at full gain
//     (1.0) and every other stream is silenced (0.0) — priorities and ducking
//     are ignored while a solo is held.
//   * Otherwise a stream ducks (to duckLevel, default 0.25 ≈ −12 dB) iff ANY
//     OTHER stream of STRICTLY higher priority (a LOWER rank number: rank 1 is
//     highest) is currently voice-active. Equal ranks never duck each other.
//   * Muted streams do NOT duck others (decision 2026-07-19). A muted channel's
//     activity light still works — the operator can see it come alive — but its
//     audio is silent, so ducking the lower channels the operator IS listening
//     to, on behalf of a channel they've muted out of their ears, would drop the
//     mix to silence for no audible reason. So a muted stream is a non-participant
//     as a DUCKER. (It can still be ducked BY a higher unmuted stream, but that
//     is moot: its own audio is already at zero via the user-volume gain.)

/** One stream's inputs to the ducking computation — the minimal snapshot. */
export interface DuckStreamState {
  /** Stream id, the key of the returned target map. */
  id: string
  /** Priority rank; 1 = highest. Strictly-lower number = strictly-higher priority. */
  priority: number
  /** Post-hysteresis voice activity (the same boolean that drives the light). */
  vadActive: boolean
  /** Muted streams do not duck others (see the module header decision note). */
  muted: boolean
}

/** The ducked target gain when a strictly-higher stream is active. −12 dB. */
export const DEFAULT_DUCK_LEVEL = 0.25

/**
 * Compute each stream's duck-gain target.
 *
 * @param streams  the current per-stream snapshot (order irrelevant).
 * @param soloId   the soloed stream id, or null when no solo is held.
 * @param duckLevel the ducked target gain (config.ducking.duckLevel; default 0.25).
 * @returns a Map from stream id to its target gain in [0, 1].
 */
export function computeDuckTargets(
  streams: readonly DuckStreamState[],
  soloId: string | null,
  duckLevel: number = DEFAULT_DUCK_LEVEL
): Map<string, number> {
  const targets = new Map<string, number>()

  // Solo overrides priorities, ducking, and mutes: exactly one stream audible.
  if (soloId !== null) {
    for (const s of streams) targets.set(s.id, s.id === soloId ? 1 : 0)
    return targets
  }

  for (const s of streams) {
    // Duck iff SOME OTHER stream outranks this one (strictly higher priority =
    // strictly lower rank number) AND is voice-active AND is not muted.
    const duckedByHigher = streams.some(
      (other) => other.id !== s.id && other.priority < s.priority && other.vadActive && !other.muted
    )
    targets.set(s.id, duckedByHigher ? duckLevel : 1)
  }

  return targets
}

/**
 * Pick the ramp time-constant for a duck-gain change. The duck is FAST (a
 * priority call's opening syllables must not be buried under a channel still
 * fading down) and the release is SLOW (a channel easing back up must not pump).
 * Direction is judged from the previous target — moving down (or holding) uses
 * the duck τ; moving up uses the release τ. Pure, so the choice is unit-tested.
 *
 * @param prevTarget the last commanded target (defaults to 1.0 = full/no duck).
 * @param nextTarget the new target being commanded.
 * @param duckTauS   fast time-constant, seconds (default 0.05).
 * @param releaseTauS slow time-constant, seconds (default 0.2).
 */
export function chooseDuckTau(
  prevTarget: number,
  nextTarget: number,
  duckTauS: number,
  releaseTauS: number
): number {
  return nextTarget < prevTarget ? duckTauS : releaseTauS
}
