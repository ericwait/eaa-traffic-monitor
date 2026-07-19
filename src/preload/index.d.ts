import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AppApi } from '@shared/ipc'

// Ambient declarations for the bridge globals the preload exposes. The renderer
// compiles against these so `window.electron` / `window.api` are typed. `api` is
// the project-owned surface defined once in the shared IPC contract (AppApi) and
// grows there as feature channels are added per phase.
declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}

export {}
