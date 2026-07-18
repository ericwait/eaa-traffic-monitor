import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_SCHEME, APP_ORIGIN, registerAppScheme } from './protocol'
import { Fr24Controller } from './fr24'
import { registerIpc } from './ipc'

// ---------------------------------------------------------------------------
// Privileged custom scheme registration.
//
// Phase 0 requirement: the packaged renderer must load from `app://` — NOT
// `file://`. Two production capabilities depend on a secure, non-file origin:
//   - the YouTube IFrame API postMessage handshake is unreliable from file://
//   - enumerateDevices() / setSinkId() (per-stream ATC device routing) need a
//     secure context in the packaged build.
// This call must run BEFORE app `ready`, so it sits at module top level.
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

let mainWindow: BrowserWindow | null = null
let fr24: Fr24Controller | null = null
let disposeIpc: (() => void) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'EAA Traffic Monitor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // The audio engine polls VAD on a setInterval, never rAF; a throttled
      // background timer would freeze activity lights when the window is not
      // focused. Disable background throttling from day one so later phases
      // inherit the correct behavior (see CLAUDE.md gotchas).
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // The FR24 panel is a native WebContentsView owned by the main process and
  // attached to this window's content view. Create it here so its lifecycle is
  // bound to the window's (see Fr24Controller.dispose on close, below).
  fr24 = new Fr24Controller(mainWindow)
  fr24.attach()
  disposeIpc = registerIpc(fr24)

  // A late-subscribing or reloaded renderer (HMR) misses the FR24 nav events
  // that already fired; re-push current nav state once the renderer finishes
  // loading so the toolbar is always in sync.
  mainWindow.webContents.on('did-finish-load', () => {
    fr24?.pushNavState()
  })

  // Tear the view/IPC down before the window is gone so quit never crashes on a
  // dangling child view or duplicate listeners on re-create.
  mainWindow.on('close', () => {
    disposeIpc?.()
    disposeIpc = null
    fr24?.dispose()
    fr24 = null
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // The renderer load path is keyed off ELECTRON_RENDERER_URL — the dev-server
  // signal electron-vite sets during `just dev`. Its presence, NOT is.dev, is
  // the correct discriminator: a built-but-unpackaged run (e2e, `just up`) has
  // app.isPackaged === false yet no dev server, and must still load app://.
  //   dev server present -> HMR dev server
  //   otherwise          -> packaged renderer over the secure app:// scheme
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl).catch((err: unknown) => {
      console.error(`[main] failed to load renderer dev server at ${devServerUrl}:`, err)
    })
  } else {
    const url = `${APP_ORIGIN}/index.html`
    mainWindow.loadURL(url).catch((err: unknown) => {
      console.error(`[main] failed to load packaged renderer at ${url}:`, err)
    })
  }
}

app
  .whenReady()
  .then(() => {
    // Set the AppUserModelId on Windows so notifications and taskbar grouping
    // attribute to this app rather than the generic Electron identity.
    electronApp.setAppUserModelId('com.ericwait.eaa-traffic-monitor')

    // Wire the app:// scheme to the packaged renderer files whenever we are not
    // pointed at the dev server (same discriminator as the load path above).
    // Registered here (after ready) because protocol.handle requires a ready app.
    if (!process.env['ELECTRON_RENDERER_URL']) {
      try {
        registerAppScheme()
      } catch (err: unknown) {
        console.error('[main] failed to register the app:// protocol handler:', err)
      }
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      // macOS: re-create a window when the dock icon is clicked and none are open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((err: unknown) => {
    console.error('[main] fatal: app failed to become ready:', err)
    app.quit()
  })

// The main-window renderer owns the ATC audio engine; Web Audio cannot span
// processes, so there is exactly one audio authority and it dies with the
// window. Quit on all platforms, macOS included — be honest about it rather
// than lingering as a headless dock icon with no audio (see CLAUDE.md).
app.on('window-all-closed', () => {
  app.quit()
})
