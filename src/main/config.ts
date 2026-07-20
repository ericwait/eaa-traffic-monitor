import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import type { AppConfig, StreamConfig } from '@shared/defaultConfig'
import {
  configSchema,
  DEFAULT_CONFIG,
  formatConfigError,
  streamSchema
} from '@shared/defaultConfig'
import type { ConfigResult, UpdateStreamsResult } from '@shared/ipc'

// config.json lives in app.getPath('userData'). On first run the compiled
// defaults are written verbatim so the operator has a file to edit; on every
// later launch the file is read and zod-validated.
//
// Reliability mandate (this gets debugged at 6 a.m. mid-airshow): a
// missing/corrupt/invalid config NEVER crashes the app. Any read or validation
// failure degrades to the compiled defaults, records WHY (the zod issue text and
// the file path), and surfaces it as a dismissible banner in the renderer — the
// app is still fully usable on defaults while the operator fixes the file.

/** Cached result so repeated config:get calls don't re-hit the disk. */
let cached: ConfigResult | null = null

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Absolute path to the config file in this app's userData directory. */
export function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** Read + validate config.json, writing defaults on first run. Never throws. */
function loadFromDisk(): ConfigResult {
  const filePath = getConfigPath()

  // First run: no file yet. Write the compiled defaults so the operator has
  // something to edit, then use them. A write failure is non-fatal — we still
  // run on the in-memory defaults, we just couldn't persist them this launch.
  if (!existsSync(filePath)) {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
      console.log(`[config] first run — wrote default config to ${filePath}`)
    } catch (err: unknown) {
      console.warn(
        `[config] could not write the default config to ${filePath}; ` +
          `continuing on in-memory defaults (settings will not persist this run):`,
        err
      )
    }
    return { config: DEFAULT_CONFIG, source: 'file', filePath }
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err: unknown) {
    const error = `could not read ${filePath}: ${errMessage(err)}`
    console.error(`[config] ${error} — using compiled defaults`)
    return { config: DEFAULT_CONFIG, source: 'defaults-fallback', filePath, error }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: unknown) {
    const error = `config.json is not valid JSON: ${errMessage(err)}`
    console.error(`[config] ${error} — using compiled defaults`)
    return { config: DEFAULT_CONFIG, source: 'defaults-fallback', filePath, error }
  }

  const result = configSchema.safeParse(parsed)
  if (!result.success) {
    const error = formatConfigError(result.error)
    console.error(`[config] config.json failed validation (${error}) — using compiled defaults`)
    return { config: DEFAULT_CONFIG, source: 'defaults-fallback', filePath, error }
  }

  return { config: result.data, source: 'file', filePath }
}

/** The active config result (loaded once, then cached). Never throws. */
export function getConfig(): ConfigResult {
  if (!cached) cached = loadFromDisk()
  return cached
}

/** Re-read config.json from disk (the "Reload config" button). Never throws. */
export function reloadConfig(): ConfigResult {
  cached = loadFromDisk()
  console.log(`[config] reloaded from ${cached.filePath} (source: ${cached.source})`)
  return cached
}

/**
 * Replace the streams block of the active config and persist it (the channel
 * manager's add / remove / reorder — decision 2026-07-19: the ATC panel may
 * rewrite `streams`; the file stays hand-editable and every other block — vad,
 * ducking, weather, notes — passes through untouched).
 *
 * Never throws. On any failure nothing is written and the previous config
 * stays in force. The write is atomic (temp file + rename) so a crash mid-save
 * can never leave a half-written config.json for the 6 a.m. debugging session.
 */
export function updateStreams(streams: unknown): UpdateStreamsResult {
  const current = getConfig()

  // A defaults-fallback means config.json exists on disk but is broken. Saving
  // now would silently overwrite whatever the operator was hand-editing —
  // refuse and point at the file instead (the banner already names the error).
  if (current.source === 'defaults-fallback') {
    return {
      ok: false,
      error:
        `config.json is currently invalid, so channel edits cannot be saved ` +
        `without overwriting it. Fix or delete ${current.filePath}, reload, then retry.`
    }
  }

  const parsed = z.array(streamSchema).min(1).safeParse(streams)
  if (!parsed.success) {
    return { ok: false, error: `invalid streams: ${formatConfigError(parsed.error)}` }
  }

  const ids = new Set(parsed.data.map((s) => s.id))
  if (ids.size !== parsed.data.length) {
    return { ok: false, error: 'invalid streams: duplicate stream ids' }
  }
  const priorities = new Set(parsed.data.map((s) => s.priority))
  if (priorities.size !== parsed.data.length) {
    return { ok: false, error: 'invalid streams: duplicate priority ranks' }
  }

  const nextConfig: AppConfig = { ...current.config, streams: parsed.data }
  const { filePath } = current
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
    renameSync(tempPath, filePath)
  } catch (err: unknown) {
    return { ok: false, error: `could not write ${filePath}: ${errMessage(err)}` }
  }

  cached = { config: nextConfig, source: 'file', filePath }
  console.log(`[config] streams updated (${parsed.data.length} streams) — wrote ${filePath}`)
  return { ok: true, result: cached }
}

/** Look up a single stream definition by id from the active config. */
export function getStreamById(id: string): StreamConfig | undefined {
  return getConfig().config.streams.find((s) => s.id === id)
}

/** The validated AppConfig currently in use. */
export function getActiveConfig(): AppConfig {
  return getConfig().config
}
