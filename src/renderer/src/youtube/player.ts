/// <reference types="youtube" />

// A thin typed wrapper around YT.Player: one instance per grid tile. Owns the
// player's lifecycle (create/destroy) and translates YouTube's player states
// and error codes into the small typed status a tile renders directly, so
// every tile isn't re-deriving 'loading | playing | offline | error' from raw
// YT.PlayerState / YT.PlayerError itself.
//
// Deliberately thin beyond that: setVolume/mute/unMute pass straight through
// to the wrapped YT.Player. This is the ceiling of what this app can do to
// YouTube's audio — see docs/design/Video.md's "honest audio boundary" — no
// Web Audio analysis, ducking, pan, or device routing is possible through the
// IFrame API, unlike the ATC engine's Web-Audio-owned streams.

import { loadYouTubeIframeApi, type YouTubeNamespace } from './iframeApi'

export type FeedPlayerStatus = 'loading' | 'playing' | 'offline' | 'error'

export interface FeedPlayerStatusEvent {
  status: FeedPlayerStatus
  /**
   * Human-readable and always actionable when present: names the feed, names
   * the videoId, and says what to do about it (the error-message mandate —
   * never a silent black tile). Only set for offline/error transitions;
   * loading/playing carry no message.
   */
  message?: string
}

export interface FeedPlayerOptions {
  /** The feed's human label — used in every status message, never a bare videoId. */
  feedLabel: string
  videoId: string
  onStatusChange: (event: FeedPlayerStatusEvent) => void
}

/**
 * Turn a YT.PlayerError code into the feed-named, action-oriented message the
 * error-message mandate requires. Video-not-found / embedding-not-allowed are
 * by far the most likely real-world case here: EAA rotates live videoIds
 * daily, so a stale id in defaultFeeds.ts surfaces as exactly one of these.
 */
function describePlayerError(feedLabel: string, videoId: string, code: number): string {
  const prefix = `Feed '${feedLabel}' failed to load (videoId ${videoId})`
  switch (code) {
    case 100: // YT.PlayerError.VideoNotFound
    case 101: // YT.PlayerError.EmbeddingNotAllowed
    case 150: // YT.PlayerError.EmbeddingNotAllowed2
      return `${prefix}: likely rotated — update src/renderer/src/youtube/defaultFeeds.ts.`
    case 2: // YT.PlayerError.InvalidParam
      return `${prefix}: invalid parameter — check the videoId in defaultFeeds.ts.`
    case 5: // YT.PlayerError.Html5Error
      return `${prefix}: the browser could not play this stream (HTML5 player error) — try reloading the app.`
    default:
      return `${prefix}: unknown player error ${code} — try reloading the app.`
  }
}

export class FeedPlayer {
  private player: YT.Player | null = null
  private destroyed = false
  private readonly feedLabel: string
  private readonly videoId: string
  private readonly onStatusChange: (event: FeedPlayerStatusEvent) => void

  constructor(element: HTMLElement, options: FeedPlayerOptions) {
    this.feedLabel = options.feedLabel
    this.videoId = options.videoId
    this.onStatusChange = options.onStatusChange
    this.onStatusChange({ status: 'loading' })
    void this.init(element)
  }

  private async init(element: HTMLElement): Promise<void> {
    let YTNamespace: YouTubeNamespace
    try {
      YTNamespace = await loadYouTubeIframeApi()
    } catch (err) {
      if (this.destroyed) return
      const reason = err instanceof Error ? err.message : String(err)
      this.onStatusChange({
        status: 'offline',
        message: `Feed '${this.feedLabel}' failed to load (videoId ${this.videoId}): ${reason}`
      })
      return
    }
    if (this.destroyed) return

    // The packaged app runs on app://bundle, not http(s) — only pass `origin`
    // on a real web origin. A bogus origin value on a non-web protocol can
    // break the postMessage handshake the IFrame API relies on (verified
    // against the current IFrame API reference via context7).
    const isWebOrigin =
      window.location.protocol === 'http:' || window.location.protocol === 'https:'

    this.player = new YTNamespace.Player(element, {
      videoId: this.videoId,
      playerVars: {
        autoplay: 1,
        mute: 1,
        playsinline: 1,
        controls: 1,
        ...(isWebOrigin ? { origin: window.location.origin } : {})
      },
      events: {
        onReady: () => {
          if (this.destroyed) return
          this.onStatusChange({ status: 'playing' })
        },
        onStateChange: (event) => {
          if (this.destroyed) return
          this.handleStateChange(event.data)
        },
        onError: (event) => {
          if (this.destroyed) return
          this.onStatusChange({
            status: 'error',
            message: describePlayerError(this.feedLabel, this.videoId, event.data)
          })
        }
      }
    })
  }

  private handleStateChange(state: YT.PlayerState): void {
    switch (state) {
      case 1: // YT.PlayerState.PLAYING
      case 2: // YT.PlayerState.PAUSED (still a live embed, just paused by the user)
        this.onStatusChange({ status: 'playing' })
        break
      case 3: // YT.PlayerState.BUFFERING
      case -1: // YT.PlayerState.UNSTARTED
      case 5: // YT.PlayerState.CUED
        this.onStatusChange({ status: 'loading' })
        break
      case 0: // YT.PlayerState.ENDED
        this.onStatusChange({
          status: 'offline',
          message:
            `Feed '${this.feedLabel}' ended (videoId ${this.videoId}): the broadcaster's ` +
            'live stream likely ended — update src/renderer/src/youtube/defaultFeeds.ts if this cam has rotated.'
        })
        break
      default:
        break
    }
  }

  /** @param volume An integer 0-100. */
  setVolume(volume: number): void {
    this.player?.setVolume(volume)
  }

  mute(): void {
    this.player?.mute()
  }

  unMute(): void {
    this.player?.unMute()
  }

  destroy(): void {
    this.destroyed = true
    try {
      this.player?.destroy()
    } catch {
      // destroy() on an iframe whose contentWindow already tore down (e.g. the
      // tile unmounted mid-navigation) can throw; the tile is going away
      // regardless, so this is not worth surfacing.
    }
    this.player = null
  }
}
