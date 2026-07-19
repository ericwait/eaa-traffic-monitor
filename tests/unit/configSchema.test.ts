import { describe, it, expect } from 'vitest'
import {
  configSchema,
  DEFAULT_CONFIG,
  formatConfigError,
  streamSchema,
  weatherSchema
} from '@shared/defaultConfig'

// Guardian tests for the config zod schema and the curated defaults. The config
// file is the show-day tuning surface — a bad hand-edit must fail loudly with a
// field name, and the compiled defaults must always be valid (they are the
// fallback when the file is not).

describe('DEFAULT_CONFIG', () => {
  it('validates against the schema', () => {
    const result = configSchema.safeParse(DEFAULT_CONFIG)
    expect(result.success).toBe(true)
  })

  it('ships the eight curated KOSH streams with priorities 1..8', () => {
    expect(DEFAULT_CONFIG.streams).toHaveLength(8)
    const priorities = DEFAULT_CONFIG.streams.map((s) => s.priority).sort((a, b) => a - b)
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('gives every stream a unique id', () => {
    const ids = DEFAULT_CONFIG.streams.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ranks Emergency/Guard highest (1) and ATIS lowest (8, muted, low volume)', () => {
    const guard = DEFAULT_CONFIG.streams.find((s) => s.id === 'guard')
    const atis = DEFAULT_CONFIG.streams.find((s) => s.id === 'atis')
    expect(guard?.priority).toBe(1)
    expect(atis?.priority).toBe(8)
    expect(atis?.muted).toBe(true)
    expect(atis?.defaultVolume).toBeLessThan(0.5)
  })

  it('points every plsUrl at a liveatc.net .pls mount', () => {
    for (const s of DEFAULT_CONFIG.streams) {
      expect(s.plsUrl).toMatch(/^https:\/\/www\.liveatc\.net\/play\/.+\.pls$/)
    }
  })

  it('keeps all pans inside the stereo field', () => {
    for (const s of DEFAULT_CONFIG.streams) {
      expect(s.pan).toBeGreaterThanOrEqual(-1)
      expect(s.pan).toBeLessThanOrEqual(1)
    }
  })

  it('defaults the weather block to KOSH at a 10-minute poll interval', () => {
    expect(DEFAULT_CONFIG.weather).toEqual({ station: 'KOSH', pollMinutes: 10 })
  })
})

describe('weatherSchema', () => {
  it('fills in both defaults from an empty object', () => {
    expect(weatherSchema.parse({})).toEqual({ station: 'KOSH', pollMinutes: 10 })
  })

  it('accepts a custom station and a slower poll interval', () => {
    const parsed = weatherSchema.parse({ station: 'KMSN', pollMinutes: 15 })
    expect(parsed).toEqual({ station: 'KMSN', pollMinutes: 15 })
  })

  it('rejects a poll interval faster than every 5 minutes', () => {
    expect(weatherSchema.safeParse({ pollMinutes: 1 }).success).toBe(false)
  })

  it('accepts exactly the 5-minute floor', () => {
    expect(weatherSchema.parse({ pollMinutes: 5 }).pollMinutes).toBe(5)
  })

  it('rejects an empty station id', () => {
    expect(weatherSchema.safeParse({ station: '' }).success).toBe(false)
  })
})

describe('configSchema weather section', () => {
  it('a config.json written before this feature (no weather key) still validates, with defaults applied', () => {
    const { weather, ...withoutWeather } = DEFAULT_CONFIG
    void weather
    const parsed = configSchema.parse(withoutWeather)
    expect(parsed.weather).toEqual({ station: 'KOSH', pollMinutes: 10 })
  })

  it('a hand-edited config can point weather at a different station/cadence', () => {
    const parsed = configSchema.parse({
      ...DEFAULT_CONFIG,
      weather: { station: 'KMSN', pollMinutes: 20 }
    })
    expect(parsed.weather).toEqual({ station: 'KMSN', pollMinutes: 20 })
  })

  it('rejects a config.json whose weather.pollMinutes is below the 5-minute floor', () => {
    const result = configSchema.safeParse({
      ...DEFAULT_CONFIG,
      weather: { station: 'KOSH', pollMinutes: 2 }
    })
    expect(result.success).toBe(false)
  })
})

describe('configSchema parsing', () => {
  it('defaults version to 1 when the file omits it', () => {
    const { version, ...withoutVersion } = DEFAULT_CONFIG
    void version
    const result = configSchema.parse(withoutVersion)
    expect(result.version).toBe(1)
  })

  it('strips unknown top-level keys but preserves declared notes', () => {
    const parsed = configSchema.parse({
      ...DEFAULT_CONFIG,
      _handEditedComment: 'this should not fail validation'
    })
    expect('_handEditedComment' in parsed).toBe(false)
    expect(parsed.notes).toEqual(DEFAULT_CONFIG.notes)
  })

  it('rejects a stream with a non-URL plsUrl', () => {
    const bad = { ...DEFAULT_CONFIG.streams[0], plsUrl: 'not-a-url' }
    expect(streamSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a pan outside [-1, 1]', () => {
    const bad = { ...DEFAULT_CONFIG.streams[0], pan: 1.5 }
    expect(streamSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a volume outside [0, 1]', () => {
    const bad = { ...DEFAULT_CONFIG.streams[0], defaultVolume: 2 }
    expect(streamSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an empty streams array', () => {
    const result = configSchema.safeParse({ ...DEFAULT_CONFIG, streams: [] })
    expect(result.success).toBe(false)
  })

  it('fills in the ducking τ defaults when a Phase-2a config omits them', () => {
    // A config.json written before Phase 2b only had ducking.duckLevel; the new
    // τ fields must default in rather than reject the whole file.
    const parsed = configSchema.parse({
      ...DEFAULT_CONFIG,
      ducking: { duckLevel: 0.3 }
    })
    expect(parsed.ducking.duckLevel).toBe(0.3)
    expect(parsed.ducking.duckTauS).toBe(0.05)
    expect(parsed.ducking.releaseTauS).toBe(0.2)
  })

  it('rejects a non-positive ducking τ', () => {
    const result = configSchema.safeParse({
      ...DEFAULT_CONFIG,
      ducking: { duckLevel: 0.25, duckTauS: 0, releaseTauS: 0.2 }
    })
    expect(result.success).toBe(false)
  })
})

describe('formatConfigError', () => {
  it('names the offending field path in the message', () => {
    const result = configSchema.safeParse({
      ...DEFAULT_CONFIG,
      streams: [{ ...DEFAULT_CONFIG.streams[0], pan: 9 }]
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = formatConfigError(result.error)
      expect(msg).toMatch(/streams\.0\.pan/)
    }
  })
})
