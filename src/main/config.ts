import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppConfig, StreamConfig } from '@shared/defaultConfig'
import { configSchema, DEFAULT_CONFIG, formatConfigError } from '@shared/defaultConfig'
import type { ConfigResult } from '@shared/ipc'

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

/** Look up a single stream definition by id from the active config. */
export function getStreamById(id: string): StreamConfig | undefined {
  return getConfig().config.streams.find((s) => s.id === id)
}

/** The validated AppConfig currently in use. */
export function getActiveConfig(): AppConfig {
  return getConfig().config
}
