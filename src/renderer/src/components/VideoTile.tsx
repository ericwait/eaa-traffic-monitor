import { useCallback, useEffect, useRef, useState } from 'react'
import type { DefaultFeed } from '../youtube/defaultFeeds'
import { FeedPlayer, type FeedPlayerStatus } from '../youtube/player'

// A single grid tile: the embedded YouTube player, an always-visible identity
// overlay (label + LIVE/OFFLINE badge), and an on-hover audio control cluster.
//
// Cross-origin note: a real YouTube <iframe>'s rendered content captures
// mouse events in its OWN document — a click landing on the live picture
// itself never reaches this component's DOM at all, by browser design (not a
// bug here, and not fixable from the embedding page). The single onDoubleClick
// lives on the outer .video-tile; it fires reliably whenever the hit point
// isn't over the live iframe picture itself — which includes the identity
// overlay bar (real DOM stacked ABOVE the iframe, so a double-click there
// bubbles up normally) and every tile in this repo's offline-by-default
// e2e/CI runs. (The overlay deliberately has no onDoubleClick of its own —
// one handler on the ancestor is enough; a second one on a descendant in the
// same bubble path would double-fire — toggle, then toggle back — for a
// single physical double-click landing inside the overlay's area.) Because a
// live iframe can still swallow a double-click over the picture itself,
// explicit emphasize/fill buttons are also provided in the hover cluster as a
// guaranteed-reliable path — never rely on the gesture alone for a
// "capability the operator might not otherwise have."

export interface VideoTileProps {
  feed: DefaultFeed
  /** grid-area name to apply in emphasized mode; undefined in uniform/fill mode. */
  area?: string
  emphasized: boolean
  /** True only when this tile is filling the entire video panel. */
  filled: boolean
  onToggleEmphasize: () => void
  onFillPanel: () => void
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
  area,
  emphasized,
  filled,
  onToggleEmphasize,
  onFillPanel
}: VideoTileProps): React.JSX.Element {
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<FeedPlayer | null>(null)
  const [status, setStatus] = useState<FeedPlayerStatus>('loading')
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [volume, setVolume] = useState(100)
  // Players start muted (playerVars.mute: 1) so autoplay is guaranteed.
  const [muted, setMuted] = useState(true)
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

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const next = Number(e.target.value)
      setVolume(next)
      playerRef.current?.setVolume(next)
      if (next > 0 && muted) {
        setMuted(false)
        playerRef.current?.unMute()
      }
    },
    [muted]
  )

  const handleMuteToggle = useCallback((): void => {
    setMuted((prevMuted) => {
      const nextMuted = !prevMuted
      if (nextMuted) playerRef.current?.mute()
      else playerRef.current?.unMute()
      return nextMuted
    })
  }, [])

  const handleDoubleClick = useCallback((): void => {
    if (emphasized) onFillPanel()
    else onToggleEmphasize()
  }, [emphasized, onFillPanel, onToggleEmphasize])

  const showPlaceholder = status !== 'playing'

  return (
    <div
      className={[
        'video-tile',
        emphasized ? 'video-tile--emphasized' : '',
        filled ? 'video-tile--filled' : '',
        isHovering ? 'video-tile--hovering' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={area ? { gridArea: area } : undefined}
      data-testid="video-tile"
      data-feed-id={feed.id}
      data-status={status}
      onDoubleClick={handleDoubleClick}
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
          (see the cross-origin note up top). No onDoubleClick of its own —
          a double-click here bubbles to the outer .video-tile handler below
          just like any other DOM descendant, so a second listener here would
          only risk double-firing (toggle, then toggle back) for one click. */}
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
        <button
          type="button"
          className="video-tile-emphasize-btn"
          aria-label={emphasized ? `Demote ${feed.label}` : `Emphasize ${feed.label}`}
          title={emphasized ? 'Demote to uniform grid' : 'Emphasize this feed'}
          onClick={onToggleEmphasize}
        >
          {emphasized ? '⊖' : '⊕'}
        </button>
        <button
          type="button"
          className="video-tile-fill-btn"
          aria-label={`Fill panel with ${feed.label}`}
          title="Fill the entire video panel with this feed"
          onClick={onFillPanel}
        >
          {'⤢'}
        </button>
      </div>
    </div>
  )
}

export default VideoTile
