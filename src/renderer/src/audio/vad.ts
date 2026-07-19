// Voice-activity detection — the math behind every ATC activity light.
//
// PURE by design: this module is fed one RMS-dBFS level per tick and returns a
// post-hysteresis boolean. It imports nothing (no Web Audio, no React, no
// config) so the whole adaptive-floor + hysteresis + attack + hang behaviour is
// exercised directly in vitest. The engine computes the dBFS levels off each
// stream's AnalyserNode and drives an instance of this per stream.
//
// The problem it solves: an ATC frequency is mostly squelched hiss with brief,
// loud transmissions on top. A fixed threshold fails because each stream's hiss
// sits at a different level and drifts. So the detector learns each stream's own
// noise floor and lights only when the signal rises clearly above it:
//
//   * adaptive floor — falls FAST toward a new quiet level (so a stream that
//     goes quiet becomes sensitive again quickly) but rises only SLOWLY (so it
//     never chases a transmission upward), and is FROZEN while a transmission is
//     active (so a long call can't drag the floor up under itself),
//   * dual-threshold hysteresis — latch on at floor + activeThresholdDb, release
//     below floor + releaseThresholdDb (release < active), so a signal hovering
//     near threshold doesn't chatter,
//   * attack — require attackTicks consecutive ticks above the active threshold
//     before latching, to reject single-tick pops, and
//   * hang — after the signal drops, stay lit for hangMs, bridging the brief
//     un-key/re-key gaps between overlapping words so the light doesn't flicker
//     mid-call.

/**
 * VAD tuning parameters. Structurally identical to the `vad` block of the config
 * schema (see `@shared/defaultConfig`), so `config.vad` feeds this directly.
 * Duplicated here as a plain interface to keep this module import-free and pure.
 */
export interface VadParams {
  /** Tick period in ms — used to convert hangMs into a tick countdown. */
  tickMs: number
  /** AnalyserNode FFT size. Unused by the math here; carried for the engine. */
  fftSize: number
  /** Initial noise-floor estimate, dBFS. */
  floorInitDb: number
  /** [min, max] clamp on the adaptive floor, dBFS. */
  floorClampDb: [number, number]
  /** EMA weight when the level is below the floor (fast fall toward quiet). */
  floorFallAlpha: number
  /** EMA weight when the level is above the floor (slow rise; never chase signal). */
  floorRiseAlpha: number
  /** Light latches on this many dB above the floor. */
  activeThresholdDb: number
  /** Light releases below this many dB above the floor (must be < active). */
  releaseThresholdDb: number
  /** Consecutive ticks above the active threshold required to latch on. */
  attackTicks: number
  /** Hang time in ms that bridges inter-word un-key/re-key gaps. */
  hangMs: number
}

/**
 * A single stream's voice-activity detector. Construct one per stream, then call
 * {@link push} once per tick with that stream's current RMS level in dBFS.
 * `push` returns the current activity state (also readable via {@link active}).
 */
export class Vad {
  private readonly params: VadParams
  private floor: number
  private isActive = false
  private attackCount = 0
  private hangRemainingMs = 0

  constructor(params: VadParams) {
    this.params = params
    this.floor = clamp(params.floorInitDb, params.floorClampDb[0], params.floorClampDb[1])
  }

  /** The learned noise floor in dBFS (clamped). Exposed for tests/diagnostics. */
  get floorDb(): number {
    return this.floor
  }

  /** The current post-hysteresis activity state. */
  get active(): boolean {
    return this.isActive
  }

  /**
   * Advance one tick.
   *
   * @param levelDb the stream's current RMS level in dBFS. May be `-Infinity`
   *   for digital silence; it is handled by the floor clamp.
   * @returns the activity state after this tick.
   */
  push(levelDb: number): boolean {
    const p = this.params

    // Thresholds are relative to the CURRENT floor, evaluated before the floor
    // adapts this tick.
    const activeThreshold = this.floor + p.activeThresholdDb
    const releaseThreshold = this.floor + p.releaseThresholdDb

    // --- Floor adaptation (skipped while active: a transmission must not drag
    // its own floor up) -----------------------------------------------------
    if (!this.isActive) {
      if (levelDb < this.floor) {
        // Below the floor: fall fast toward the new quiet level.
        this.floor += p.floorFallAlpha * (levelDb - this.floor)
      } else {
        // Above the floor but not (yet) a latched signal: rise slowly.
        this.floor += p.floorRiseAlpha * (levelDb - this.floor)
      }
      this.floor = clamp(this.floor, p.floorClampDb[0], p.floorClampDb[1])
    }

    // --- Hysteresis + attack + hang ----------------------------------------
    if (this.isActive) {
      if (levelDb >= releaseThreshold) {
        // Still talking (or a loud-enough word): refresh the full hang window.
        this.hangRemainingMs = p.hangMs
      } else {
        // Signal has dropped below release — run down the hang window, which
        // bridges the short gaps between overlapping words.
        this.hangRemainingMs -= p.tickMs
        if (this.hangRemainingMs <= 0) {
          this.isActive = false
          this.hangRemainingMs = 0
          this.attackCount = 0
        }
      }
    } else if (levelDb >= activeThreshold) {
      // Building toward a latch: require attackTicks in a row.
      this.attackCount += 1
      if (this.attackCount >= p.attackTicks) {
        this.isActive = true
        this.attackCount = 0
        this.hangRemainingMs = p.hangMs
      }
    } else {
      // Fell back below the active threshold before latching — reset attack.
      this.attackCount = 0
    }

    return this.isActive
  }

  /** Reset detection state (e.g. on reconnect). The learned floor is retained. */
  reset(): void {
    this.isActive = false
    this.attackCount = 0
    this.hangRemainingMs = 0
  }
}

/** Clamp `value` into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
