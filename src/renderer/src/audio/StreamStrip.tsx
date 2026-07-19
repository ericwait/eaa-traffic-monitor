import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import type { AudioStreamStatus } from '../state/store'
import { audioEngine } from './engine'
import { DEFAULT_DEVICE_ID, DEFAULT_DEVICE_LABEL } from './devices'

// One ATC stream's control strip: label, priority rank, activity light, status
// chip, and the volume / mute / pan / solo / output-device controls. Two
// indicators are deliberately DISTINCT (see docs/design/Audio.md):
//   * the activity light answers "is anyone talking?" — driven by the VAD, it
//     keeps working while the stream is muted, and
//   * the status chip answers "is this stream healthy?" — connecting / live /
//     reconnecting·n / error, independent of whether anyone is talking (a live
//     but silent squelched frequency is normal, never an error).
//
// Phase 2b adds solo (a momentary manual override), the priority-rank badge, the
// per-stream output-device picker, and a dev-only duck-target readout so ducking
// can be SEEN without being heard.
//
// On-demand connection (decision 2026-07-19): the status pill is ALSO the connect
// toggle. Streams start disconnected; clicking the pill connects a disconnected
// stream and disconnects any active one. It is a real <button> so it is keyboard-
// operable, with a cursor/hover affordance and a "Click to connect" tooltip.

/** Human text for the status pill. */
function chipLabel(status: AudioStreamStatus, attempt: number): string {
  switch (status) {
    case 'live':
      return 'Live'
    case 'reconnecting':
      return `Reconnecting · ${attempt}`
    case 'feed-down':
      return 'Feed down · retrying'
    case 'error':
      return 'Error'
    case 'disconnected':
      return 'Disconnected'
    default:
      return 'Connecting…'
  }
}

function StreamStrip({ id }: { id: string }): React.JSX.Element | null {
  const stream = useAppStore((s) => s.audioStreams[id])
  const soloedId = useAppStore((s) => s.audioSolo)
  const outputs = useAppStore((s) => s.audioOutputs)

  // Live countdown to the next retry — ticks only while actively reconnecting on
  // the fast schedule, so idle/disconnected strips never re-render on a timer.
  // 'feed-down' deliberately shows no live countdown: it is the calm state.
  const [now, setNow] = useState(() => Date.now())
  const isRetrying = stream?.status === 'reconnecting' || stream?.status === 'error'
  const nextRetryAt = stream?.nextRetryAt ?? null
  useEffect(() => {
    if (!isRetrying || nextRetryAt == null) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [isRetrying, nextRetryAt])

  if (!stream) return null

  const {
    label,
    status,
    attempt,
    active,
    volume,
    muted,
    pan,
    priority,
    lastError,
    duckTarget,
    deviceId,
    deviceNotice
  } = stream

  const isSoloed = soloedId === id
  const soloedElsewhere = soloedId !== null && !isSoloed

  const countdown = nextRetryAt != null ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : null

  // The status-pill tooltip is the 6-a.m.-at-the-airshow message: what state the
  // stream is in and what a click will do (the pill is the connect toggle).
  let chipTooltip: string
  if (status === 'disconnected') {
    chipTooltip = 'Click to connect'
  } else if (status === 'live') {
    chipTooltip = 'Stream healthy — click to disconnect'
  } else if (status === 'connecting') {
    chipTooltip = 'Connecting to the stream… — click to disconnect'
  } else if (status === 'feed-down') {
    const base = lastError ?? 'this feed is not broadcasting'
    chipTooltip = `${base} — still retrying about once a minute; click to disconnect`
  } else {
    const base = lastError ?? 'connection lost'
    const detail =
      countdown != null
        ? `${base} — next try in ${countdown}s (attempt ${attempt})`
        : `${base} (attempt ${attempt})`
    chipTooltip = `${detail}; click to disconnect`
  }

  // The pill's accessible name is the ACTION it performs, so a screen-reader user
  // hears "Connect Tower" / "Disconnect Tower", not just the status word.
  const pillAction = status === 'disconnected' ? `Connect ${label}` : `Disconnect ${label}`

  // The picker's <select> value must always match one of its options. When the
  // routed device is the default (or a saved device that isn't present right
  // now), that value is the default sentinel.
  const selectedDeviceId = outputs.some((d) => d.deviceId === deviceId)
    ? deviceId
    : DEFAULT_DEVICE_ID

  return (
    <div
      className="stream-strip"
      data-testid={`stream-strip-${id}`}
      data-status={status}
      data-soloed={isSoloed}
      data-soloed-elsewhere={soloedElsewhere}
      // Always present (cheap) so ducking is verifiable from the DOM even in a
      // production preview; the visible readout below is dev-only.
      data-duck-target={duckTarget}
    >
      <div className="stream-strip-top">
        <span
          className="activity-light"
          data-testid={`activity-light-${id}`}
          data-active={active}
          role="img"
          aria-label={active ? `${label} active` : `${label} idle`}
          title={active ? 'Transmitting' : 'Idle'}
        />
        <span
          className="priority-badge"
          data-testid={`priority-${id}`}
          title={`Priority rank ${priority} (1 = highest; ducks every lower rank)`}
        >
          P{priority}
        </span>
        <span className="stream-label" title={label}>
          {label}
        </span>
        <button
          type="button"
          className="status-chip"
          data-testid={`status-chip-${id}`}
          data-status={status}
          aria-label={pillAction}
          title={chipTooltip}
          onClick={() => audioEngine.toggleConnected(id)}
        >
          {chipLabel(status, attempt)}
        </button>
      </div>

      <div className="stream-strip-controls">
        <button
          type="button"
          className="solo-btn"
          data-testid={`solo-${id}`}
          aria-pressed={isSoloed}
          aria-label={isSoloed ? `Release solo on ${label}` : `Solo ${label}`}
          title={
            isSoloed
              ? 'Release solo (or press Escape) — restores the prior mix'
              : 'Solo — hear only this channel (overrides ducking and mute)'
          }
          onClick={() => audioEngine.toggleSolo(id)}
        >
          Solo
        </button>

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

      <div className="stream-strip-device">
        <span className="slider-icon" aria-hidden="true">
          Out
        </span>
        <select
          className="device-select"
          data-testid={`device-${id}`}
          aria-label={`${label} output device`}
          title="Output device for this channel. Bluetooth outputs lag wired ones by 150–300 ms."
          value={selectedDeviceId}
          onChange={(e) => {
            const nextId = e.currentTarget.value
            const nextLabel =
              nextId === DEFAULT_DEVICE_ID
                ? DEFAULT_DEVICE_LABEL
                : (outputs.find((d) => d.deviceId === nextId)?.label ?? nextId)
            void audioEngine.setStreamOutputDevice(id, nextId, nextLabel)
          }}
        >
          <option value={DEFAULT_DEVICE_ID}>{DEFAULT_DEVICE_LABEL}</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        {import.meta.env.DEV && (
          <span
            className="duck-readout"
            data-testid={`duck-readout-${id}`}
            title="Current duck-gain target (dev telemetry): 1 = full, ducked = config duckLevel, 0 = silenced by a solo elsewhere."
          >
            ×{duckTarget.toFixed(2)}
          </span>
        )}
      </div>

      {deviceNotice && (
        <p className="device-notice" role="status" data-testid={`device-notice-${id}`}>
          {deviceNotice}
        </p>
      )}
    </div>
  )
}

export default StreamStrip
