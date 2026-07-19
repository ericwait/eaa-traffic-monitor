import type { ConfigResult } from '@shared/ipc'
import { Vad } from './vad'
import { StreamPlayer } from './streamPlayer'
import type { StreamPlayerState, StreamPlayerStatus } from './streamPlayer'
import { useAppStore } from '../state/store'
import type { AudioStreamUi, AudioStreamStatus } from '../state/store'

// The audio engine — a plain-TS singleton that owns the StreamPlayers and the
// ONE shared 50 ms tick. It lives for the life of the window (the audio
// authority; Web Audio can't span processes), so it is guarded against React
// StrictMode's double-mount and is never torn down on component unmount.
//
// The tick reads each stream's pre-gain analyser, computes RMS→dBFS, feeds that
// stream's VAD, and writes ONLY the post-hysteresis activity boolean (on change)
// into the zustand store — the high-frequency level numbers never leave the
// engine. Reconnect/status changes flow through the players' onStatus callback.
// The tick is setInterval, never requestAnimationFrame (rAF freezes when the
// window is hidden; backgroundThrottling is off on the main window).

/** Map the player's internal state to the coarser UI status chip. */
function toStatus(state: StreamPlayerState): AudioStreamStatus {
  switch (state) {
    case 'live':
      return 'live'
    case 'reconnecting':
      return 'reconnecting'
    case 'error':
      return 'error'
    default:
      // idle / resolving / connecting all read as "connecting" on the chip.
      return 'connecting'
  }
}

class AudioEngine {
  private started = false
  private readonly players = new Map<string, StreamPlayer>()
  private readonly vads = new Map<string, Vad>()
  private readonly lastActive = new Map<string, boolean>()
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private gestureAttached = false
  private lastNeedsGesture: boolean | null = null

  /**
   * Build the engine from config and start every stream. Idempotent: safe under
   * StrictMode's mount→unmount→mount, and never rebuilt while the window lives.
   */
  async ensureStarted(): Promise<void> {
    if (this.started) return
    this.started = true // set synchronously, before the await, so a racing
    // second StrictMode invocation returns immediately.
    let result: ConfigResult
    try {
      result = await window.api.config.get()
    } catch (err: unknown) {
      // config.get is written not to reject; guard anyway so a failure here
      // doesn't leave the panel silently empty.
      console.error('[audio] could not read config; audio is unavailable:', err)
      this.started = false
      return
    }
    this.build(result)
  }

  private build(result: ConfigResult): void {
    const { config } = result
    const isE2E = window.api.audio.isE2E
    const uiList: AudioStreamUi[] = []

    for (const stream of config.streams) {
      this.vads.set(stream.id, new Vad(config.vad))
      this.lastActive.set(stream.id, false)

      const player = new StreamPlayer({
        stream,
        fftSize: config.vad.fftSize,
        resolve: (id, opts) => window.api.audio.resolveStream(id, opts),
        onStatus: (status) => this.onPlayerStatus(stream.id, status),
        fastReconnect: isE2E,
        autoPlay: !isE2E
      })
      this.players.set(stream.id, player)

      uiList.push({
        id: stream.id,
        label: stream.label,
        status: 'connecting',
        attempt: 0,
        active: false,
        volume: stream.defaultVolume,
        muted: stream.muted,
        pan: stream.pan,
        priority: stream.priority,
        lastError: null,
        nextRetryAt: null
      })
    }

    const store = useAppStore.getState()
    store.initAudioStreams(uiList)
    store.setAudioBanner(this.bannerFor(result))

    for (const player of this.players.values()) player.start()

    // One shared 50 ms tick for every stream's VAD. Guard against a stray
    // double-build leaving two intervals running.
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this.tick(), config.vad.tickMs)
    this.attachGestureUnlock()
  }

  private tick(): void {
    const store = useAppStore.getState()

    for (const [id, player] of this.players) {
      const vad = this.vads.get(id)
      if (!vad) continue
      const active = vad.push(player.sampleLevelDb())
      if (active !== this.lastActive.get(id)) {
        this.lastActive.set(id, active)
        store.patchAudioStream(id, { active })
      }
    }

    // "Click to enable audio" hint tracks whether any context is autoplay-
    // suspended. Written only on change so the tick stays store-write-quiet.
    let anySuspended = false
    for (const player of this.players.values()) {
      if (player.suspended) {
        anySuspended = true
        break
      }
    }
    if (anySuspended !== this.lastNeedsGesture) {
      this.lastNeedsGesture = anySuspended
      store.setAudioNeedsGesture(anySuspended)
    }
  }

  private onPlayerStatus(id: string, status: StreamPlayerStatus): void {
    useAppStore.getState().patchAudioStream(id, {
      status: toStatus(status.state),
      attempt: status.attempt,
      lastError: status.error,
      nextRetryAt: status.nextRetryAt
    })
  }

  // --- user controls ------------------------------------------------------

  setVolume(id: string, volume: number): void {
    const v = clamp01(volume)
    this.players.get(id)?.setVolume(v)
    useAppStore.getState().patchAudioStream(id, { volume: v })
  }

  setMuted(id: string, muted: boolean): void {
    this.players.get(id)?.setMuted(muted)
    useAppStore.getState().patchAudioStream(id, { muted })
  }

  setPan(id: string, pan: number): void {
    const p = Math.max(-1, Math.min(1, pan))
    this.players.get(id)?.setPan(p)
    useAppStore.getState().patchAudioStream(id, { pan: p })
  }

  /** Re-read config.json and apply the new per-stream settings live. */
  async reload(): Promise<void> {
    let result: ConfigResult
    try {
      result = await window.api.config.reload()
    } catch (err: unknown) {
      console.error('[audio] config reload failed:', err)
      return
    }

    const store = useAppStore.getState()
    store.setAudioBanner(this.bannerFor(result))

    for (const stream of result.config.streams) {
      const player = this.players.get(stream.id)
      if (!player) continue
      player.setVolume(stream.defaultVolume)
      player.setMuted(stream.muted)
      player.setPan(stream.pan)
      store.patchAudioStream(stream.id, {
        label: stream.label,
        priority: stream.priority,
        volume: stream.defaultVolume,
        muted: stream.muted,
        pan: stream.pan
      })
    }

    // Adding/removing streams needs a rebuild — out of scope for a live reload
    // (stream-management UI is post-alpha). Name it rather than silently ignore.
    const nextIds = new Set(result.config.streams.map((s) => s.id))
    const added = [...nextIds].filter((id) => !this.players.has(id))
    const removed = [...this.players.keys()].filter((id) => !nextIds.has(id))
    if (added.length || removed.length) {
      console.warn(
        `[audio] config reload changed the stream set (added: ${added.join(', ') || 'none'}; ` +
          `removed: ${removed.join(', ') || 'none'}). Restart the app to apply add/remove.`
      )
    }
  }

  private bannerFor(result: ConfigResult): { message: string; filePath: string } | null {
    if (result.source === 'defaults-fallback' && result.error) {
      return { message: result.error, filePath: result.filePath }
    }
    return null
  }

  private attachGestureUnlock(): void {
    if (this.gestureAttached) return
    this.gestureAttached = true
    const handler = (): void => {
      for (const player of this.players.values()) void player.resume()
      // One real gesture unlocks the session; the per-stream resume watchdog
      // re-arms any context the OS later suspends, so we can stop listening.
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
    window.addEventListener('pointerdown', handler)
    window.addEventListener('keydown', handler)
  }
}

/** The single audio engine for this window. */
export const audioEngine = new AudioEngine()

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
