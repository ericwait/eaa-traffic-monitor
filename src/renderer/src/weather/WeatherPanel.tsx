import { useCallback, useEffect, useState } from 'react'
import {
  findNextImprovingPeriod,
  formatCeiling,
  formatVisibility,
  formatWind
} from '@shared/weather'
import type { WeatherTafPeriod } from '@shared/weather'
import { useAppStore } from '../state/store'

// The "Field Weather" card — a compact METAR/TAF summary for the tracked
// station, mounted below the ATC stream list inside the ATC panel's slot (see
// AudioPanel.tsx). It reads the shared, pure flight-category/TAF logic
// (src/shared/weather.ts) so the exact same derivation that vitest exercises
// against real API fixtures is what renders here — no re-decoding in the UI.
//
// Data flow mirrors fr24:navState: an initial `weather:get` on mount for the
// first paint, then a subscription to background-poll pushes
// (`weather:update`) for the life of the panel. The refresh button calls
// `weather:refresh` directly, bypassing the main process's cache-freshness
// check the same way the audio engine's reconnect bypasses the resolver cache.

/** A snapshot is "stale" once it's older than this many poll intervals. */
const STALE_POLL_MULTIPLIER = 2

/** Re-render once a minute so the observation-age readout stays live without a real poll happening. */
const AGE_TICK_MS = 60_000

function formatAge(fromMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes === 1) return '1 min ago'
  return `${minutes} min ago`
}

/** e.g. "1521Z–1600Z", in UTC (the aviation convention for METAR/TAF times). */
function periodWindowLabel(period: WeatherTafPeriod): string {
  const zulu = (ms: number): string => {
    const d = new Date(ms)
    return `${d.getUTCHours().toString().padStart(2, '0')}${d.getUTCMinutes().toString().padStart(2, '0')}Z`
  }
  return `${zulu(period.startsAt)}–${zulu(period.endsAt)}`
}

function conditionsLine(input: {
  windDirDeg: number | null
  windVariable: boolean
  windSpeedKt: number | null
  windGustKt: number | null
  visibilitySm: number | null
  ceilingFtAgl: number | null
  wxString: string | null
}): string {
  const parts = [
    formatWind(input.windDirDeg, input.windVariable, input.windSpeedKt, input.windGustKt),
    formatVisibility(input.visibilitySm),
    formatCeiling(input.ceilingFtAgl)
  ]
  if (input.wxString) parts.push(input.wxString)
  return parts.join(' · ')
}

function WeatherPanel(): React.JSX.Element {
  const snapshot = useAppStore((s) => s.weatherSnapshot)
  const error = useAppStore((s) => s.weatherError)
  const loading = useAppStore((s) => s.weatherLoading)
  const setWeatherResult = useAppStore((s) => s.setWeatherResult)
  const setWeatherLoading = useAppStore((s) => s.setWeatherLoading)

  const [now, setNow] = useState(() => Date.now())

  // Initial load, then subscribe to background-poll pushes for the panel's life.
  useEffect(() => {
    let cancelled = false
    setWeatherLoading(true)
    window.api.weather
      .get()
      .then((result) => {
        if (!cancelled) setWeatherResult(result)
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false)
      })

    const unsubscribe = window.api.weather.onUpdate((result) => setWeatherResult(result))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [setWeatherResult, setWeatherLoading])

  // Keeps the "N min ago" / stale readouts live between polls.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => clearInterval(t)
  }, [])

  const onRefresh = useCallback(() => {
    setWeatherLoading(true)
    window.api.weather
      .refresh()
      .then((result) => setWeatherResult(result))
      .finally(() => setWeatherLoading(false))
  }, [setWeatherResult, setWeatherLoading])

  const metar = snapshot?.metar ?? null
  const taf = snapshot?.taf ?? null

  const isStale =
    snapshot != null &&
    now - snapshot.fetchedAt >= snapshot.pollMinutes * STALE_POLL_MULTIPLIER * 60_000

  const nextImproving =
    metar && taf ? findNextImprovingPeriod(metar.category, taf.periods, now) : null

  return (
    <section className="weather-panel" aria-label="Field Weather" data-testid="weather-panel">
      <header className="panel-head weather-head">
        <h2 className="panel-title">Field Weather</h2>
        <div className="audio-head-spacer" />
        {isStale && (
          <span
            className="weather-stale-flag"
            data-testid="weather-stale"
            title="This data is older than expected — the last refresh may have failed. See the error message below, if any."
          >
            Stale
          </span>
        )}
        <button
          type="button"
          className="audio-reload-btn"
          data-testid="weather-refresh"
          aria-label="Refresh field weather"
          title="Fetch the current METAR/TAF now"
          onClick={onRefresh}
          disabled={loading}
        >
          &#8635;
        </button>
      </header>

      {error && (
        <p className="weather-error" role="alert" data-testid="weather-error">
          {error}
        </p>
      )}

      {!snapshot && !error && (
        <p className="weather-loading" data-testid="weather-loading">
          Loading field weather…
        </p>
      )}

      {snapshot && !metar && !error && (
        <p className="weather-loading" data-testid="weather-no-metar">
          No METAR available for {snapshot.station}.
        </p>
      )}

      {metar && (
        <div className="weather-body">
          <div className="weather-station-row">
            <span className="weather-station" title={`Station ${metar.station}`}>
              {metar.station}
            </span>
            <span className="weather-age" data-testid="weather-age">
              {formatAge(metar.observedAt, now)}
            </span>
          </div>

          <span
            className="weather-category-badge"
            data-testid="weather-category"
            data-category={metar.category}
            title={`Current flight category: ${metar.category}`}
          >
            {metar.category}
          </span>

          <p className="weather-summary-line" data-testid="weather-summary">
            {conditionsLine(metar)}
          </p>

          <p className="weather-raw" title={metar.rawText} data-testid="weather-raw-metar">
            {metar.rawText}
          </p>

          {nextImproving && (
            <p className="weather-next-improving" data-testid="weather-next-improving">
              {nextImproving.category} expected ~{periodWindowLabel(nextImproving).split('–')[0]}
            </p>
          )}

          {taf && taf.periods.length > 0 && (
            <details className="weather-taf">
              <summary className="weather-taf-summary">TAF — {taf.periods.length} periods</summary>
              <ul className="weather-taf-list">
                {taf.periods.map((period, index) => (
                  <li
                    key={`${period.startsAt}-${index}`}
                    className="weather-taf-period"
                    data-testid={`weather-taf-period-${index}`}
                  >
                    <span className="weather-taf-window">{periodWindowLabel(period)}</span>
                    <span
                      className="weather-category-badge weather-category-badge--sm"
                      data-category={period.category}
                    >
                      {period.category}
                    </span>
                    <span className="weather-taf-line">{conditionsLine(period)}</span>
                  </li>
                ))}
              </ul>
              <p className="weather-raw weather-raw-taf" title={taf.rawText}>
                {taf.rawText}
              </p>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

export default WeatherPanel
