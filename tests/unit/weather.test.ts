import { describe, it, expect } from 'vitest'
import {
  deriveCeilingFtAgl,
  deriveFlightCategory,
  parseVisibilitySm,
  summarizeWind,
  summarizeMetar,
  summarizeTaf,
  summarizeTafPeriod,
  findNextImprovingPeriod,
  formatWind,
  formatVisibility,
  formatCeiling,
  isWorseCategory,
  type MetarApiRecord,
  type TafApiRecord,
  type WeatherTafPeriod
} from '@shared/weather'

// Guardian tests for the METAR/TAF derivation logic — flight category is the
// app's primary visual signal (see docs/design/Weather.md), so the ceiling +
// visibility math is exercised at every US category boundary, plus against
// real API-shaped fixtures captured live from
//   https://aviationweather.gov/api/data/metar?ids=KOSH&format=json
//   https://aviationweather.gov/api/data/taf?ids=KOSH&format=json
// on 2026-07-19, so a regression here is caught against the actual shape the
// data source sends rather than only against hand-built fixtures.

describe('deriveCeilingFtAgl', () => {
  it('returns null (unlimited) for an empty cloud layer list', () => {
    expect(deriveCeilingFtAgl([])).toBeNull()
  })

  it('ignores SCT and FEW layers entirely', () => {
    const clouds = [
      { cover: 'FEW', baseFtAgl: 500 },
      { cover: 'SCT', baseFtAgl: 1000 }
    ]
    expect(deriveCeilingFtAgl(clouds)).toBeNull()
  })

  it('takes the base of a single BKN layer', () => {
    expect(deriveCeilingFtAgl([{ cover: 'BKN', baseFtAgl: 2200 }])).toBe(2200)
  })

  it('takes the base of a single OVC layer', () => {
    expect(deriveCeilingFtAgl([{ cover: 'OVC', baseFtAgl: 1800 }])).toBe(1800)
  })

  it('takes the LOWEST of several BKN/OVC layers, ignoring SCT/FEW mixed in', () => {
    const clouds = [
      { cover: 'FEW', baseFtAgl: 300 },
      { cover: 'BKN', baseFtAgl: 4500 },
      { cover: 'OVC', baseFtAgl: 1200 },
      { cover: 'SCT', baseFtAgl: 800 }
    ]
    expect(deriveCeilingFtAgl(clouds)).toBe(1200)
  })

  it('folds in vertical visibility as an equivalent ceiling when present', () => {
    expect(deriveCeilingFtAgl([], 300)).toBe(300)
  })

  it('takes the lower of a BKN layer and vertical visibility', () => {
    expect(deriveCeilingFtAgl([{ cover: 'BKN', baseFtAgl: 900 }], 300)).toBe(300)
  })

  it('is case-insensitive on cover (normalized upstream, but defensive here too)', () => {
    expect(deriveCeilingFtAgl([{ cover: 'BKN', baseFtAgl: 1500 }])).toBe(1500)
  })
})

describe('deriveFlightCategory', () => {
  it('is VFR with no ceiling and no visibility limit', () => {
    expect(deriveFlightCategory(null, null)).toBe('VFR')
  })

  it('is VFR just above both thresholds (ceiling 3001, vis 5.01)', () => {
    expect(deriveFlightCategory(3001, 5.01)).toBe('VFR')
  })

  it('is MVFR exactly at the ceiling 3000 boundary', () => {
    expect(deriveFlightCategory(3000, 10)).toBe('MVFR')
  })

  it('is MVFR exactly at the ceiling 1000 boundary', () => {
    expect(deriveFlightCategory(1000, 10)).toBe('MVFR')
  })

  it('is MVFR exactly at the visibility 5 SM boundary', () => {
    expect(deriveFlightCategory(null, 5)).toBe('MVFR')
  })

  it('is MVFR exactly at the visibility 3 SM boundary', () => {
    expect(deriveFlightCategory(null, 3)).toBe('MVFR')
  })

  it('is IFR just under the ceiling 1000 boundary (999)', () => {
    expect(deriveFlightCategory(999, 10)).toBe('IFR')
  })

  it('is IFR exactly at the ceiling 500 boundary', () => {
    expect(deriveFlightCategory(500, 10)).toBe('IFR')
  })

  it('is IFR just under the visibility 3 SM boundary (2.99)', () => {
    expect(deriveFlightCategory(null, 2.99)).toBe('IFR')
  })

  it('is IFR exactly at the visibility 1 SM boundary', () => {
    expect(deriveFlightCategory(null, 1)).toBe('IFR')
  })

  it('is LIFR just under the ceiling 500 boundary (499)', () => {
    expect(deriveFlightCategory(499, 10)).toBe('LIFR')
  })

  it('is LIFR just under the visibility 1 SM boundary (0.99)', () => {
    expect(deriveFlightCategory(null, 0.99)).toBe('LIFR')
  })

  it('takes the WORSE of ceiling and visibility (good ceiling, bad vis)', () => {
    expect(deriveFlightCategory(5000, 0.5)).toBe('LIFR')
  })

  it('takes the WORSE of ceiling and visibility (bad ceiling, good vis)', () => {
    expect(deriveFlightCategory(200, 10)).toBe('LIFR')
  })

  it('matches the real KOSH SPECI fixture: 1700 ft SCT (no ceiling), 1.75 SM -> IFR', () => {
    // SCT never sets a ceiling, so this is visibility-governed: 1.75 SM is in
    // the "1 - <3 SM" IFR band.
    expect(deriveFlightCategory(null, 1.75)).toBe('IFR')
  })
})

describe('parseVisibilitySm', () => {
  it('passes a plain number through', () => {
    expect(parseVisibilitySm(1.75)).toBe(1.75)
  })

  it('returns null for null/undefined', () => {
    expect(parseVisibilitySm(null)).toBeNull()
    expect(parseVisibilitySm(undefined)).toBeNull()
  })

  it('strips a trailing "+" reporting-limit suffix', () => {
    expect(parseVisibilitySm('10+')).toBe(10)
    expect(parseVisibilitySm('6+')).toBe(6)
  })

  it('returns null for an empty or unparseable string', () => {
    expect(parseVisibilitySm('')).toBeNull()
    expect(parseVisibilitySm('n/a')).toBeNull()
  })

  it('returns null for a non-finite number (NaN/Infinity)', () => {
    expect(parseVisibilitySm(Number.NaN)).toBeNull()
  })
})

describe('summarizeWind', () => {
  it('decodes a numeric direction', () => {
    expect(summarizeWind(110, 3, null)).toEqual({
      dirDeg: 110,
      variable: false,
      speedKt: 3,
      gustKt: null
    })
  })

  it('flags "VRB" as variable with no direction', () => {
    expect(summarizeWind('VRB', 4, null)).toEqual({
      dirDeg: null,
      variable: true,
      speedKt: 4,
      gustKt: null
    })
  })

  it('is case-insensitive on "vrb"', () => {
    expect(summarizeWind('vrb', 4, null).variable).toBe(true)
  })

  it('carries a gust value through', () => {
    expect(summarizeWind(210, 7, 15)).toEqual({
      dirDeg: 210,
      variable: false,
      speedKt: 7,
      gustKt: 15
    })
  })
})

describe('isWorseCategory', () => {
  it('orders LIFR < IFR < MVFR < VFR in severity (LIFR worst)', () => {
    expect(isWorseCategory('LIFR', 'IFR')).toBe(true)
    expect(isWorseCategory('IFR', 'MVFR')).toBe(true)
    expect(isWorseCategory('MVFR', 'VFR')).toBe(true)
    expect(isWorseCategory('VFR', 'LIFR')).toBe(false)
  })

  it('is false for equal categories', () => {
    expect(isWorseCategory('IFR', 'IFR')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Real KOSH API fixtures (captured live 2026-07-19 — see file header).
// ---------------------------------------------------------------------------

const KOSH_METAR_FIXTURE: MetarApiRecord = {
  icaoId: 'KOSH',
  obsTime: 1784474460,
  wdir: 110,
  wspd: 3,
  visib: 1.75,
  wxString: 'HZ',
  rawOb: 'SPECI KOSH 191521Z 11003KT 1 3/4SM HZ SCT017 22/14 A3008 RMK AO2 T02220144',
  clouds: [{ cover: 'SCT', base: 1700 }]
}

const KOSH_TAF_FIXTURE: TafApiRecord = {
  icaoId: 'KOSH',
  issueTime: '2026-07-19T14:08:00.000Z',
  rawTAF:
    'TAF KOSH 191408Z 1914/2012 06004KT 1 1/2SM FU BR OVC018 FM191600 09005KT 2SM FU BKN022 ' +
    'FM191900 14004KT 3SM FU SCT035 FM200000 19006KT 4SM FU SCT250 FM200600 20007G15KT 6SM FU ' +
    'SCT250 FM200900 21008G16KT P6SM SCT250',
  fcsts: [
    {
      timeFrom: 1784469600,
      timeTo: 1784476800,
      fcstChange: null,
      wdir: 60,
      wspd: 4,
      visib: 1.5,
      wxString: 'FU BR',
      clouds: [{ cover: 'OVC', base: 1800 }]
    },
    {
      timeFrom: 1784476800,
      timeTo: 1784487600,
      fcstChange: 'FM',
      wdir: 90,
      wspd: 5,
      visib: 2,
      wxString: 'FU',
      clouds: [{ cover: 'BKN', base: 2200 }]
    },
    {
      timeFrom: 1784487600,
      timeTo: 1784505600,
      fcstChange: 'FM',
      wdir: 140,
      wspd: 4,
      visib: 3,
      wxString: 'FU',
      clouds: [{ cover: 'SCT', base: 3500 }]
    },
    {
      timeFrom: 1784505600,
      timeTo: 1784527200,
      fcstChange: 'FM',
      wdir: 190,
      wspd: 6,
      visib: 4,
      wxString: 'FU',
      clouds: [{ cover: 'SCT', base: 25000 }]
    },
    {
      timeFrom: 1784527200,
      timeTo: 1784538000,
      fcstChange: 'FM',
      wdir: 200,
      wspd: 7,
      wgst: 15,
      visib: 6,
      wxString: 'FU',
      clouds: [{ cover: 'SCT', base: 25000 }]
    },
    {
      timeFrom: 1784538000,
      timeTo: 1784548800,
      fcstChange: 'FM',
      wdir: 210,
      wspd: 8,
      wgst: 16,
      visib: '6+',
      wxString: null,
      clouds: [{ cover: 'SCT', base: 25000 }]
    }
  ]
}

describe('summarizeMetar (real KOSH fixture)', () => {
  it('derives IFR from the SPECI (1.75 SM haze, SCT never sets a ceiling)', () => {
    const summary = summarizeMetar(KOSH_METAR_FIXTURE)
    expect(summary.station).toBe('KOSH')
    expect(summary.observedAt).toBe(1784474460 * 1000)
    expect(summary.ceilingFtAgl).toBeNull()
    expect(summary.visibilitySm).toBe(1.75)
    expect(summary.category).toBe('IFR')
    expect(summary.windDirDeg).toBe(110)
    expect(summary.windVariable).toBe(false)
    expect(summary.windSpeedKt).toBe(3)
    expect(summary.windGustKt).toBeNull()
    expect(summary.wxString).toBe('HZ')
    expect(summary.rawText).toBe(KOSH_METAR_FIXTURE.rawOb)
  })

  it('defaults missing wind/wx/clouds to sane empty values', () => {
    const summary = summarizeMetar({
      icaoId: 'KOSH',
      obsTime: 0,
      rawOb: 'METAR KOSH 010000Z 00000KT CAVOK'
    })
    expect(summary.ceilingFtAgl).toBeNull()
    expect(summary.visibilitySm).toBeNull()
    expect(summary.category).toBe('VFR')
    expect(summary.windDirDeg).toBeNull()
    expect(summary.wxString).toBeNull()
  })
})

describe('summarizeTafPeriod / summarizeTaf (real KOSH fixture)', () => {
  it('maps the first (OVC018, 1.5 SM) period to IFR', () => {
    const period = summarizeTafPeriod(KOSH_TAF_FIXTURE.fcsts[0])
    expect(period.startsAt).toBe(1784469600 * 1000)
    expect(period.endsAt).toBe(1784476800 * 1000)
    expect(period.changeIndicator).toBeNull()
    expect(period.ceilingFtAgl).toBe(1800)
    expect(period.visibilitySm).toBe(1.5)
    expect(period.category).toBe('IFR')
  })

  it('maps the second (BKN022, 2 SM) FM period to IFR', () => {
    const period = summarizeTafPeriod(KOSH_TAF_FIXTURE.fcsts[1])
    expect(period.changeIndicator).toBe('FM')
    expect(period.ceilingFtAgl).toBe(2200)
    expect(period.category).toBe('IFR')
  })

  it('maps the third (SCT035, 3 SM) period to MVFR (SCT sets no ceiling; vis governs)', () => {
    const period = summarizeTafPeriod(KOSH_TAF_FIXTURE.fcsts[2])
    expect(period.ceilingFtAgl).toBeNull()
    expect(period.visibilitySm).toBe(3)
    expect(period.category).toBe('MVFR')
  })

  it('maps the fourth (SCT250, 4 SM) period to MVFR', () => {
    expect(summarizeTafPeriod(KOSH_TAF_FIXTURE.fcsts[3]).category).toBe('MVFR')
  })

  it('maps the fifth (SCT250, 6 SM, gusting) period to VFR', () => {
    const period = summarizeTafPeriod(KOSH_TAF_FIXTURE.fcsts[4])
    expect(period.visibilitySm).toBe(6)
    expect(period.category).toBe('VFR')
    expect(period.windGustKt).toBe(15)
  })

  it('parses the trailing "6+" visibility on the last period as VFR', () => {
    const period = summarizeTafPeriod(KOSH_TAF_FIXTURE.fcsts[5])
    expect(period.visibilitySm).toBe(6)
    expect(period.category).toBe('VFR')
    expect(period.wxString).toBeNull()
  })

  it('summarizeTaf carries the station, issue time, raw text, and all periods', () => {
    const taf = summarizeTaf(KOSH_TAF_FIXTURE)
    expect(taf.station).toBe('KOSH')
    expect(taf.issuedAt).toBe(Date.parse('2026-07-19T14:08:00.000Z'))
    expect(taf.rawText).toBe(KOSH_TAF_FIXTURE.rawTAF)
    expect(taf.periods).toHaveLength(6)
  })
})

describe('findNextImprovingPeriod', () => {
  const periods: WeatherTafPeriod[] = summarizeTaf(KOSH_TAF_FIXTURE).periods

  it('finds the first VFR period after the current IFR conditions', () => {
    // Current conditions (from the METAR fixture) are IFR; scanning from the
    // TAF's start, the first period whose category beats IFR is the third
    // (MVFR) — VFR arrives later still, but the fifth period is the first
    // properly VFR one.
    const now = periods[0].startsAt
    const next = findNextImprovingPeriod('IFR', periods, now)
    expect(next).not.toBeNull()
    expect(next?.category).toBe('MVFR')
    expect(next?.startsAt).toBe(periods[2].startsAt)
  })

  it('finds the next VFR period when current conditions are MVFR', () => {
    const now = periods[0].startsAt
    const next = findNextImprovingPeriod('MVFR', periods, now)
    expect(next?.category).toBe('VFR')
    expect(next?.startsAt).toBe(periods[4].startsAt)
  })

  it('returns null when nothing upcoming improves on VFR', () => {
    const now = periods[0].startsAt
    expect(findNextImprovingPeriod('VFR', periods, now)).toBeNull()
  })

  it('ignores periods that have already ended as of "now"', () => {
    // "now" is after every period ends -> nothing upcoming to find.
    const now = periods[periods.length - 1].endsAt + 1
    expect(findNextImprovingPeriod('IFR', periods, now)).toBeNull()
  })

  it('returns null for an empty period list', () => {
    expect(findNextImprovingPeriod('IFR', [], Date.now())).toBeNull()
  })
})

describe('formatWind', () => {
  it('formats a plain reported wind', () => {
    expect(formatWind(110, false, 3, null)).toBe('110° at 3 kt')
  })

  it('pads a single/double-digit direction to three digits', () => {
    expect(formatWind(6, false, 4, null)).toBe('006° at 4 kt')
  })

  it('formats calm wind (0 kt) regardless of direction', () => {
    expect(formatWind(0, false, 0, null)).toBe('Calm')
  })

  it('formats variable wind with no direction', () => {
    expect(formatWind(null, true, 4, null)).toBe('Variable at 4 kt')
  })

  it('appends a gust when it exceeds the sustained speed', () => {
    expect(formatWind(200, false, 7, 15)).toBe('200° at 7 kt, gusting 15 kt')
  })

  it('omits the gust clause when gust does not exceed sustained speed', () => {
    expect(formatWind(200, false, 7, 7)).toBe('200° at 7 kt')
  })

  it('reports unknown wind when speed is missing', () => {
    expect(formatWind(null, false, null, null)).toBe('Wind unknown')
  })
})

describe('formatVisibility', () => {
  it('formats a numeric visibility', () => {
    expect(formatVisibility(1.75)).toBe('1.75 SM')
  })

  it('reports unknown visibility for null', () => {
    expect(formatVisibility(null)).toBe('Vis unknown')
  })
})

describe('formatCeiling', () => {
  it('formats a ceiling with thousands separators', () => {
    expect(formatCeiling(1800)).toBe('1,800 ft ceiling')
  })

  it('reports unlimited ceiling for null', () => {
    expect(formatCeiling(null)).toBe('Unlimited ceiling')
  })
})
