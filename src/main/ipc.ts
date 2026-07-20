import { ipcMain, nativeTheme } from 'electron'
import type {
  Fr24Bounds,
  Fr24NavAction,
  LiveAtcSearchResult,
  OpenPopoutRequest,
  PopoutPatch,
  ResolveStreamResult,
  SessionPatch,
  ThemeMode,
  UpdateStreamsResult,
  VideoLayoutState,
  WeatherResult,
  WindowBoundsState
} from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import type { Fr24Controller } from './fr24'
import type { PopoutManager } from './popouts'
import { getSessionState, patchSessionState } from './session'
import { getConfig, reloadConfig, updateStreams } from './config'
import { searchLiveAtc } from './liveatcDirectory'
import { clearResolveCache, resolveStream } from './plsResolver'
import { clearWeatherCache, getWeather, refreshWeather } from './weather'
import type { WeatherPoller } from './weatherPoller'

// Main-side IPC registration, split by lifetime:
//   - GLOBAL handlers (session, config, audio resolve, windows/pop-outs) are
//     registered once at app ready and live for the whole run — every window,
//     including pop-outs, calls them, so they must outlive any single window.
//   - FR24 handlers are the ONLY per-main-window listeners (the FR24 view belongs
//     to the main window); they are disposed on that window's close.
// Both narrow untrusted renderer payloads before acting on them.

const NAV_ACTIONS: readonly Fr24NavAction[] = ['back', 'forward', 'reload', 'home']
const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

/** Narrow an untrusted renderer payload to a valid ThemeMode. */
function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_MODES.includes(value as ThemeMode)
}

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

/** Narrow to WindowBoundsState (four finite numbers + a numeric/null displayId). */
function isWindowBounds(value: unknown): value is WindowBoundsState {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  return (
    num(b.x) &&
    num(b.y) &&
    num(b.width) &&
    num(b.height) &&
    (b.displayId === null || num(b.displayId))
  )
}

/** Narrow to VideoLayoutState (a valid mode plus string/null feed ids). */
function isVideoLayout(value: unknown): value is VideoLayoutState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const idOrNull = (x: unknown): boolean => x === null || typeof x === 'string'
  return (
    (v.mode === 'uniform' || v.mode === 'emphasized') &&
    idOrNull(v.emphasizedFeedId) &&
    idOrNull(v.fillPanelFeedId)
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Narrow an untrusted openPopout request; null when the shape is wrong. */
function narrowOpenPopoutRequest(value: unknown): OpenPopoutRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!isStringArray(v.feedIds) || !isVideoLayout(v.layout)) return null
  const request: OpenPopoutRequest = { feedIds: v.feedIds, layout: v.layout }
  if (isWindowBounds(v.bounds)) request.bounds = v.bounds
  return request
}

/** Narrow a pop-out renderer's persist patch to the fields it is allowed to set. */
function narrowPopoutPatch(value: unknown): PopoutPatch | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const patch: PopoutPatch = {}
  if (v.video !== undefined) {
    if (!isVideoLayout(v.video)) return null
    patch.video = v.video
  }
  if (v.volumes !== undefined) {
    if (typeof v.volumes !== 'object' || v.volumes === null) return null
    patch.volumes = v.volumes as PopoutPatch['volumes']
  }
  if (v.feedIds !== undefined) {
    if (!isStringArray(v.feedIds)) return null
    patch.feedIds = v.feedIds
  }
  return patch
}

/**
 * Register the app-global IPC handlers (session, config, audio resolve, windows).
 * Called once at app ready. Returns a disposer (used only on full teardown).
 */
export function registerGlobalIpc(
  popouts: PopoutManager,
  getWeatherPoller: () => WeatherPoller | null
): () => void {
  ipcMain.handle(IpcChannels.sessionGet, () => getSessionState())

  ipcMain.on(IpcChannels.sessionPatch, (_e, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      console.warn('[ipc] session:patch ignored — non-object payload:', patch)
      return
    }
    patchSessionState(patch as SessionPatch)
  })

  // --- Theme (Wyvern Watch reskin) ----------------------------------------
  // Drives nativeTheme.themeSource directly — every renderer's prefers-color-
  // scheme (main window, every pop-out) and the OS window chrome follow this
  // one setting at once, so there is no per-window sync code. Persisted the
  // same way any other session field is (decision 2026-07-19; see
  // docs/decisions/README.md and docs/WYVERN-RESKIN-PLAN.md Step 3).
  ipcMain.handle(IpcChannels.themeSet, (_e, theme: unknown) => {
    if (!isThemeMode(theme)) {
      console.warn('[ipc] theme:set ignored — invalid theme mode:', theme)
      return
    }
    nativeTheme.themeSource = theme
    patchSessionState({ theme })
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
    getWeatherPoller()?.start()
    return result
  })

  // --- Channel manager ------------------------------------------------------
  // updateStreams validates main-side (zod + unique ids/priorities) and writes
  // config.json atomically; a failure is a typed result and nothing changes.
  // On success: removed streams lose their resolve-cache entries and their
  // persisted session overrides (device routing, volume/mute/pan), so a future
  // stream reusing the id starts clean.
  ipcMain.handle(IpcChannels.configUpdateStreams, (_e, streams: unknown): UpdateStreamsResult => {
    const beforeIds = getConfig().config.streams.map((s) => s.id)
    const outcome = updateStreams(streams)
    if (!outcome.ok) return outcome

    const nextIds = new Set(outcome.result.config.streams.map((s) => s.id))
    const removed = beforeIds.filter((id) => !nextIds.has(id))
    // A reorder can also change nothing but priorities; plsUrls may have changed
    // for kept ids too (hand edits merged through the UI path are impossible
    // today, but clearing the whole cache is cheap and always correct).
    clearResolveCache()
    if (removed.length > 0) {
      const nulls = <T>(): Record<string, T | null> =>
        Object.fromEntries(removed.map((id) => [id, null]))
      patchSessionState({ audio: { devices: nulls(), streams: nulls() } })
    }
    return outcome
  })

  ipcMain.handle(
    IpcChannels.liveatcSearch,
    async (_e, icao: unknown, opts: unknown): Promise<LiveAtcSearchResult> => {
      if (typeof icao !== 'string' || icao.length === 0) {
        return {
          ok: false,
          icao: String(icao),
          kind: 'unknown',
          error: 'liveatc:search called without a station code'
        }
      }
      const fresh =
        typeof opts === 'object' && opts !== null && (opts as { fresh?: unknown }).fresh === true
      try {
        return await searchLiveAtc(icao, { fresh })
      } catch (err: unknown) {
        // Defensive: searchLiveAtc is written not to throw, but IPC must never
        // reject — a rejection would reach the renderer as an opaque error.
        return {
          ok: false,
          icao,
          kind: 'unknown',
          error: `unexpected error searching LiveATC: ${
            err instanceof Error ? err.message : String(err)
          }`
        }
      }
    }
  )

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

  // --- Pop-out windows (Phase 4) ------------------------------------------
  ipcMain.handle(IpcChannels.windowsOpenPopout, (_e, request: unknown): number => {
    const narrowed = narrowOpenPopoutRequest(request)
    if (!narrowed) {
      console.warn('[ipc] windows:openPopout ignored — malformed request:', request)
      return -1
    }
    return popouts.openPopout(narrowed)
  })

  ipcMain.on(IpcChannels.windowsClosePopout, (_e, id: unknown) => {
    if (typeof id !== 'number') {
      console.warn('[ipc] windows:closePopout ignored — non-numeric id:', id)
      return
    }
    popouts.closePopout(id)
  })

  ipcMain.on(IpcChannels.windowsPatchPopout, (_e, id: unknown, patch: unknown) => {
    if (typeof id !== 'number') {
      console.warn('[ipc] windows:patchPopout ignored — non-numeric id:', id)
      return
    }
    const narrowed = narrowPopoutPatch(patch)
    if (!narrowed) {
      console.warn('[ipc] windows:patchPopout ignored — malformed patch:', patch)
      return
    }
    popouts.patchPopout(id, narrowed)
  })

  ipcMain.handle(
    IpcChannels.windowsMergePopout,
    (_e, sourceId: unknown, targetId: unknown): boolean => {
      if (typeof sourceId !== 'number' || typeof targetId !== 'number') {
        console.warn('[ipc] windows:mergePopout ignored — non-numeric ids:', sourceId, targetId)
        return false
      }
      return popouts.mergePopout(sourceId, targetId)
    }
  )

  return () => {
    ipcMain.removeHandler(IpcChannels.sessionGet)
    ipcMain.removeAllListeners(IpcChannels.sessionPatch)
    ipcMain.removeHandler(IpcChannels.themeSet)
    ipcMain.removeHandler(IpcChannels.configGet)
    ipcMain.removeHandler(IpcChannels.configReload)
    ipcMain.removeHandler(IpcChannels.configUpdateStreams)
    ipcMain.removeHandler(IpcChannels.liveatcSearch)
    ipcMain.removeHandler(IpcChannels.audioResolveStream)
    ipcMain.removeHandler(IpcChannels.weatherGet)
    ipcMain.removeHandler(IpcChannels.weatherRefresh)
    ipcMain.removeHandler(IpcChannels.windowsOpenPopout)
    ipcMain.removeAllListeners(IpcChannels.windowsClosePopout)
    ipcMain.removeAllListeners(IpcChannels.windowsPatchPopout)
    ipcMain.removeHandler(IpcChannels.windowsMergePopout)
  }
}

/**
 * Register the FR24 view channels for one main window. Returns a disposer that
 * removes them again so a window re-create never stacks duplicate listeners.
 */
export function registerFr24Ipc(fr24: Fr24Controller): () => void {
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

  return () => {
    ipcMain.removeAllListeners(IpcChannels.fr24SetBounds)
    ipcMain.removeAllListeners(IpcChannels.fr24Nav)
    ipcMain.removeAllListeners(IpcChannels.fr24SetVisible)
  }
}
