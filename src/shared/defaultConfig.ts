// The curated KOSH defaults + the zod schema that validates config.json. This
// is the live tuning surface: the streams, their priorities/pan/volume, and the
// VAD detection parameters are all edited here (compiled defaults) or in the
// user's config.json at the show, no rebuild required.
//
// Lives in src/shared so all three processes compile against one schema and one
// AppConfig type: the main process reads/writes/validates the file, the renderer
// builds the audio engine from it, and vitest exercises the schema directly.
// zod is pure (no Electron, no DOM), so this module stays shared-safe.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** One ATC stream: what to play, how loud, where in the field, and how it ranks. */
export const streamSchema = z.object({
  /** Stable identifier, referenced by the resolver cache and the UI. */
  id: z.string().min(1),
  /** Human label shown on the stream strip. */
  label: z.string().min(1),
  /** LiveATC `.pls` playlist URL — resolved to a stream URL on connect. */
  plsUrl: z.url(),
  /** Priority rank, 1 = highest. Drives Phase 2b ducking; ordering here too. */
  priority: z.number().int().min(1),
  /** Stereo placement, -1 (hard left) .. +1 (hard right). */
  pan: z.number().min(-1).max(1),
  /** Starting volume, 0 .. 1. Remembered across a mute (mute never loses it). */
  defaultVolume: z.number().min(0).max(1),
  /** Ship muted? The activity light still works while muted (design contract). */
  muted: z.boolean()
})

/**
 * Voice-activity-detection parameters. Every value is tunable at the show. See
 * `audio/vad.ts` for the algorithm; the field names here match its VadParams
 * interface exactly so `config.vad` feeds the detector directly.
 */
export const vadSchema = z.object({
  /** Detector poll period in ms (the engine's shared setInterval tick). */
  tickMs: z.number().positive(),
  /** AnalyserNode FFT size (power of two). Larger = smoother, more latency. */
  fftSize: z.number().int().positive(),
  /** Initial noise-floor estimate, dBFS. */
  floorInitDb: z.number(),
  /** [min, max] clamp on the adaptive floor, dBFS. */
  floorClampDb: z.tuple([z.number(), z.number()]),
  /** EMA weight when the level is BELOW the floor (fast fall toward quiet). */
  floorFallAlpha: z.number().min(0).max(1),
  /** EMA weight when the level is ABOVE the floor (slow rise; never chase signal). */
  floorRiseAlpha: z.number().min(0).max(1),
  /** Light turns on this many dB above the floor. */
  activeThresholdDb: z.number(),
  /** Light releases below this many dB above the floor (hysteresis < active). */
  releaseThresholdDb: z.number(),
  /** Consecutive ticks above the active threshold required to latch on. */
  attackTicks: z.number().int().min(1),
  /** Hang time in ms that bridges inter-word un-key/re-key gaps. */
  hangMs: z.number().min(0)
})

/**
 * Priority-ducking parameters. Parked for Phase 2b — the duck gain node exists
 * in the graph now (fixed at 1.0), and 2b wires this value into it.
 */
export const duckingSchema = z.object({
  /** Ducked target gain (0.25 ≈ −12 dB). */
  duckLevel: z.number().min(0).max(1)
})

/** The whole config file. Unknown top-level keys are stripped, not rejected. */
export const configSchema = z.object({
  /** Schema version, for future migrations. */
  version: z.number().int().positive().default(1),
  /** Free-form notes preserved through validation (config.json has no comments). */
  notes: z.array(z.string()).optional(),
  /** The ATC streams, at least one. */
  streams: z.array(streamSchema).min(1),
  /** VAD tuning block. */
  vad: vadSchema,
  /** Ducking tuning block (2b). */
  ducking: duckingSchema
})

/** The validated, app-facing config type inferred from the schema. */
export type AppConfig = z.infer<typeof configSchema>
/** A single validated stream definition. */
export type StreamConfig = z.infer<typeof streamSchema>
/** The VAD parameter block (structurally compatible with vad.ts VadParams). */
export type VadConfig = z.infer<typeof vadSchema>

// ---------------------------------------------------------------------------
// Curated KOSH defaults (verified live 2026-07-18). plsUrl mount form:
//   https://www.liveatc.net/play/<mount>.pls
//
// Pans are spread across the stereo field so overlapping calls separate in
// space (guard centred; higher-traffic feeds pushed left/right). Priority 1 is
// highest. ATIS is a continuous loop: it ships muted-with-light at low volume
// and, lowest-ranked, never ducks anything (see docs/design/Audio.md).
// ---------------------------------------------------------------------------

const KOSH_PLS = (mount: string): string => `https://www.liveatc.net/play/${mount}.pls`

const DEFAULT_STREAMS: StreamConfig[] = [
  { id: 'guard', label: 'Emergency/Guard', plsUrl: KOSH_PLS('kosh_guard'), priority: 1, pan: 0, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'tower', label: 'Tower N+S', plsUrl: KOSH_PLS('kosh_twr'), priority: 2, pan: -0.6, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'fisk', label: 'Fisk VFR Approach', plsUrl: KOSH_PLS('kosh3'), priority: 3, pan: 0.6, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'gnd', label: 'Del/Gnd/Misc', plsUrl: KOSH_PLS('kosh7'), priority: 4, pan: -0.3, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'depmon', label: 'Departure Monitor', plsUrl: KOSH_PLS('kosh_depmon'), priority: 5, pan: 0.3, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'tower-s', label: 'South Tower 18/36', plsUrl: KOSH_PLS('kosh2'), priority: 6, pan: -0.8, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'airshow', label: 'Air Show', plsUrl: KOSH_PLS('kosh4'), priority: 7, pan: 0.8, defaultVolume: 0.8, muted: false }, // prettier-ignore
  { id: 'atis', label: 'ATIS', plsUrl: KOSH_PLS('kosh6'), priority: 8, pan: 0, defaultVolume: 0.4, muted: true } // prettier-ignore
]

/**
 * The compiled defaults, written verbatim to config.json on first run and used
 * as the fallback whenever the on-disk file is missing or invalid.
 */
export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  notes: [
    'This file is yours to edit — the app writes it once, then leaves it alone.',
    'Run "Reload config" in the ATC Audio panel header after editing.',
    'The Oshkosh Seaplane Base feed exists on LiveATC under a different site code;',
    'add its .pls URL as another stream entry here to monitor it.'
  ],
  streams: DEFAULT_STREAMS,
  vad: {
    tickMs: 50,
    fftSize: 2048,
    floorInitDb: -60,
    floorClampDb: [-90, -35],
    floorFallAlpha: 0.1,
    floorRiseAlpha: 0.002,
    activeThresholdDb: 8,
    releaseThresholdDb: 4,
    attackTicks: 2,
    hangMs: 700
  },
  ducking: {
    duckLevel: 0.25
  }
}

/**
 * Format a zod validation error into a compact, human-readable string for the
 * fallback banner — path plus message per issue, so a 6 a.m. edit typo names
 * the offending field, not a stack trace.
 */
export function formatConfigError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}
