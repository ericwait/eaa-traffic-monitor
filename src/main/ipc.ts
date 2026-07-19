import { ipcMain } from 'electron'
import type {
  Fr24Bounds,
  Fr24NavAction,
  ResolveStreamResult,
  SessionPatch,
  WeatherResult
} from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import type { Fr24Controller } from './fr24'
import { getSessionState, patchSessionState } from './session'
import { getConfig, reloadConfig } from './config'
import { clearResolveCache, resolveStream } from './plsResolver'
import { clearWeatherCache, getWeather, refreshWeather } from './weather'
import type { WeatherPoller } from './weatherPoller'

// Main-side IPC registration for Phase 1: the FR24 view channels plus the
// minimal session get/patch. Hand-rolled against the shared contract — one
// registration point so the wiring is auditable in a single file.

const NAV_ACTIONS: readonly Fr24NavAction[] = ['back', 'forward', 'reload', 'home']

/** Narrow an untrusted renderer payload to Fr24Bounds (all four integer-ish). */
function isBounds(value: unknown): value is Fr24Bounds {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  return (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number'
  )
}

/**
 * Wire every Phase 1 channel to the controller / session store. Returns a
 * disposer that removes the handlers again (so a window re-create never stacks
 * duplicate listeners).
 */
export function registerIpc(fr24: Fr24Controller, weatherPoller: WeatherPoller): () => void {
  ipcMain.on(IpcChannels.fr24SetBounds, (_e, bounds: unknown) => {
    if (!isBounds(bounds)) {
      console.warn('[ipc] fr24:setBounds ignored — malformed bounds payload:', bounds)
      return
    }
    fr24.setBounds(bounds)
  })

  ipcMain.on(IpcChannels.fr24Nav, (_e, action: unknown) => {
    if (typeof action !== 'string' || !NAV_ACTIONS.includes(action as Fr24NavAction)) {
      console.warn('[ipc] fr24:nav ignored — unknown action:', action)
      return
    }
    fr24.nav(action as Fr24NavAction)
  })

  ipcMain.on(IpcChannels.fr24SetVisible, (_e, visible: unknown) => {
    if (typeof visible !== 'boolean') {
      console.warn('[ipc] fr24:setVisible ignored — non-boolean payload:', visible)
      return
    }
    fr24.setVisible(visible)
  })

  ipcMain.handle(IpcChannels.sessionGet, () => {
    return getSessionState()
  })

  ipcMain.on(IpcChannels.sessionPatch, (_e, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      console.warn('[ipc] session:patch ignored — non-object payload:', patch)
      return
    }
    patchSessionState(patch as SessionPatch)
  })

  // --- Config (Phase 2a) --------------------------------------------------
  // Reading and validation never throw (config.ts degrades to defaults), so the
  // handlers just forward the result. Reload also drops the resolve cache so the
  // next connect re-resolves against any newly-edited plsUrls.
  ipcMain.handle(IpcChannels.configGet, () => getConfig())

  ipcMain.handle(IpcChannels.configReload, () => {
    const result = reloadConfig()
    clearResolveCache()
    // The reloaded file may name a different station or poll cadence — drop
    // the stale-station cache and restart the poll timer at the new interval.
    clearWeatherCache()
    weatherPoller.start()
    return result
  })

  // --- Audio (Phase 2a) ---------------------------------------------------
  // resolveStream returns a typed success/failure — never throws across IPC —
  // so a bad mount surfaces as a status chip, not an unhandled rejection.
  ipcMain.handle(
    IpcChannels.audioResolveStream,
    async (_e, streamId: unknown, opts: unknown): Promise<ResolveStreamResult> => {
      if (typeof streamId !== 'string' || streamId.length === 0) {
        return {
          ok: false,
          streamId: String(streamId),
          kind: 'unknown',
          error: 'resolveStream called without a valid stream id'
        }
      }
      const fresh =
        typeof opts === 'object' && opts !== null && (opts as { fresh?: unknown }).fresh === true
      try {
        return await resolveStream(streamId, { fresh })
      } catch (err: unknown) {
        // Defensive: resolveStream is written not to throw, but IPC must never
        // reject — a rejection would reach the renderer as an opaque error.
        return {
          ok: false,
          streamId,
          kind: 'unknown',
          error: `unexpected error resolving "${streamId}": ${
            err instanceof Error ? err.message : String(err)
          }`
        }
      }
    }
  )

  // --- Weather (field METAR/TAF) ------------------------------------------
  // getWeather/refreshWeather are written not to throw, but the same
  // defensive catch as audioResolveStream applies — IPC must never reject.
  ipcMain.handle(IpcChannels.weatherGet, async (): Promise<WeatherResult> => {
    try {
      return await getWeather()
    } catch (err: unknown) {
      return {
        ok: false,
        kind: 'unknown',
        error: `unexpected error reading field weather: ${
          err instanceof Error ? err.message : String(err)
        }`,
        stale: null
      }
    }
  })

  ipcMain.handle(IpcChannels.weatherRefresh, async (): Promise<WeatherResult> => {
    try {
      return await refreshWeather()
    } catch (err: unknown) {
      return {
        ok: false,
        kind: 'unknown',
        error: `unexpected error refreshing field weather: ${
          err instanceof Error ? err.message : String(err)
        }`,
        stale: null
      }
    }
  })

  return () => {
    ipcMain.removeAllListeners(IpcChannels.fr24SetBounds)
    ipcMain.removeAllListeners(IpcChannels.fr24Nav)
    ipcMain.removeAllListeners(IpcChannels.fr24SetVisible)
    ipcMain.removeHandler(IpcChannels.sessionGet)
    ipcMain.removeAllListeners(IpcChannels.sessionPatch)
    ipcMain.removeHandler(IpcChannels.configGet)
    ipcMain.removeHandler(IpcChannels.configReload)
    ipcMain.removeHandler(IpcChannels.audioResolveStream)
    ipcMain.removeHandler(IpcChannels.weatherGet)
    ipcMain.removeHandler(IpcChannels.weatherRefresh)
  }
}
