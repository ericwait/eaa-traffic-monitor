import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppApi,
  Fr24Bounds,
  Fr24NavAction,
  Fr24NavState,
  SessionPatch,
  SessionState
} from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'

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
