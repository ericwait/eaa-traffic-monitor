import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoFitMode } from '@shared/panelLayout'
import type { DefaultFeed } from '../youtube/defaultFeeds'
import { FeedPlayer, type FeedPlayerStatus } from '../youtube/player'

// A single tile: the embedded YouTube player, an always-visible identity
// overlay (label + LIVE/OFFLINE badge), and an on-hover audio control cluster.
// Mounted by both windows' panel canvases — the main window's LeafFrame (via
// components/VideoLeafBody.tsx) and a pop-out's own canvas (decision
// 2026-07-20; same VideoLeafBody, reused — see docs/design/Layout.md's
// pop-out section) — so this component itself no longer knows which window
// it's in: maximize (a header double-click one level up, in VideoLeafBody)
// and per-feed fit/fill supersede the old uniform/emphasized/fill-panel grid
// modes everywhere, not just in the main window.
//
// Cross-origin note: a real YouTube <iframe>'s rendered content captures
// mouse events in its OWN document — a click landing on the live picture
// itself never reaches this component's DOM at all, by browser design (not a
// bug here, and not fixable from the embedding page). The mute/volume
// controls below live in the identity overlay's hover cluster, real DOM
// stacked ABOVE the iframe, so they stay reachable regardless.

export interface VideoTileProps {
  feed: DefaultFeed
  /** Restored starting volume (0..100); defaults to 100 when unspecified. */
  initialVolume?: number
  /** Restored starting mute; players default to muted so autoplay is guaranteed. */
  initialMuted?: boolean
  /** Called whenever this tile's volume/mute changes, for per-feed persistence. */
  onAudioChange?: (state: { volume: number; muted: boolean }) => void
  /** When provided, a "pop out" button appears that carries this feed to its own window. */
  onPopOut?: () => void
  /** The panel canvas's per-feed fit/fill mode — purely a `data-fit-mode` marker here; the actual geometry is applied by the canvas's `.video-tile-stage` wrapper (components/VideoLeafBody.tsx), not by this component. Defaults to 'fit'. */
  fitMode?: VideoFitMode
}

const AUDIO_BOUNDARY_TOOLTIP =
  "YouTube audio plays on the system default output and can't join ducking or routing — see docs/design/Audio.md."

function statusLabel(status: FeedPlayerStatus, feedLabel: string): string {
  switch (status) {
    case 'loading':
      return 'Connecting…'
    case 'playing':
      return 'Live'
    case 'offline':
      return `Feed '${feedLabel}' is offline.`
    case 'error':
      return `Feed '${feedLabel}' hit an error.`
    default:
      return ''
  }
}

function VideoTile({
  feed,
  initialVolume,
  initialMuted,
  onAudioChange,
  onPopOut,
  fitMode
}: VideoTileProps): React.JSX.Element {
  // STABLE outer element — see the Fix A ResizeObserver effect below for why
  // this ref (not playerHostRef) is what gets observed.
  const tileRef = useRef<HTMLDivElement | null>(null)
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<FeedPlayer | null>(null)
  const [status, setStatus] = useState<FeedPlayerStatus>('loading')
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [volume, setVolume] = useState(initialVolume ?? 100)
  // Players start muted (playerVars.mute: 1) so autoplay is guaranteed, unless a
  // restored pop-out slice says this feed was left unmuted.
  const [muted, setMuted] = useState(initialMuted ?? true)
  // Tracked in state rather than via the CSS `:hover` pseudo-class. Real
  // continuous mouse movement (any human) does keep `.video-tile:hover`
  // matched fine even over the live cross-origin iframe — verified live. The
  // one case that misbehaves is a synthetic, single-jump pointer move landing
  // directly on the iframe's rendered surface with no prior position on the
  // page (exactly what automated-testing tools do for a `.hover()`/`.click()`
  // call): `:hover` can fail to propagate to `.video-tile` then. mouseenter/
  // mouseleave fire correctly either way, so driving visibility from them
  // sidesteps the gap without depending on how the pointer got there.
  const [isHovering, setIsHovering] = useState(false)

  useEffect(() => {
    const host = playerHostRef.current
    if (!host) return

    const player = new FeedPlayer(host, {
      feedLabel: feed.label,
      videoId: feed.videoId,
      onStatusChange: (event) => {
        setStatus(event.status)
        setMessage(event.message)
      }
    })
    playerRef.current = player

    return () => {
      player.destroy()
      playerRef.current = null
    }
  }, [feed.label, feed.videoId])

  // Fix A (docs/Panel-System-Plan.md): YT.Player renders at a fixed default
  // size and never tracks its own container — left unattended it stays a
  // ~640x390 box anchored top-left however big its panel grows (the
  // LARGE-panel bug: a black L of empty space to the right/below, low
  // resolution because YouTube picks stream quality from the player's own
  // pixel size). FeedPlayer.setSize is the fix, but critically this observes
  // `tileRef` (the OUTER, stable `.video-tile` element) rather than
  // `playerHostRef` (the inner `.video-tile-player` div actually handed to
  // `new YT.Player(...)`): the IFrame Player API's own docs say the
  // constructor REPLACES that element with the <iframe> it creates (verified
  // live — the resulting <iframe> inherits the original div's class, so
  // `.video-tile-player` now names the IFRAME itself, not a wrapper around
  // it). React never learns about that external DOM swap, so
  // `playerHostRef.current` keeps pointing at the original, now-detached div
  // forever — a ResizeObserver watching THAT stops firing the instant the
  // swap happens, freezing the iframe at whatever size it first got. `.video-
  // tile` (this component's own outermost element) is never touched by the
  // YT API and is exactly the same size as the player host was designed to
  // be (`.video-tile-player` is `position: absolute; inset: 0` inside it), so
  // observing it keeps working across the replacement and every subsequent
  // resize. CSS pixels throughout — YouTube's quality heuristic accounts for
  // devicePixelRatio internally; never force a quality level here, live
  // streams ignore the deprecated setPlaybackQuality anyway. Covers both
  // windows' `.video-tile-stage` (components/VideoLeafBody.tsx, resized by
  // splitter drags/window resizes), since both mount this same component.
  useEffect(() => {
    const el = tileRef.current
    if (!el) return
    const applySize = (): void => {
      const { clientWidth, clientHeight } = el
      if (clientWidth <= 0 || clientHeight <= 0) return
      playerRef.current?.setSize(clientWidth, clientHeight)
    }
    applySize() // the tile may already be at its final size by the time this mounts
    const ro = new ResizeObserver(applySize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [feed.label, feed.videoId])

  // Belt-and-suspenders: also (re-)apply the tile's current size the instant
  // the player reports 'playing'. FeedPlayer.setSize already queues a
  // pre-ready size request and replays it in onReady (see player.ts), so this
  // is redundant in the common case — but it guards the ordering edge where
  // this component's own ResizeObserver above fires before playerRef.current
  // is assigned (a genuinely zero-size tile on first mount, or a fast
  // reconnect) by re-reading the current size once the player is definitely up.
  useEffect(() => {
    if (status !== 'playing') return
    const el = tileRef.current
    if (!el) return
    const { clientWidth, clientHeight } = el
    if (clientWidth <= 0 || clientHeight <= 0) return
    playerRef.current?.setSize(clientWidth, clientHeight)
  }, [status])

  // Push restored volume/mute to the YouTube player once it first reaches
  // 'playing' (players always start muted for guaranteed autoplay, so a restored
  // unmuted/at-volume feed needs this one-time apply). Offline feeds never reach
  // 'playing', so nothing happens — no crash on the offline-by-default e2e run.
  const initialAppliedRef = useRef(false)
  useEffect(() => {
    if (status !== 'playing' || initialAppliedRef.current) return
    initialAppliedRef.current = true
    const player = playerRef.current
    if (!player) return
    player.setVolume(volume)
    if (muted) player.mute()
    else player.unMute()
  }, [status, volume, muted])

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const next = Number(e.target.value)
      setVolume(next)
      playerRef.current?.setVolume(next)
      let nextMuted = muted
      if (next > 0 && muted) {
        nextMuted = false
        setMuted(false)
        playerRef.current?.unMute()
      }
      onAudioChange?.({ volume: next, muted: nextMuted })
    },
    [muted, onAudioChange]
  )

  const handleMuteToggle = useCallback((): void => {
    setMuted((prevMuted) => {
      const nextMuted = !prevMuted
      if (nextMuted) playerRef.current?.mute()
      else playerRef.current?.unMute()
      onAudioChange?.({ volume, muted: nextMuted })
      return nextMuted
    })
  }, [onAudioChange, volume])

  const showPlaceholder = status !== 'playing'

  return (
    <div
      ref={tileRef}
      className={['video-tile', isHovering ? 'video-tile--hovering' : ''].filter(Boolean).join(' ')}
      data-testid="video-tile"
      data-feed-id={feed.id}
      data-status={status}
      data-fit-mode={fitMode ?? 'fit'}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="video-tile-player" ref={playerHostRef} />

      {showPlaceholder && (
        <div className="video-tile-placeholder" data-testid="video-tile-placeholder">
          <p className="video-tile-placeholder-label">{feed.label}</p>
          <p className="video-tile-placeholder-status">
            {message ?? statusLabel(status, feed.label)}
          </p>
        </div>
      )}

      {/* Identity overlay: always visible, real DOM stacked above the iframe
          (see the cross-origin note up top). */}
      <div className="video-tile-overlay" data-testid="video-tile-overlay">
        <span className="video-tile-label">{feed.label}</span>
        <span
          className={`video-tile-badge video-tile-badge--${status === 'playing' ? 'live' : 'offline'}`}
          data-testid="video-tile-badge"
        >
          {status === 'playing' ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      <div
        className="video-tile-controls"
        data-testid="video-tile-controls"
        title={AUDIO_BOUNDARY_TOOLTIP}
      >
        <button
          type="button"
          className="video-tile-mute-btn"
          aria-label={muted ? `Unmute ${feed.label}` : `Mute ${feed.label}`}
          onClick={handleMuteToggle}
        >
          {muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={handleVolumeChange}
          aria-label={`${feed.label} volume`}
          className="video-tile-volume"
        />
        {onPopOut && (
          <button
            type="button"
            className="video-tile-popout-btn"
            aria-label={`Pop out ${feed.label}`}
            title="Open this feed in its own window (for a second monitor)"
            onClick={onPopOut}
          >
            {'⧉'}
          </button>
        )}
      </div>
    </div>
  )
}

export default VideoTile
