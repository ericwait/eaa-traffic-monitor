import { app, net } from 'electron'
import { summarizeMetar, summarizeTaf } from '@shared/weather'
import type { MetarApiRecord, TafApiRecord } from '@shared/weather'
import type { WeatherResult, WeatherSnapshot } from '@shared/ipc'
import { getActiveConfig } from './config'

// Field-weather (METAR/TAF) fetch + cache — the main-process half of the
// weather panel. NOAA's aviationweather.gov Data API is free, keyless, and has
// no documented rate limit, but "no limit" is not an invitation: this module
// caches the last successful fetch and only re-fetches when the cache is
// older than the configured poll interval (floored at 5 minutes by the config
// schema), so the app is a polite client rather than hammering a free
// government service. See docs/design/Weather.md and
// docs/development/TechStack.md (decision 2026-07-19).
//
// Mirrors plsResolver.ts's shape: cache-unless-stale, a `{fresh: true}`-style
// bypass for the manual refresh button, and a typed success/failure result
// that never throws across IPC — a fetch failure surfaces as a stale/error
// state in the panel, never an unhandled rejection.

const AVIATIONWEATHER_BASE = 'https://aviationweather.gov/api/data'
const REQUEST_TIMEOUT_MS = 10_000

/** The last successful fetch, kept until a newer one replaces it. */
let cache: { snapshot: WeatherSnapshot; fetchedAtMs: number } | null = null

/** Coalesces concurrent refresh callers (poll tick + a manual click at once). */
let inFlight: Promise<WeatherResult> | null = null

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A descriptive, "be a polite client" User-Agent — unlike LiveATC (which
 * rejects non-browser UAs, see plsResolver.ts), aviationweather.gov is a
 * programmatic NOAA data API: identifying the app by name/version plus a
 * repo link is the polite convention here, not a browser impersonation.
 */
function weatherUserAgent(): string {
  return `${app.getName()}/${app.getVersion()} (+https://github.com/ericwait/airshow-traffic-monitor)`
}

/** GET `url` as JSON with the given User-Agent. Rejects on HTTP >=400, a bad body, or a timeout. */
function httpGetJson<T>(url: string, ua: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false

    const request = net.request({ method: 'GET', url, redirect: 'follow' })
    request.setHeader('User-Agent', ua)
    request.setHeader('Accept', 'application/json')

    const timer = setTimeout(() => {
      finish(() => {
        try {
          request.abort()
        } catch {
          /* already closed — ignore */
        }
        reject(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`))
      })
    }, REQUEST_TIMEOUT_MS)

    function finish(fn: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    request.on('response', (response) => {
      const statusCode = response.statusCode
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () =>
        finish(() => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (statusCode >= 400) {
            reject(new Error(`HTTP ${statusCode} from ${url}`))
            return
          }
          try {
            resolve(JSON.parse(body) as T)
          } catch (err: unknown) {
            reject(new Error(`could not parse JSON response from ${url}: ${errMessage(err)}`))
          }
        })
      )
      response.on('error', (err: Error) => finish(() => reject(err)))
    })

    request.on('error', (err: Error) => finish(() => reject(err)))
    request.end()
  })
}

/** Classify a thrown error into a WeatherResult failure kind, best-effort. */
function classifyError(err: unknown): 'network' | 'parse' | 'unknown' {
  const msg = errMessage(err)
  if (/could not parse JSON/i.test(msg)) return 'parse'
  if (/^HTTP \d+/i.test(msg) || /timed out/i.test(msg)) return 'network'
  return 'unknown'
}

/** Fetch + derive a fresh snapshot for `station`. Throws on any failure (caller wraps it). */
async function fetchSnapshot(station: string, pollMinutes: number): Promise<WeatherSnapshot> {
  const ua = weatherUserAgent()
  const encodedStation = encodeURIComponent(station)

  const [metarRecords, tafRecords] = await Promise.all([
    httpGetJson<MetarApiRecord[]>(
      `${AVIATIONWEATHER_BASE}/metar?ids=${encodedStation}&format=json`,
      ua
    ),
    httpGetJson<TafApiRecord[]>(`${AVIATIONWEATHER_BASE}/taf?ids=${encodedStation}&format=json`, ua)
  ])

  return {
    station,
    pollMinutes,
    fetchedAt: Date.now(),
    metar: metarRecords.length > 0 ? summarizeMetar(metarRecords[0]) : null,
    taf: tafRecords.length > 0 ? summarizeTaf(tafRecords[0]) : null
  }
}

/**
 * Read the current weather snapshot: the cache if it is still within the
 * configured poll interval, otherwise a fresh fetch. Never throws.
 */
export async function getWeather(): Promise<WeatherResult> {
  const { pollMinutes } = getActiveConfig().weather
  const maxAgeMs = pollMinutes * 60_000
  if (cache && Date.now() - cache.fetchedAtMs < maxAgeMs) {
    return { ok: true, snapshot: cache.snapshot }
  }
  return refreshWeather()
}

/**
 * Force a fresh METAR/TAF fetch, bypassing the cache-freshness check (still
 * coalesces overlapping callers into one in-flight request). Never throws —
 * on failure, `stale` carries the last good snapshot so the panel can keep
 * showing last-known conditions instead of going blank.
 */
export function refreshWeather(): Promise<WeatherResult> {
  if (inFlight) return inFlight

  const { station, pollMinutes } = getActiveConfig().weather

  const attempt = (async (): Promise<WeatherResult> => {
    try {
      const snapshot = await fetchSnapshot(station, pollMinutes)
      cache = { snapshot, fetchedAtMs: Date.now() }
      return { ok: true, snapshot }
    } catch (err: unknown) {
      return {
        ok: false,
        kind: classifyError(err),
        error: `could not fetch weather for ${station}: ${errMessage(err)}`,
        stale: cache?.snapshot ?? null
      }
    } finally {
      inFlight = null
    }
  })()

  inFlight = attempt
  return attempt
}

/** Drop the cached snapshot (used when config reloads with a possibly-new station). */
export function clearWeatherCache(): void {
  cache = null
}
