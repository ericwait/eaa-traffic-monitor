import type { ConfigResult } from '@shared/ipc'
import { Vad } from './vad'
import { StreamPlayer } from './streamPlayer'
import type { StreamPlayerState, StreamPlayerStatus } from './streamPlayer'
import { computeDuckTargets, chooseDuckTau } from './ducking'
import type { DuckStreamState } from './ducking'
import {
  enumerateOutputs,
  onDeviceChange,
  resolveSavedDevice,
  DEFAULT_DEVICE_ID,
  DEFAULT_DEVICE_LABEL
} from './devices'
import type { AudioDeviceSelection } from '@shared/ipc'
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

  // --- Ducking + solo (Phase 2b) ------------------------------------------
  /** Priority rank per stream (from config); lower = higher priority. */
  private readonly priorities = new Map<string, number>()
  /** Current mute state per stream — muted streams do not duck others. */
  private readonly mutedState = new Map<string, boolean>()
  /** Last-applied duck target per stream, so a ramp is re-issued only on change. */
  private readonly duckTargets = new Map<string, number>()
  /** The soloed stream id, or null. Momentary; never persisted. */
  private soloId: string | null = null
  /** Ducking parameters, refreshed from config on build/reload. */
  private duckLevel = 0.25
  private duckTauS = 0.05
  private releaseTauS = 0.2

  // --- Output-device routing (Phase 2b) -----------------------------------
  /** The operator's DESIRED output per stream (from session / picker); absent = default. */
  private readonly desiredDevices = new Map<string, AudioDeviceSelection>()
  /** Unsubscribe for the devicechange listener. */
  private deviceChangeUnsub: (() => void) | null = null

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

    // Ducking parameters for this session (tunable at the show via config.json).
    this.duckLevel = config.ducking.duckLevel
    this.duckTauS = config.ducking.duckTauS
    this.releaseTauS = config.ducking.releaseTauS

    for (const stream of config.streams) {
      this.vads.set(stream.id, new Vad(config.vad))
      this.lastActive.set(stream.id, false)
      this.priorities.set(stream.id, stream.priority)
      this.mutedState.set(stream.id, stream.muted)
      this.duckTargets.set(stream.id, 1)

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
        nextRetryAt: null,
        duckTarget: 1,
        deviceId: DEFAULT_DEVICE_ID,
        deviceLabel: DEFAULT_DEVICE_LABEL,
        deviceNotice: null
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

    // Enumerate output devices, restore any saved per-stream routing, and watch
    // for hot plug/unplug. Fire-and-forget: audio plays on the default output
    // while this resolves, so a slow enumerate never blocks startup.
    void this.initDevices()
  }

  private tick(): void {
    const store = useAppStore.getState()

    let vadChanged = false
    for (const [id, player] of this.players) {
      const vad = this.vads.get(id)
      if (!vad) continue
      const active = vad.push(player.sampleLevelDb())
      if (active !== this.lastActive.get(id)) {
        this.lastActive.set(id, active)
        store.patchAudioStream(id, { active })
        vadChanged = true
      }
    }

    // A change in who's talking changes who ducks. Recompute once per tick, not
    // per stream, so a burst of simultaneous key-ups is a single pass.
    if (vadChanged) this.recomputeDucking()

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
    this.mutedState.set(id, muted)
    useAppStore.getState().patchAudioStream(id, { muted })
    // A stream that just muted stops ducking others; one that just unmuted may
    // start. Recompute so the mix reflects the new set of active DUCKERS.
    this.recomputeDucking()
  }

  setPan(id: string, pan: number): void {
    const p = Math.max(-1, Math.min(1, pan))
    this.players.get(id)?.setPan(p)
    useAppStore.getState().patchAudioStream(id, { pan: p })
  }

  // --- Solo + ducking -----------------------------------------------------

  /** Toggle solo on a stream: soloing it again (or Escape → setSolo(null)) releases. */
  toggleSolo(id: string): void {
    this.setSolo(this.soloId === id ? null : id)
  }

  /**
   * Set (or clear) the soloed stream. Solo overrides everything: the soloed
   * stream is force-unmuted and rides full, every other stream is silenced via
   * its duck gain, and releasing restores the prior mix through the same ramps.
   */
  setSolo(id: string | null): void {
    if (id !== null && !this.players.has(id)) return
    this.soloId = id
    for (const [pid, player] of this.players) {
      player.setSoloOverride(id !== null && pid === id)
    }
    useAppStore.getState().setAudioSolo(id)
    this.recomputeDucking()
  }

  /** True while a solo is held — lets the panel's Escape handler no-op otherwise. */
  get hasSolo(): boolean {
    return this.soloId !== null
  }

  /**
   * Recompute every stream's duck target from the current VAD/mute/solo state and
   * apply the changed ones with asymmetric ramps (fast to duck, slow to release).
   * Only streams whose target actually moved get a fresh setTargetAtTime, so a
   * steady mix issues no ramps at all.
   */
  private recomputeDucking(): void {
    const store = useAppStore.getState()

    const inputs: DuckStreamState[] = []
    for (const id of this.players.keys()) {
      inputs.push({
        id,
        priority: this.priorities.get(id) ?? Number.MAX_SAFE_INTEGER,
        vadActive: this.lastActive.get(id) ?? false,
        muted: this.mutedState.get(id) ?? false
      })
    }

    const targets = computeDuckTargets(inputs, this.soloId, this.duckLevel)
    for (const [id, target] of targets) {
      const prev = this.duckTargets.get(id) ?? 1
      if (prev === target) continue
      const tau = chooseDuckTau(prev, target, this.duckTauS, this.releaseTauS)
      this.duckTargets.set(id, target)
      this.players.get(id)?.setDuckTarget(target, tau)
      store.patchAudioStream(id, { duckTarget: target })
    }
  }

  // --- Output-device routing ----------------------------------------------

  /**
   * Route one stream to an output device ('' = system default) and remember the
   * choice in session.json. The label is stored alongside the id so a replug that
   * hands the same physical device a fresh id still resolves (match-by-label).
   */
  async setStreamOutputDevice(id: string, deviceId: string, deviceLabel: string): Promise<void> {
    const player = this.players.get(id)
    if (!player) return
    const store = useAppStore.getState()

    if (deviceId === DEFAULT_DEVICE_ID) {
      this.desiredDevices.delete(id)
      window.api.session.patch({ audio: { devices: { [id]: null } } })
    } else {
      this.desiredDevices.set(id, { deviceId, deviceLabel })
      window.api.session.patch({ audio: { devices: { [id]: { deviceId, deviceLabel } } } })
    }

    const res = await player.setOutputDevice(deviceId)
    if (res.ok) {
      store.patchAudioStream(id, {
        deviceId,
        deviceLabel: deviceId === DEFAULT_DEVICE_ID ? DEFAULT_DEVICE_LABEL : deviceLabel,
        deviceNotice: null
      })
    } else {
      // Routing failed (unexpected — the spike passed). Say so on the strip and
      // leave the audible route where it was rather than pretending it moved.
      store.patchAudioStream(id, { deviceNotice: res.error ?? 'could not route to that device' })
    }
  }

  /** Load saved routes, enumerate devices, apply them, and watch for hot changes. */
  private async initDevices(): Promise<void> {
    try {
      const session = await window.api.session.get()
      for (const [id, sel] of Object.entries(session.audio?.devices ?? {})) {
        if (this.players.has(id)) this.desiredDevices.set(id, sel)
      }
    } catch (err: unknown) {
      console.warn('[audio] could not read saved output-device routes:', err)
    }

    await this.refreshDevices()

    if (!this.deviceChangeUnsub) {
      this.deviceChangeUnsub = onDeviceChange(() => void this.refreshDevices())
    }
  }

  /** Re-enumerate outputs into the store and reconcile every stream's route. */
  private async refreshDevices(): Promise<void> {
    const outputs = await enumerateOutputs()
    useAppStore.getState().setAudioOutputs(outputs)
    await this.reconcileDevices(outputs)
  }

  /**
   * Reconcile each stream's DESIRED route against the devices that exist right
   * now: keep an exact match, follow a replug (id changed, label the same) and
   * re-persist, or fall back to the default with a visible notice when the device
   * is simply gone. Idempotent — only touches a stream whose route actually moves.
   */
  private async reconcileDevices(
    outputs: readonly { deviceId: string; label: string }[]
  ): Promise<void> {
    const store = useAppStore.getState()

    for (const id of this.players.keys()) {
      const player = this.players.get(id)
      if (!player) continue

      const res = resolveSavedDevice(this.desiredDevices.get(id), outputs)
      let targetId = DEFAULT_DEVICE_ID
      let targetLabel = DEFAULT_DEVICE_LABEL
      let notice: string | null = null

      switch (res.kind) {
        case 'default':
          break
        case 'exact':
          targetId = res.device.deviceId
          targetLabel = res.device.label
          break
        case 'relabelled':
          targetId = res.device.deviceId
          targetLabel = res.device.label
          this.desiredDevices.set(id, { deviceId: targetId, deviceLabel: targetLabel })
          window.api.session.patch({
            audio: { devices: { [id]: { deviceId: targetId, deviceLabel: targetLabel } } }
          })
          break
        case 'missing':
          notice = `“${res.savedLabel}” was disconnected — now on the system default output.`
          break
      }

      if (player.outputDevice !== targetId) {
        const applied = await player.setOutputDevice(targetId)
        if (!applied.ok) notice = applied.error ?? notice
      }

      // Read fresh (not the pre-await snapshot) so the skip-if-unchanged compare
      // sees current state after any awaited setOutputDevice above.
      const cur = useAppStore.getState().audioStreams[id]
      if (
        !cur ||
        cur.deviceId !== targetId ||
        cur.deviceLabel !== targetLabel ||
        cur.deviceNotice !== notice
      ) {
        store.patchAudioStream(id, {
          deviceId: targetId,
          deviceLabel: targetLabel,
          deviceNotice: notice
        })
      }
    }
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

    // Ducking params are live-tunable too — pick up any edits before recomputing.
    this.duckLevel = result.config.ducking.duckLevel
    this.duckTauS = result.config.ducking.duckTauS
    this.releaseTauS = result.config.ducking.releaseTauS

    for (const stream of result.config.streams) {
      const player = this.players.get(stream.id)
      if (!player) continue
      player.setVolume(stream.defaultVolume)
      player.setMuted(stream.muted)
      player.setPan(stream.pan)
      this.priorities.set(stream.id, stream.priority)
      this.mutedState.set(stream.id, stream.muted)
      store.patchAudioStream(stream.id, {
        label: stream.label,
        priority: stream.priority,
        volume: stream.defaultVolume,
        muted: stream.muted,
        pan: stream.pan
      })
    }

    // Priorities / mutes / duck level may all have changed — re-derive the mix.
    this.recomputeDucking()

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
