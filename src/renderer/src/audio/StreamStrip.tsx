import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import type { AudioStreamStatus } from '../state/store'
import { audioEngine } from './engine'

// One ATC stream's control strip: label, activity light, status chip, and the
// volume / mute / pan controls. Two indicators are deliberately DISTINCT (see
// docs/design/Audio.md):
//   * the activity light answers "is anyone talking?" — driven by the VAD, it
//     keeps working while the stream is muted, and
//   * the status chip answers "is this stream healthy?" — connecting / live /
//     reconnecting·n / error, independent of whether anyone is talking (a live
//     but silent squelched frequency is normal, never an error).

/** Human text for the status chip. */
function chipLabel(status: AudioStreamStatus, attempt: number): string {
  switch (status) {
    case 'live':
      return 'Live'
    case 'reconnecting':
      return `Reconnecting · ${attempt}`
    case 'error':
      return 'Error'
    default:
      return 'Connecting…'
  }
}

function StreamStrip({ id }: { id: string }): React.JSX.Element | null {
  const stream = useAppStore((s) => s.audioStreams[id])

  // Live countdown to the next retry — ticks only while actually reconnecting,
  // so idle strips never re-render on a timer.
  const [now, setNow] = useState(() => Date.now())
  const isRetrying = stream?.status === 'reconnecting' || stream?.status === 'error'
  const nextRetryAt = stream?.nextRetryAt ?? null
  useEffect(() => {
    if (!isRetrying || nextRetryAt == null) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [isRetrying, nextRetryAt])

  if (!stream) return null

  const { label, status, attempt, active, volume, muted, pan, lastError } = stream

  const countdown = nextRetryAt != null ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : null

  // The status-chip tooltip is the 6-a.m.-at-the-airshow message: what failed,
  // and what happens next.
  let chipTooltip: string
  if (status === 'live') {
    chipTooltip = 'Stream healthy'
  } else if (status === 'connecting') {
    chipTooltip = 'Connecting to the stream…'
  } else {
    const base = lastError ?? 'connection lost'
    chipTooltip =
      countdown != null
        ? `${base} — next try in ${countdown}s (attempt ${attempt})`
        : `${base} (attempt ${attempt})`
  }

  return (
    <div className="stream-strip" data-testid={`stream-strip-${id}`} data-status={status}>
      <div className="stream-strip-top">
        <span
          className="activity-light"
          data-testid={`activity-light-${id}`}
          data-active={active}
          role="img"
          aria-label={active ? `${label} active` : `${label} idle`}
          title={active ? 'Transmitting' : 'Idle'}
        />
        <span className="stream-label" title={label}>
          {label}
        </span>
        <span
          className="status-chip"
          data-testid={`status-chip-${id}`}
          data-status={status}
          title={chipTooltip}
        >
          {chipLabel(status, attempt)}
        </span>
      </div>

      <div className="stream-strip-controls">
        <button
          type="button"
          className="mute-btn"
          data-testid={`mute-${id}`}
          aria-pressed={muted}
          aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
          title={muted ? 'Unmute (light keeps working)' : 'Mute'}
          onClick={() => audioEngine.setMuted(id, !muted)}
        >
          {muted ? 'Muted' : 'Mute'}
        </button>

        <label className="slider volume-slider">
          <span className="slider-icon" aria-hidden="true">
            Vol
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            data-testid={`volume-${id}`}
            aria-label={`${label} volume`}
            onChange={(e) => audioEngine.setVolume(id, e.currentTarget.valueAsNumber)}
          />
        </label>

        <label className="slider pan-slider">
          <span className="slider-icon" aria-hidden="true">
            Pan
          </span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={pan}
            data-testid={`pan-${id}`}
            aria-label={`${label} pan`}
            onChange={(e) => audioEngine.setPan(id, e.currentTarget.valueAsNumber)}
          />
        </label>
      </div>
    </div>
  )
}

export default StreamStrip
