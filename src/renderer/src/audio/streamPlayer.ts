import type { StreamConfig } from '@shared/defaultConfig'
import type { ResolveFailureKind, ResolveStreamResult } from '@shared/ipc'
import { DEFAULT_DEVICE_ID } from './devices'

/** The AudioContext.setSinkId shape — typed locally since lib.dom lags Chromium. */
type SinkCapableContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }

/** The outcome of a per-stream output-device route change. */
export interface SetOutputResult {
  ok: boolean
  /** A 6-a.m.-actionable message when ok is false. */
  error?: string
}

// One ATC stream's audio unit: its own AudioContext, an <audio> element, the
// Web Audio graph, and the reconnect state machine. No React, no store — it
// reports state through a callback so the engine can mirror it into zustand.
//
// Two load-bearing graph rules (see CLAUDE.md):
//   * the AnalyserNode taps the SOURCE, parallel and PRE-gain — measuring after
//     the gain/duck stages would create a feedback loop in Phase 2b's ducking,
//   * mute is the user-volume gain driven to 0, NEVER element.muted — the
//     activity light must keep reading the signal while the stream is muted.
//
//   <audio crossorigin> ─ MediaElementSource ┬─ Analyser            (VAD tap)
//                                            └─ userGain ─ duckGain ─ panner ─ destination
//
// The persistent nodes (analyser, userGain, duckGain, panner) and the context
// live for the whole session; only the <audio> element + its source node are
// rebuilt on each (re)connect, so volume / mute / pan survive reconnects.
//
// Reconnect triggers are element 'error', element 'ended', and a currentTime
// stall watchdog — NEVER VAD silence: a squelched frequency is legitimately
// silent for minutes and must not be mistaken for a dead stream.

/** The reconnect state machine's states. */
export type StreamPlayerState =
  'idle' | 'resolving' | 'connecting' | 'live' | 'reconnecting' | 'error'

/** A status snapshot pushed to the engine on every state change. */
export interface StreamPlayerStatus {
  state: StreamPlayerState
  /** Reconnect attempt count (0 while live or on the first connect). */
  attempt: number
  /** Last failure message, or null. */
  error: string | null
  /** Epoch ms of the next scheduled retry, for the countdown tooltip, or null. */
  nextRetryAt: number | null
}

export interface StreamPlayerOptions {
  stream: StreamConfig
  /** AnalyserNode FFT size (from config.vad.fftSize). */
  fftSize: number
  /** Resolve a stream id to a playable URL (the IPC bridge). */
  resolve: (streamId: string, opts: { fresh: boolean }) => Promise<ResolveStreamResult>
  /** Called on every state change so the engine can update the store. */
  onStatus: (status: StreamPlayerStatus) => void
  /** e2e: collapse backoff so the smoke test never waits on the network. */
  fastReconnect?: boolean
  /** e2e: skip audible autoplay (no user gesture, no autoplay warnings). */
  autoPlay?: boolean
}

/** Exponential backoff schedule in seconds; the last value is the cap. */
const BACKOFF_SECONDS = [1, 2, 4, 8, 15, 30]
/** Backoff used under the e2e harness — long enough to be real, short to not wait. */
const FAST_BACKOFF_MS = 120
/** currentTime must advance within this window or the stream is deemed stalled. */
const STALL_MS = 6_000
/** Watchdog cadence (resume re-arm + stall check). Distinct from the 50 ms VAD tick. */
const WATCHDOG_MS = 2_000

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class StreamPlayer {
  readonly id: string

  private readonly opts: StreamPlayerOptions
  private readonly ctx: AudioContext
  private readonly analyser: AnalyserNode
  private readonly userGain: GainNode
  private readonly duckGain: GainNode
  private readonly panner: StereoPannerNode
  private readonly timeBuf: Float32Array<ArrayBuffer>

  private audioEl: HTMLAudioElement | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null

  private state: StreamPlayerState = 'idle'
  private attempt = 0
  private lastError: string | null = null
  private nextRetryAt: number | null = null

  private volume: number
  private muted: boolean
  private pan: number

  // Priority-ducking (Phase 2b). duckGain rides at 1.0 (no duck) and is driven to
  // config.ducking.duckLevel when a strictly-higher stream is active; the engine
  // computes the target + ramp τ and calls setDuckTarget. `duckTarget` mirrors the
  // last commanded value for the dev duck-telemetry readout.
  private duckTarget = 1
  // Solo momentarily overrides mute (design: solo overrides everything, mutes
  // included): while soloOverride is on, the user-gain uses volume even if muted.
  private soloOverride = false
  /** The currently-routed output device id ('' = system default). */
  private outputDeviceId: string = DEFAULT_DEVICE_ID

  private intendedPlaying = false
  private unlocked = false
  private destroyed = false

  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private lastCurrentTime = 0
  private lastProgressTs = 0

  // Bound element handlers, added/removed by reference so a rebuilt element can
  // never leave a stray listener firing against the wrong stream.
  private readonly onElPlaying = (): void => this.handlePlaying()
  private readonly onElError = (): void => {
    const mediaErr = this.audioEl?.error
    this.handleFailure(`playback error${mediaErr ? ` (code ${mediaErr.code})` : ''}`, 'network')
  }
  private readonly onElEnded = (): void => this.handleFailure('stream ended', 'network')

  constructor(opts: StreamPlayerOptions) {
    this.opts = opts
    this.id = opts.stream.id
    this.volume = opts.stream.defaultVolume
    this.muted = opts.stream.muted
    this.pan = opts.stream.pan

    this.ctx = new AudioContext()

    // Persistent graph. The analyser is a parallel dead-end tap off the source
    // (built per connect); the audible chain is userGain -> duckGain -> panner.
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = opts.fftSize
    this.timeBuf = new Float32Array(this.analyser.fftSize)

    this.userGain = this.ctx.createGain()
    this.duckGain = this.ctx.createGain()
    this.panner = this.ctx.createStereoPanner()

    // duckGain is fixed at 1.0 this phase; Phase 2b drives it.
    this.duckGain.gain.value = 1
    this.panner.pan.value = this.pan
    this.userGain.gain.value = this.muted ? 0 : this.volume

    this.userGain.connect(this.duckGain)
    this.duckGain.connect(this.panner)
    this.panner.connect(this.ctx.destination)
  }

  // --- lifecycle ----------------------------------------------------------

  /** Begin connecting and arm the watchdog. Idempotent-ish: call once. */
  start(): void {
    if (this.destroyed || this.intendedPlaying) return
    this.intendedPlaying = true
    this.watchdogTimer = setInterval(() => this.watchdog(), WATCHDOG_MS)
    void this.doAttempt(false)
  }

  /**
   * User-gesture unlock: resume the (autoplay-suspended) context and retry play.
   * Safe to call repeatedly; the first real gesture is what actually unlocks.
   */
  async resume(): Promise<void> {
    this.unlocked = true
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch (err: unknown) {
        console.warn(`[audio:${this.id}] context resume failed:`, err)
      }
    }
    if (this.intendedPlaying) this.tryPlay()
  }

  /** Tear everything down; the context is closed. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.intendedPlaying = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.retryTimer = null
    this.watchdogTimer = null
    this.teardownAudio()
    this.ctx.close().catch(() => {
      /* already closing — ignore */
    })
  }

  // --- controls (never touch element.muted / element.volume) --------------

  /** Set the remembered slider volume (0..1); applied unless currently muted. */
  setVolume(volume: number): void {
    this.volume = clamp01(volume)
    this.applyGain()
  }

  /** Mute/unmute by driving the user gain to 0, remembering the slider value. */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyGain()
  }

  /** Set stereo pan (-1..1). */
  setPan(pan: number): void {
    this.pan = Math.max(-1, Math.min(1, pan))
    this.setParam(this.panner.pan, this.pan)
  }

  /**
   * Drive the duck gain toward `target` (0..1) with the given ramp time-constant.
   * setTargetAtTime departs from the CURRENT value, so no cancel/dance is needed;
   * the engine picks the τ (fast to duck, slow to release). Idempotent on the
   * value, but always re-issues so a ramp interrupted mid-flight resumes cleanly.
   */
  setDuckTarget(target: number, tauS: number): void {
    this.duckTarget = target
    this.setParam(this.duckGain.gain, target, tauS)
  }

  /** The last commanded duck target (dev telemetry / verification readout). */
  get duckTargetValue(): number {
    return this.duckTarget
  }

  /**
   * Solo momentarily overrides mute. While active the user-gain uses the slider
   * volume even if the stream is muted (design: solo overrides everything). The
   * user's mute intent is untouched — it re-applies the instant solo releases.
   */
  setSoloOverride(active: boolean): void {
    if (this.soloOverride === active) return
    this.soloOverride = active
    this.applyGain()
  }

  /**
   * Route this stream's audio to a specific output device via the context's
   * setSinkId ('' = system default). The 2026-07-19 spike confirmed
   * AudioContext.setSinkId works in this Electron, so this is the primary path;
   * see the graceful degrade below for the (unexpected) absent case.
   */
  async setOutputDevice(deviceId: string): Promise<SetOutputResult> {
    this.outputDeviceId = deviceId
    const ctx = this.ctx as SinkCapableContext

    if (typeof ctx.setSinkId !== 'function') {
      // Not seen in Electron 43 (spike passed). The documented pivot per the plan
      // is a per-stream MediaStreamAudioDestinationNode -> hidden <audio>.setSinkId,
      // confined to this file. It is intentionally NOT built: the spike proved the
      // context path works, so building the unused pivot would be dead weight. If a
      // future Electron drops context.setSinkId, that pivot lands here. For now we
      // degrade to the default output and say so, rather than pretending to route.
      const error =
        'this build cannot route audio to a specific output device ' +
        '(AudioContext.setSinkId unavailable); staying on the system default'
      console.error(`[audio:${this.id}] ${error}`)
      return { ok: false, error }
    }

    try {
      await ctx.setSinkId(deviceId)
      return { ok: true }
    } catch (err: unknown) {
      const error = `could not route "${this.id}" to the selected output: ${errMessage(err)}`
      console.error(`[audio:${this.id}] setSinkId("${deviceId}") failed:`, err)
      return { ok: false, error }
    }
  }

  /** The currently-routed output device id ('' = system default). */
  get outputDevice(): string {
    return this.outputDeviceId
  }

  // --- reads for the engine tick ------------------------------------------

  /**
   * Current RMS level of the pre-gain tap in dBFS (−Infinity for silence). The
   * engine calls this once per 50 ms tick and feeds it to this stream's VAD.
   */
  sampleLevelDb(): number {
    this.analyser.getFloatTimeDomainData(this.timeBuf)
    let sumSquares = 0
    for (let i = 0; i < this.timeBuf.length; i++) {
      const s = this.timeBuf[i]
      sumSquares += s * s
    }
    const rms = Math.sqrt(sumSquares / this.timeBuf.length)
    return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY
  }

  /** True while this stream's context is autoplay-suspended (needs a gesture). */
  get suspended(): boolean {
    return this.ctx.state === 'suspended'
  }

  // --- internals ----------------------------------------------------------

  private async doAttempt(fresh: boolean): Promise<void> {
    if (this.destroyed) return

    // The first connect shows resolving -> connecting; a reconnect keeps its
    // 'reconnecting'/'error' chip (with attempt + countdown) while re-resolving.
    if (!fresh) this.setState('resolving')

    let result: ResolveStreamResult
    try {
      result = await this.opts.resolve(this.id, { fresh })
    } catch (err: unknown) {
      this.handleFailure(`could not resolve stream: ${errMessage(err)}`, 'network')
      return
    }
    if (this.destroyed) return

    if (!result.ok) {
      this.handleFailure(result.error, result.kind)
      return
    }

    this.buildAudio(result.finalUrl)
    if (!fresh) this.setState('connecting')
    if (this.opts.autoPlay !== false) this.tryPlay()
  }

  private buildAudio(url: string): void {
    this.teardownAudio()

    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.autoplay = false
    el.src = url
    el.addEventListener('playing', this.onElPlaying)
    el.addEventListener('error', this.onElError)
    el.addEventListener('ended', this.onElEnded)
    this.audioEl = el

    // Wire a fresh source into the SAME living chain: parallel analyser tap plus
    // the audible userGain path. Settings on the persistent nodes are untouched.
    const source = this.ctx.createMediaElementSource(el)
    source.connect(this.analyser)
    source.connect(this.userGain)
    this.sourceNode = source

    el.load()
  }

  private teardownAudio(): void {
    const el = this.audioEl
    const source = this.sourceNode
    this.audioEl = null
    this.sourceNode = null

    if (source) {
      try {
        source.disconnect()
      } catch {
        /* ignore */
      }
    }
    if (el) {
      el.removeEventListener('playing', this.onElPlaying)
      el.removeEventListener('error', this.onElError)
      el.removeEventListener('ended', this.onElEnded)
      try {
        el.pause()
        el.removeAttribute('src')
        el.load() // abort the in-flight fetch
      } catch {
        /* ignore */
      }
    }
  }

  private tryPlay(): void {
    const el = this.audioEl
    if (!el) return
    const promise = el.play()
    if (promise) {
      promise.catch((err: unknown) => {
        // Blocked by autoplay policy → wait for a user gesture (resume()); it is
        // NOT a connection failure, so don't reconnect. Any other rejection is.
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotAllowedError' || name === 'AbortError') {
          console.debug(`[audio:${this.id}] play() deferred (${name}); awaiting gesture`)
          return
        }
        this.handleFailure(`could not start playback: ${errMessage(err)}`, 'network')
      })
    }
  }

  private handlePlaying(): void {
    if (this.destroyed) return
    this.attempt = 0
    this.lastError = null
    this.nextRetryAt = null
    this.lastCurrentTime = this.audioEl?.currentTime ?? 0
    this.lastProgressTs = Date.now()
    this.setState('live')
  }

  private handleFailure(error: string, kind: ResolveFailureKind): void {
    if (this.destroyed) return
    // Ignore duplicate/stray failures once a retry is already scheduled.
    if (this.retryTimer !== null) return

    this.teardownAudio()
    this.attempt += 1
    this.lastError = error

    // notfound/parse point at config or a malformed playlist — flag them as
    // 'error' for attention, but still retry (a config reload or a transient
    // server hiccup can fix them); network failures are ordinary reconnects.
    const state: StreamPlayerState =
      kind === 'notfound' || kind === 'parse' ? 'error' : 'reconnecting'

    const delay = this.backoffDelay()
    this.nextRetryAt = Date.now() + delay
    this.setState(state)
    console.warn(
      `[audio:${this.id}] ${error} — reconnecting in ${Math.round(delay / 1000)}s ` +
        `(attempt ${this.attempt})`
    )

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.doAttempt(true)
    }, delay)
  }

  private backoffDelay(): number {
    if (this.opts.fastReconnect) return FAST_BACKOFF_MS
    const base = BACKOFF_SECONDS[Math.min(this.attempt - 1, BACKOFF_SECONDS.length - 1)] * 1000
    const jitter = base * (Math.random() * 0.4 - 0.2) // ±20%
    return Math.max(250, Math.round(base + jitter))
  }

  private watchdog(): void {
    if (this.destroyed) return

    // Resume watchdog: re-arm a context the OS suspended out from under a
    // long-running window, once the user has unlocked audio.
    if (this.unlocked && this.ctx.state === 'suspended' && this.intendedPlaying) {
      this.ctx.resume().catch(() => {
        /* ignore */
      })
    }

    // Stall watchdog: only meaningful when we believe we are live and playing.
    // Silence is NOT a stall — we watch currentTime, not the VAD.
    if (
      this.state === 'live' &&
      this.intendedPlaying &&
      this.ctx.state === 'running' &&
      this.audioEl &&
      !this.audioEl.paused
    ) {
      const t = this.audioEl.currentTime
      const now = Date.now()
      if (t > this.lastCurrentTime + 1e-4) {
        this.lastCurrentTime = t
        this.lastProgressTs = now
      } else if (now - this.lastProgressTs > STALL_MS) {
        this.handleFailure('stream stalled (no audio progress for 6s)', 'network')
      }
    }
  }

  private applyGain(): void {
    // Solo overrides mute: while soloOverride is on, a muted stream is still
    // audible at its slider volume. Volume 0 stays silent — solo overrides the
    // mute gesture, not the volume setting.
    const effectiveMuted = this.muted && !this.soloOverride
    this.setParam(this.userGain.gain, effectiveMuted ? 0 : this.volume)
  }

  /**
   * Ramp an AudioParam smoothly to avoid clicks (no-op if the context is dead).
   * The default τ (15 ms) suits volume/mute/pan clicks; ducking passes its own
   * asymmetric τ (fast duck / slow release).
   */
  private setParam(param: AudioParam, value: number, tauS = 0.015): void {
    try {
      param.setTargetAtTime(value, this.ctx.currentTime, tauS)
    } catch {
      // Fallback for environments without setTargetAtTime timing support.
      param.value = value
    }
  }

  private setState(state: StreamPlayerState): void {
    this.state = state
    this.opts.onStatus({
      state,
      attempt: this.attempt,
      error: this.lastError,
      nextRetryAt: this.nextRetryAt
    })
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
