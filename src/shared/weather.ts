// Pure METAR/TAF derivation logic — flight-category math, TAF-period mapping,
// and the handful of display formatters the weather panel needs. No fetch, no
// Electron, no DOM: pure input -> output, so the derivation is unit-testable
// (tests/unit/weather.test.ts) against real API-shaped fixtures without a
// network call. See docs/design/Weather.md for the product intent and
// docs/development/TechStack.md for the data-source specifics.
//
// The aviationweather.gov Data API's JSON already includes a decoded `fltCat`
// field, but we deliberately do NOT trust it — every category shown by this
// app is re-derived here from ceiling + visibility, so the logic is testable
// and independent of any one data source's own decoding (and would keep
// working unchanged if the data source were ever swapped).

/** The four US flight-rule categories, worst to best: LIFR < IFR < MVFR < VFR. */
export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR'

/** Severity ranking used to compare categories (higher = worse). */
const SEVERITY: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 }

/** True when `a` is strictly worse (lower ceiling/visibility) than `b`. */
export function isWorseCategory(a: FlightCategory, b: FlightCategory): boolean {
  return SEVERITY[a] > SEVERITY[b]
}

// ---------------------------------------------------------------------------
// Ceiling + category derivation
// ---------------------------------------------------------------------------

/** One reported/forecast cloud layer, already normalized to feet AGL. */
export interface CloudLayer {
  /** SKC / CLR / FEW / SCT / BKN / OVC / OVX, upper-cased. */
  cover: string
  /** Layer base, feet AGL. Null when the layer reports no base (SKC/CLR). */
  baseFtAgl: number | null
}

/**
 * Derive the ceiling in feet AGL from a set of cloud layers: the US definition
 * of "ceiling" is the base of the LOWEST **broken or overcast** layer — SCT and
 * FEW layers never count, no matter how low. `vertVisFtAgl` (vertical
 * visibility, reported instead of a cloud layer when the sky is obscured, e.g.
 * fog) is folded in as an equivalent ceiling when present, since it is the
 * legal ceiling substitute for obscured conditions.
 *
 * @returns the ceiling in feet AGL, or null when there is no ceiling (clear,
 *   or nothing at/above broken) — treated as "unlimited" by the caller.
 */
export function deriveCeilingFtAgl(
  clouds: readonly CloudLayer[],
  vertVisFtAgl?: number | null
): number | null {
  const candidates = clouds
    .filter((c) => (c.cover === 'BKN' || c.cover === 'OVC') && c.baseFtAgl != null)
    .map((c) => c.baseFtAgl as number)

  if (vertVisFtAgl != null) candidates.push(vertVisFtAgl)
  if (candidates.length === 0) return null
  return Math.min(...candidates)
}

/**
 * Derive the US flight category from a ceiling (feet AGL, null = no ceiling —
 * treated as unlimited) and visibility (statute miles, null = not reported —
 * treated as unlimited). The worse of the two dimensions governs, per the
 * FAA/AIM definitions:
 *
 *   LIFR: ceiling <500 ft       OR  vis <1 SM
 *   IFR:  500-999 ft            OR  1 - <3 SM
 *   MVFR: 1000-3000 ft          OR  3-5 SM
 *   VFR:  >3000 ft AND          >5 SM
 */
export function deriveFlightCategory(
  ceilingFtAgl: number | null,
  visibilitySm: number | null
): FlightCategory {
  const ceilingCategory: FlightCategory = (() => {
    if (ceilingFtAgl == null) return 'VFR'
    if (ceilingFtAgl < 500) return 'LIFR'
    if (ceilingFtAgl < 1000) return 'IFR'
    if (ceilingFtAgl <= 3000) return 'MVFR'
    return 'VFR'
  })()

  const visibilityCategory: FlightCategory = (() => {
    if (visibilitySm == null) return 'VFR'
    if (visibilitySm < 1) return 'LIFR'
    if (visibilitySm < 3) return 'IFR'
    if (visibilitySm <= 5) return 'MVFR'
    return 'VFR'
  })()

  return isWorseCategory(ceilingCategory, visibilityCategory) ? ceilingCategory : visibilityCategory
}

/**
 * Parse the API's `visib` field (statute miles) into a plain number. The API
 * usually reports a number, but reports reporting-limit values as a string
 * with a trailing `+` (e.g. `"10+"`, `"6+"` — "this good or better"); the `+`
 * is stripped since that exact bound already lands in the right VFR bucket
 * regardless of how much further visibility actually extends.
 *
 * @returns the value in statute miles, or null for missing/unparseable input.
 */
export function parseVisibilitySm(visib: number | string | null | undefined): number | null {
  if (visib == null) return null
  if (typeof visib === 'number') return Number.isFinite(visib) ? visib : null
  const trimmed = visib.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseFloat(trimmed.replace(/\+$/, ''))
  return Number.isFinite(parsed) ? parsed : null
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/** A decoded wind report, direction/speed/gust plus the "variable" flag. */
export interface WindReport {
  dirDeg: number | null
  variable: boolean
  speedKt: number | null
  gustKt: number | null
}

/**
 * Decode the API's wind fields. `wdir` is usually a number (degrees) but the
 * API reports `"VRB"` (variable wind, direction not meaningful) as a string.
 */
export function summarizeWind(
  wdir: number | string | null | undefined,
  wspd: number | null | undefined,
  wgst: number | null | undefined
): WindReport {
  const variable = typeof wdir === 'string' && wdir.trim().toUpperCase() === 'VRB'
  const dirDeg = typeof wdir === 'number' ? wdir : null
  return {
    dirDeg,
    variable,
    speedKt: wspd ?? null,
    gustKt: wgst ?? null
  }
}

// ---------------------------------------------------------------------------
// aviationweather.gov API record shapes (loosely typed — see
// docs/development/TechStack.md for the observed KOSH response; this is a
// free NOAA service with no versioned contract, so every field this app reads
// is declared optional/nullable defensively rather than assumed stable).
// ---------------------------------------------------------------------------

/** One cloud layer as the API reports it (before normalizing to CloudLayer). */
export interface ApiCloudLayer {
  cover: string
  base: number | null
}

/** One record from `GET /api/data/metar?ids=<station>&format=json`. */
export interface MetarApiRecord {
  icaoId: string
  /** Observation time, unix seconds. */
  obsTime: number
  wdir?: number | string | null
  wspd?: number | null
  wgst?: number | null
  visib?: number | string | null
  wxString?: string | null
  rawOb: string
  clouds?: readonly ApiCloudLayer[] | null
}

/** One forecast period inside a TAF record's `fcsts` array. */
export interface TafForecastPeriod {
  /** Period start, unix seconds. */
  timeFrom: number
  /** Period end, unix seconds. */
  timeTo: number
  /** BECMG's "becoming by" time, unix seconds, when present. */
  timeBec?: number | null
  /** FM / BECMG / TEMPO / PROB40 / null (null = the initial "from" period). */
  fcstChange?: string | null
  probability?: number | null
  wdir?: number | string | null
  wspd?: number | null
  wgst?: number | null
  visib?: number | string | null
  wxString?: string | null
  vertVis?: number | null
  clouds?: readonly ApiCloudLayer[] | null
}

/** One record from `GET /api/data/taf?ids=<station>&format=json`. */
export interface TafApiRecord {
  icaoId: string
  issueTime?: string | null
  rawTAF: string
  fcsts: readonly TafForecastPeriod[]
}

// ---------------------------------------------------------------------------
// Derived, app-facing shapes — what the renderer actually displays. Produced
// from the loosely-typed API records above by the summarize* functions below.
// These are the shapes carried across IPC (see src/shared/ipc.ts's WeatherSnapshot).
// ---------------------------------------------------------------------------

export interface WeatherMetar {
  station: string
  /** Observation time, epoch ms. */
  observedAt: number
  category: FlightCategory
  ceilingFtAgl: number | null
  visibilitySm: number | null
  windDirDeg: number | null
  windVariable: boolean
  windSpeedKt: number | null
  windGustKt: number | null
  wxString: string | null
  /** The raw METAR text, for the collapsible/title-attribute raw line. */
  rawText: string
}

export interface WeatherTafPeriod {
  /** Period start, epoch ms. */
  startsAt: number
  /** Period end, epoch ms. */
  endsAt: number
  /** FM / BECMG / TEMPO / PROB40 / null (null = the TAF's initial period). */
  changeIndicator: string | null
  probability: number | null
  category: FlightCategory
  ceilingFtAgl: number | null
  visibilitySm: number | null
  windDirDeg: number | null
  windVariable: boolean
  windSpeedKt: number | null
  windGustKt: number | null
  wxString: string | null
}

export interface WeatherTaf {
  station: string
  /** Issue time, epoch ms. */
  issuedAt: number
  /** The raw TAF text, for the collapsible/title-attribute raw line. */
  rawText: string
  periods: WeatherTafPeriod[]
}

function toCloudLayers(clouds: readonly ApiCloudLayer[] | null | undefined): CloudLayer[] {
  return (clouds ?? []).map((c) => ({ cover: c.cover.toUpperCase(), baseFtAgl: c.base }))
}

/** Derive a WeatherMetar from a raw API METAR record. Pure — no fetch. */
export function summarizeMetar(record: MetarApiRecord): WeatherMetar {
  const clouds = toCloudLayers(record.clouds)
  const ceilingFtAgl = deriveCeilingFtAgl(clouds)
  const visibilitySm = parseVisibilitySm(record.visib)
  const category = deriveFlightCategory(ceilingFtAgl, visibilitySm)
  const wind = summarizeWind(record.wdir, record.wspd, record.wgst)

  return {
    station: record.icaoId,
    observedAt: record.obsTime * 1000,
    category,
    ceilingFtAgl,
    visibilitySm,
    windDirDeg: wind.dirDeg,
    windVariable: wind.variable,
    windSpeedKt: wind.speedKt,
    windGustKt: wind.gustKt,
    wxString: record.wxString ?? null,
    rawText: record.rawOb
  }
}

/**
 * Derive a WeatherTafPeriod from one forecast period. TAF period handling is
 * deliberately simplified (see docs/design/Weather.md "known gaps"): each
 * period the API returns is mapped independently to a category + time window
 * and shown in sequence; `TEMPO`/`PROBnn` periods (temporary, non-prevailing
 * conditions) are not visually distinguished from `FM`/`BECMG` (prevailing
 * conditions) beyond carrying their own `changeIndicator` string through.
 */
export function summarizeTafPeriod(period: TafForecastPeriod): WeatherTafPeriod {
  const clouds = toCloudLayers(period.clouds)
  const ceilingFtAgl = deriveCeilingFtAgl(clouds, period.vertVis ?? null)
  const visibilitySm = parseVisibilitySm(period.visib)
  const category = deriveFlightCategory(ceilingFtAgl, visibilitySm)
  const wind = summarizeWind(period.wdir, period.wspd, period.wgst)

  return {
    startsAt: period.timeFrom * 1000,
    endsAt: period.timeTo * 1000,
    changeIndicator: period.fcstChange ?? null,
    probability: period.probability ?? null,
    category,
    ceilingFtAgl,
    visibilitySm,
    windDirDeg: wind.dirDeg,
    windVariable: wind.variable,
    windSpeedKt: wind.speedKt,
    windGustKt: wind.gustKt,
    wxString: period.wxString ?? null
  }
}

/** Derive a WeatherTaf (station + issue time + raw text + mapped periods). */
export function summarizeTaf(record: TafApiRecord): WeatherTaf {
  return {
    station: record.icaoId,
    issuedAt: record.issueTime ? Date.parse(record.issueTime) : Date.now(),
    rawText: record.rawTAF,
    periods: record.fcsts.map(summarizeTafPeriod)
  }
}

/**
 * Find the next TAF period (by start time) whose category is strictly better
 * than `currentCategory`, considering only periods that haven't already ended
 * as of `nowMs`. Drives the "VFR expected ~18Z" highlight — returns null when
 * no upcoming period improves on the current conditions.
 */
export function findNextImprovingPeriod(
  currentCategory: FlightCategory,
  periods: readonly WeatherTafPeriod[],
  nowMs: number
): WeatherTafPeriod | null {
  const upcoming = periods
    .filter((p) => p.endsAt > nowMs)
    .slice()
    .sort((a, b) => a.startsAt - b.startsAt)

  for (const period of upcoming) {
    if (isWorseCategory(currentCategory, period.category)) return period
  }
  return null
}

// ---------------------------------------------------------------------------
// Display formatters — small, pure, and testable so the panel's text can't
// silently regress. Renderer-agnostic (plain strings, no JSX).
// ---------------------------------------------------------------------------

/** e.g. "060° at 4 kt", "Variable at 3 kt", "060° at 4 kt, gusting 15 kt", "Calm". */
export function formatWind(
  dirDeg: number | null,
  variable: boolean,
  speedKt: number | null,
  gustKt: number | null
): string {
  if (speedKt == null) return 'Wind unknown'
  if (speedKt === 0) return 'Calm'
  const dir = variable
    ? 'Variable'
    : dirDeg != null
      ? `${dirDeg.toString().padStart(3, '0')}°`
      : 'Unknown dir'
  const gust = gustKt != null && gustKt > speedKt ? `, gusting ${gustKt} kt` : ''
  return `${dir} at ${speedKt} kt${gust}`
}

/** e.g. "1.75 SM", "10+ SM", "Vis unknown". */
export function formatVisibility(visibilitySm: number | null): string {
  if (visibilitySm == null) return 'Vis unknown'
  return `${visibilitySm} SM`
}

/** e.g. "1,700 ft", "Unlimited". */
export function formatCeiling(ceilingFtAgl: number | null): string {
  if (ceilingFtAgl == null) return 'Unlimited ceiling'
  return `${ceilingFtAgl.toLocaleString('en-US')} ft ceiling`
}
