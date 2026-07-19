import { ipcMain } from 'electron'
import type {
  Fr24Bounds,
  Fr24NavAction,
  OpenPopoutRequest,
  PopoutPatch,
  ResolveStreamResult,
  SessionPatch,
  VideoLayoutState,
  WindowBoundsState
} from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import type { Fr24Controller } from './fr24'
import type { PopoutManager } from './popouts'
import { getSessionState, patchSessionState } from './session'
import { getConfig, reloadConfig } from './config'
import { clearResolveCache, resolveStream } from './plsResolver'

// Main-side IPC registration, split by lifetime:
//   - GLOBAL handlers (session, config, audio resolve, windows/pop-outs) are
//     registered once at app ready and live for the whole run — every window,
//     including pop-outs, calls them, so they must outlive any single window.
//   - FR24 handlers are the ONLY per-main-window listeners (the FR24 view belongs
//     to the main window); they are disposed on that window's close.
// Both narrow untrusted renderer payloads before acting on them.

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
export function registerGlobalIpc(popouts: PopoutManager): () => void {
  ipcMain.handle(IpcChannels.sessionGet, () => getSessionState())

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

  return () => {
    ipcMain.removeHandler(IpcChannels.sessionGet)
    ipcMain.removeAllListeners(IpcChannels.sessionPatch)
    ipcMain.removeHandler(IpcChannels.configGet)
    ipcMain.removeHandler(IpcChannels.configReload)
    ipcMain.removeHandler(IpcChannels.audioResolveStream)
    ipcMain.removeHandler(IpcChannels.windowsOpenPopout)
    ipcMain.removeAllListeners(IpcChannels.windowsClosePopout)
    ipcMain.removeAllListeners(IpcChannels.windowsPatchPopout)
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
