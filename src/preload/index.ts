import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// The typed IPC contract lands in Phase 1 (see src/shared/README.md). For now
// the preload only exposes the @electron-toolkit base bridge under `electron`,
// with contextIsolation ON and nodeIntegration OFF (the default here). Feature
// channels (config:get, audio:resolveStream, fr24:*, windows:openPopout, …)
// are added to a project-owned `api` object as each phase needs them.
const api = {}

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
