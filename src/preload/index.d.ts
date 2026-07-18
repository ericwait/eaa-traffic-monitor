import type { ElectronAPI } from '@electron-toolkit/preload'

// Ambient declarations for the bridge globals the preload exposes. The
// renderer compiles against these so `window.electron` / `window.api` are
// typed. The `api` surface grows as feature channels are added per phase.
declare global {
  interface Window {
    electron: ElectronAPI
    api: Record<string, never>
  }
}

export {}
