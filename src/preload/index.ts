import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppApi,
  ConfigResult,
  Fr24Bounds,
  Fr24NavAction,
  Fr24NavState,
  LayoutCommand,
  LayoutMenuSyncPayload,
  LiveAtcSearchResult,
  OpenPopoutRequest,
  PopoutPatch,
  PopoutSummary,
  ResolveStreamResult,
  SessionPatch,
  SessionState,
  ThemeMode,
  UpdateStreamsResult,
  WeatherResult,
  WindowRole
} from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import type { StreamConfig } from '@shared/defaultConfig'

/**
 * Derive this window's renderer role from its launch URL query. The main window
 * loads `…/index.html` (role 'main'); a pop-out loads `…/index.html?window=popout&id=N`.
 * Parsed once here in the preload so the renderer reads a static flag, never the URL.
 */
function readWindowRole(): { role: WindowRole; popoutId: number | null } {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('window') === 'popout') {
      const id = Number(params.get('id'))
      return { role: 'popout', popoutId: Number.isFinite(id) ? id : null }
    }
  } catch {
    // location unavailable (unexpected) — fall through to the main-window default.
  }
  return { role: 'main', popoutId: null }
}

const { role: windowRole, popoutId } = readWindowRole()

// The project-owned bridge. contextIsolation is ON and nodeIntegration OFF, so
// the renderer never touches ipcRenderer directly — it calls this typed `api`
// surface, which is the exact shape of AppApi from the shared contract. A
// channel-name or payload change is a compile error here and in the renderer.
const api: AppApi = {
  fr24: {
    setBounds: (bounds: Fr24Bounds): void => {
      ipcRenderer.send(IpcChannels.fr24SetBounds, bounds)
    },
    nav: (action: Fr24NavAction): void => {
      ipcRenderer.send(IpcChannels.fr24Nav, action)
    },
    setVisible: (visible: boolean): void => {
      ipcRenderer.send(IpcChannels.fr24SetVisible, visible)
    },
    onNavState: (listener: (state: Fr24NavState) => void): (() => void) => {
      // Wrap the caller's listener so we don't leak Electron's event object into
      // the renderer, and return an unsubscribe that removes THIS wrapper (so a
      // StrictMode/HMR re-mount can never stack duplicate listeners).
      const handler = (_event: unknown, state: Fr24NavState): void => listener(state)
      ipcRenderer.on(IpcChannels.fr24NavState, handler)
      return () => ipcRenderer.removeListener(IpcChannels.fr24NavState, handler)
    }
  },
  session: {
    get: (): Promise<SessionState> => ipcRenderer.invoke(IpcChannels.sessionGet),
    patch: (patch: SessionPatch): void => {
      ipcRenderer.send(IpcChannels.sessionPatch, patch)
    }
  },
  theme: {
    set: (theme: ThemeMode): Promise<void> => ipcRenderer.invoke(IpcChannels.themeSet, theme)
  },
  config: {
    get: (): Promise<ConfigResult> => ipcRenderer.invoke(IpcChannels.configGet),
    reload: (): Promise<ConfigResult> => ipcRenderer.invoke(IpcChannels.configReload),
    updateStreams: (streams: StreamConfig[]): Promise<UpdateStreamsResult> =>
      ipcRenderer.invoke(IpcChannels.configUpdateStreams, streams)
  },
  audio: {
    resolveStream: (streamId: string, opts?: { fresh?: boolean }): Promise<ResolveStreamResult> =>
      ipcRenderer.invoke(IpcChannels.audioResolveStream, streamId, opts),
    // Static flag read once from the launch env — see AudioApi.isE2E.
    isE2E: process.env.AUDIO_E2E === '1'
  },
  liveatc: {
    search: (icao: string, opts?: { fresh?: boolean }): Promise<LiveAtcSearchResult> =>
      ipcRenderer.invoke(IpcChannels.liveatcSearch, icao, opts)
  },
  weather: {
    get: (): Promise<WeatherResult> => ipcRenderer.invoke(IpcChannels.weatherGet),
    refresh: (): Promise<WeatherResult> => ipcRenderer.invoke(IpcChannels.weatherRefresh),
    onUpdate: (listener: (result: WeatherResult) => void): (() => void) => {
      // Same wrap-and-unsubscribe shape as fr24.onNavState — never leaks
      // Electron's event object, and a StrictMode/HMR re-mount can't stack
      // duplicate listeners.
      const handler = (_event: unknown, result: WeatherResult): void => listener(result)
      ipcRenderer.on(IpcChannels.weatherUpdate, handler)
      return () => ipcRenderer.removeListener(IpcChannels.weatherUpdate, handler)
    }
  },
  windows: {
    openPopout: (request: OpenPopoutRequest): Promise<number> =>
      ipcRenderer.invoke(IpcChannels.windowsOpenPopout, request),
    closePopout: (id: number): void => {
      ipcRenderer.send(IpcChannels.windowsClosePopout, id)
    },
    patchPopout: (id: number, patch: PopoutPatch): void => {
      ipcRenderer.send(IpcChannels.windowsPatchPopout, id, patch)
    },
    mergePopout: (sourceId: number, targetId: number): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.windowsMergePopout, sourceId, targetId),
    onPopoutsChanged: (listener: (popouts: PopoutSummary[]) => void): (() => void) => {
      // Wrap the caller's listener so Electron's event object never leaks into the
      // renderer, and return an unsubscribe that removes THIS wrapper.
      const handler = (_event: unknown, popouts: PopoutSummary[]): void => listener(popouts)
      ipcRenderer.on(IpcChannels.windowsPopoutsChanged, handler)
      return () => ipcRenderer.removeListener(IpcChannels.windowsPopoutsChanged, handler)
    },
    role: windowRole,
    popoutId
  },
  layout: {
    syncMenu: (payload: LayoutMenuSyncPayload): void => {
      ipcRenderer.send(IpcChannels.layoutMenuSync, payload)
    },
    onCommand: (listener: (command: LayoutCommand) => void): (() => void) => {
      // Same wrap-and-unsubscribe shape as fr24.onNavState/weather.onUpdate —
      // never leaks Electron's event object, and a StrictMode/HMR re-mount
      // can't stack duplicate listeners.
      const handler = (_event: unknown, command: LayoutCommand): void => listener(command)
      ipcRenderer.on(IpcChannels.layoutCommand, handler)
      return () => ipcRenderer.removeListener(IpcChannels.layoutCommand, handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (err: unknown) {
    console.error('[preload] failed to expose bridge APIs to the renderer:', err)
  }
} else {
  // contextIsolation is expected to be ON; this branch only runs in a
  // misconfigured build. Fail visibly rather than silently degrading.
  console.error(
    '[preload] contextIsolation is OFF — refusing to attach globals directly. ' +
      'Fix webPreferences.contextIsolation in the main process.'
  )
}
