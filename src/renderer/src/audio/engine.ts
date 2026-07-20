import type { ConfigResult } from '@shared/ipc'
import type { LiveAtcFeed } from '@shared/liveatcDirectory'
import { Vad } from './vad'
import { StreamPlayer } from './streamPlayer'
import type { StreamPlayerState, StreamPlayerStatus } from './streamPlayer'
import { computeDuckTargets, chooseDuckTau } from './ducking'
import type { DuckStreamState } from './ducking'
import { isFeedDown } from './backoff'
import {
  enumerateOutputs,
  onDeviceChange,
  resolveSavedDevice,
  DEFAULT_DEVICE_ID,
  DEFAULT_DEVICE_LABEL
} from './devices'
import type { AudioDeviceSelection } from '@shared/ipc'
import type { StreamConfig, VadConfig } from '@shared/defaultConfig'
import { useAppStore } from '../state/store'
import type { AudioStreamUi, AudioStreamStatus } from '../state/store'
import { sessionSnapshot } from '../state/sessionBootstrap'

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

/**
 * Map the player's internal state (+ consecutive-failure count) to the UI status
 * pill. A reconnecting stream that has failed enough times reads as the calmer
 * 'feed-down' rather than an ever-climbing 'reconnecting · n' (decision 2026-07-19).
 */
function toStatus(state: StreamPlayerState, attempt: number): AudioStreamStatus {
  switch (state) {
    case 'disconnected':
      return 'disconnected'
    case 'live':
      return 'live'
    case 'error':
      return 'error'
    case 'reconnecting':
      return isFeedDown(attempt) ? 'feed-down' : 'reconnecting'
    default:
      // connecting reads as "connecting" on the pill.
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

  // --- On-demand connection (decision 2026-07-19) -------------------------
  /**
   * Timers for the staggered restore of the saved-connected set. Held so a manual
   * connect/disconnect during the stagger window can cancel any still-pending
   * restore for that stream (we never fight the operator's live choice).
   */
  private readonly restoreTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Gap between staggered restore connects — be polite to LiveATC, never fire N at once. */
  private restoreStaggerMs = 750

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

    // Per-stream volume/mute/pan restore (Phase 4): the session (loaded before
    // mount, read synchronously here) overrides the config defaults. Priority is
    // NOT restored — config.json stays its tuning surface — so it comes from
    // config every launch. Seed the player via an effective config so its initial
    // gain/pan are correct from the first sample (no restore flash on the light).
    const savedStreams = sessionSnapshot().audio.streams

    for (const stream of config.streams) {
      uiList.push(this.createStream(stream, config.vad, isE2E, savedStreams[stream.id]))
    }

    const store = useAppStore.getState()
    store.initAudioStreams(uiList)
    store.setAudioBanner(this.bannerFor(result))

    // On-demand connection (decision 2026-07-19): streams start DISCONNECTED and
    // do nothing until connected. Restore the operator's saved-connected set,
    // STAGGERED so we never fire N simultaneous connects at LiveATC. First run /
    // no saved entry → disconnected. Under e2e we deliberately skip restore so the
    // smoke starts from a deterministic all-disconnected default regardless of any
    // session.json on the box.
    if (!isE2E) {
      const wanted = config.streams.filter((s) => savedStreams[s.id]?.connected === true)
      this.scheduleRestore(wanted.map((s) => s.id))
    }

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

  /**
   * Create one stream's player + VAD + engine bookkeeping and return its initial
   * UI entry. Shared by the initial build (which merges saved session settings
   * over the config defaults) and a live add from the channel manager (no saved
   * settings — a brand-new stream starts on its config defaults, disconnected).
   */
  private createStream(
    stream: StreamConfig,
    vadConfig: VadConfig,
    isE2E: boolean,
    saved?: { volume?: number; muted?: boolean; pan?: number }
  ): AudioStreamUi {
    const volume = clamp01(saved?.volume ?? stream.defaultVolume)
    const muted = saved?.muted ?? stream.muted
    const pan = clampPan(saved?.pan ?? stream.pan)
    const effective: StreamConfig = { ...stream, defaultVolume: volume, muted, pan }

    this.vads.set(stream.id, new Vad(vadConfig))
    this.lastActive.set(stream.id, false)
    this.priorities.set(stream.id, stream.priority)
    this.mutedState.set(stream.id, muted)
    this.duckTargets.set(stream.id, 1)

    const player = new StreamPlayer({
      stream: effective,
      fftSize: vadConfig.fftSize,
      resolve: (id, opts) => window.api.audio.resolveStream(id, opts),
      onStatus: (status) => this.onPlayerStatus(stream.id, status),
      fastReconnect: isE2E,
      autoPlay: !isE2E
    })
    this.players.set(stream.id, player)

    return {
      id: stream.id,
      label: stream.label,
      status: 'disconnected',
      attempt: 0,
      active: false,
      volume,
      muted,
      pan,
      priority: stream.priority,
      lastError: null,
      nextRetryAt: null,
      duckTarget: 1,
      deviceId: DEFAULT_DEVICE_ID,
      deviceLabel: DEFAULT_DEVICE_LABEL,
      deviceNotice: null
    }
  }

  /**
   * Tear down one stream completely: cancel any pending restore, release its
   * solo if held, destroy the player (closes the AudioContext), and drop every
   * per-stream map entry so a future stream reusing the id starts clean.
   */
  private destroyStream(id: string): void {
    this.cancelRestore(id)
    if (this.soloId === id) this.setSolo(null)
    this.players.get(id)?.destroy()
    this.players.delete(id)
    this.vads.delete(id)
    this.lastActive.delete(id)
    this.priorities.delete(id)
    this.mutedState.delete(id)
    this.duckTargets.delete(id)
    this.desiredDevices.delete(id)
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

    // "Click to enable audio" hint tracks whether any WANTED (connected) stream's
    // context is autoplay-suspended. Disconnected streams never trigger the hint —
    // their contexts idle suspended by design, and nagging about audio nobody
    // asked for would be noise. Written only on change so the tick stays quiet.
    let anySuspended = false
    for (const player of this.players.values()) {
      if (player.connectionWanted && player.suspended) {
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
      status: toStatus(status.state, status.attempt),
      attempt: status.attempt,
      lastError: status.error,
      nextRetryAt: status.nextRetryAt
    })
  }

  // --- On-demand connection (decision 2026-07-19) -------------------------

  /**
   * Toggle a stream between connected and disconnected — the status-pill click.
   * A disconnected stream connects (fresh resolve + play); any live/connecting/
   * reconnecting/feed-down/error stream disconnects and cancels its retry timer.
   */
  toggleConnected(id: string): void {
    const player = this.players.get(id)
    if (!player) return
    if (player.connectionWanted) this.disconnect(id)
    else this.connect(id)
  }

  /** Connect a stream on demand and persist that it is wanted. */
  connect(id: string): void {
    const player = this.players.get(id)
    if (!player) return
    // A manual connect cancels any pending staggered restore for this stream so
    // the restore callback doesn't later fight (or double-fire) the live choice.
    this.cancelRestore(id)
    player.connect()
    window.api.session.patch({ audio: { streams: { [id]: { connected: true } } } })
  }

  /** Disconnect a stream on demand and persist that it is no longer wanted. */
  disconnect(id: string): void {
    const player = this.players.get(id)
    if (!player) return
    this.cancelRestore(id)
    player.disconnect()
    // Clear the activity light at once: a disconnected stream isn't talking, and
    // resetting the VAD stops a mid-hang light from flickering back on next tick.
    this.vads.get(id)?.reset()
    if (this.lastActive.get(id)) {
      this.lastActive.set(id, false)
      useAppStore.getState().patchAudioStream(id, { active: false })
    }
    window.api.session.patch({ audio: { streams: { [id]: { connected: false } } } })
    // A disconnected stream is silent and no longer a ducker — refresh the mix.
    this.recomputeDucking()
  }

  /**
   * Restore the saved-connected set, staggered ~750 ms apart so a batch of feeds
   * never hits LiveATC simultaneously. Each connect is guarded: if the operator
   * has already acted on that stream during the stagger window, its restore is a
   * no-op.
   */
  private scheduleRestore(ids: string[]): void {
    ids.forEach((id, index) => {
      const timer = setTimeout(() => {
        this.restoreTimers.delete(id)
        const player = this.players.get(id)
        // Don't override a live operator choice made during the stagger window.
        if (player && !player.connectionWanted) this.connect(id)
      }, index * this.restoreStaggerMs)
      this.restoreTimers.set(id, timer)
    })
  }

  /** Cancel a pending staggered-restore connect for one stream (no-op if none). */
  private cancelRestore(id: string): void {
    const timer = this.restoreTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.restoreTimers.delete(id)
    }
  }

  // --- user controls ------------------------------------------------------

  setVolume(id: string, volume: number): void {
    const v = clamp01(volume)
    this.players.get(id)?.setVolume(v)
    useAppStore.getState().patchAudioStream(id, { volume: v })
    // Persisted (debounced by the session store) so the mix survives a relaunch.
    window.api.session.patch({ audio: { streams: { [id]: { volume: v } } } })
  }

  setMuted(id: string, muted: boolean): void {
    this.players.get(id)?.setMuted(muted)
    this.mutedState.set(id, muted)
    useAppStore.getState().patchAudioStream(id, { muted })
    window.api.session.patch({ audio: { streams: { [id]: { muted } } } })
    // A stream that just muted stops ducking others; one that just unmuted may
    // start. Recompute so the mix reflects the new set of active DUCKERS.
    this.recomputeDucking()
  }

  setPan(id: string, pan: number): void {
    const p = clampPan(pan)
    this.players.get(id)?.setPan(p)
    useAppStore.getState().patchAudioStream(id, { pan: p })
    window.api.session.patch({ audio: { streams: { [id]: { pan: p } } } })
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
      // Reload resets the live mix to config, so re-persist it — session always
      // mirrors the live state, and a relaunch reproduces what is on screen now.
      window.api.session.patch({
        audio: {
          streams: {
            [stream.id]: { volume: stream.defaultVolume, muted: stream.muted, pan: stream.pan }
          }
        }
      })
    }

    // Hand edits can also add or remove streams — apply that live too (the same
    // path the channel manager uses), then re-derive the mix.
    this.applyStreams(result)
  }

  // --- Channel manager (add / remove / reorder) -----------------------------

  /**
   * Reconcile the live engine against a new config's stream set: build players
   * for added streams (they start disconnected — on-demand contract), destroy
   * removed ones, adopt new labels/priorities, and rewrite the store's list in
   * the new order. Kept streams keep their LIVE volume/mute/pan — a reorder or
   * an add never resets the operator's working mix.
   */
  applyStreams(result: ConfigResult): void {
    const { config } = result
    const isE2E = window.api.audio.isE2E

    const nextIds = new Set(config.streams.map((s) => s.id))
    for (const id of [...this.players.keys()]) {
      if (!nextIds.has(id)) this.destroyStream(id)
    }

    const uiList: AudioStreamUi[] = []
    for (const stream of config.streams) {
      const existing = useAppStore.getState().audioStreams[stream.id]
      if (this.players.has(stream.id) && existing) {
        this.priorities.set(stream.id, stream.priority)
        uiList.push({ ...existing, label: stream.label, priority: stream.priority })
      } else {
        uiList.push(this.createStream(stream, config.vad, isE2E))
      }
    }

    useAppStore.getState().initAudioStreams(uiList)
    this.recomputeDucking()
  }

  /**
   * Persist a new streams array through config:updateStreams and, on success,
   * apply it live. Returns the typed outcome so the UI can surface a failure
   * (nothing changed main-side on failure).
   */
  private async commitStreams(streams: StreamConfig[]): Promise<{ ok: boolean; error?: string }> {
    let outcome: Awaited<ReturnType<typeof window.api.config.updateStreams>>
    try {
      outcome = await window.api.config.updateStreams(streams)
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (!outcome.ok) return { ok: false, error: outcome.error }
    this.applyStreams(outcome.result)
    return { ok: true }
  }

  /** The active config's streams, sorted by priority (the canonical order). */
  private async configStreams(): Promise<StreamConfig[]> {
    const result = await window.api.config.get()
    return [...result.config.streams].sort((a, b) => a.priority - b.priority)
  }

  /**
   * Add a LiveATC feed as a new channel at the LOWEST priority (bottom of the
   * list) with neutral defaults: centre pan, 0.8 volume, unmuted, disconnected.
   * The id derives from the feed's mount (unique on LiveATC and stable), with a
   * numeric suffix in the unlikely case a hand-authored id already took it.
   */
  async addChannel(feed: LiveAtcFeed): Promise<{ ok: boolean; error?: string }> {
    const streams = await this.configStreams()

    if (streams.some((s) => s.plsUrl === feed.plsUrl)) {
      return { ok: false, error: `"${feed.name}" is already a channel` }
    }

    const taken = new Set(streams.map((s) => s.id))
    let id = feed.mount
    for (let n = 2; taken.has(id); n += 1) id = `${feed.mount}-${n}`

    const maxPriority = streams.reduce((max, s) => Math.max(max, s.priority), 0)
    const added: StreamConfig = {
      id,
      label: feed.name,
      plsUrl: feed.plsUrl,
      priority: maxPriority + 1,
      pan: 0,
      defaultVolume: 0.8,
      muted: false
    }
    return this.commitStreams([...streams, added])
  }

  /** Remove a channel and renumber the remaining priorities contiguously (1..N). */
  async removeChannel(id: string): Promise<{ ok: boolean; error?: string }> {
    const streams = await this.configStreams()
    const remaining = streams.filter((s) => s.id !== id)
    if (remaining.length === streams.length) {
      return { ok: false, error: `no channel with id "${id}"` }
    }
    if (remaining.length === 0) {
      // The config schema requires at least one stream; a bare panel would also
      // leave nothing to click at the show. Refuse the last delete.
      return { ok: false, error: 'cannot remove the last channel' }
    }
    return this.commitStreams(remaining.map((s, i) => ({ ...s, priority: i + 1 })))
  }

  /**
   * Reorder channels to match `orderedIds` (top of the list = priority 1). Ids
   * not present in the config are ignored; config streams missing from the list
   * keep their relative order at the end. No-ops (same order) still write —
   * callers only invoke this after an actual move.
   */
  async reorderChannels(orderedIds: string[]): Promise<{ ok: boolean; error?: string }> {
    const streams = await this.configStreams()
    const byId = new Map(streams.map((s) => [s.id, s]))
    const picked = orderedIds.map((id) => byId.get(id)).filter((s): s is StreamConfig => !!s)
    const leftover = streams.filter((s) => !orderedIds.includes(s.id))
    const next = [...picked, ...leftover].map((s, i) => ({ ...s, priority: i + 1 }))
    return this.commitStreams(next)
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

function clampPan(v: number): number {
  return Math.max(-1, Math.min(1, v))
}
