import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_SCHEME, APP_ORIGIN, registerAppScheme } from './protocol'
import { startRendererServer } from './rendererServer'
import type { RendererServer } from './rendererServer'
import { Fr24Controller } from './fr24'
import { registerIpc } from './ipc'
import { WeatherPoller } from './weatherPoller'

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
let weatherPoller: WeatherPoller | null = null
let disposeIpc: (() => void) | null = null
// The loopback renderer server (Phase 2b, decision 2026-07-19). Started once and
// reused across window (re)creation; closed on quit.
let rendererServer: RendererServer | null = null

/**
 * Decide the URL the main renderer loads from:
 *   dev server present (ELECTRON_RENDERER_URL) -> the electron-vite HMR server,
 *   otherwise                                  -> the loopback http server,
 *   loopback bind failure                      -> the app:// scheme (degraded).
 *
 * The packaged renderer is served over http (not app://) because the YouTube
 * IFrame API validates the embedding origin and rejects app:// (error 153); a
 * real http(s) origin is required. app:// stays registered as the fallback.
 */
async function rendererUrlToLoad(): Promise<string> {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) return devServerUrl

  if (!rendererServer) {
    try {
      rendererServer = await startRendererServer()
    } catch (err: unknown) {
      console.warn(
        '[main] the loopback renderer server failed to start — YouTube tiles will be blank ' +
          '(embed-origin validation rejects app://) — falling back to the app:// scheme:',
        err
      )
      return `${APP_ORIGIN}/index.html`
    }
  }
  return `${rendererServer.url}/index.html`
}

/** Resolve the renderer URL, then load it into the window (guarded + logged). */
async function loadRenderer(win: BrowserWindow): Promise<void> {
  const url = await rendererUrlToLoad()
  if (win.isDestroyed()) return
  try {
    await win.loadURL(url)
  } catch (err: unknown) {
    console.error(`[main] failed to load the renderer at ${url}:`, err)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Airshow Traffic Monitor',
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
  weatherPoller = new WeatherPoller(mainWindow)
  weatherPoller.start()
  disposeIpc = registerIpc(fr24, weatherPoller)

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
    weatherPoller?.stop()
    weatherPoller = null
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // The renderer load path is keyed off ELECTRON_RENDERER_URL — the dev-server
  // signal electron-vite sets during `just dev`. Its presence, NOT is.dev, is the
  // correct discriminator: a built-but-unpackaged run (e2e, `just up`) has
  // app.isPackaged === false yet no dev server, and must still load the packaged
  // renderer — now from the loopback http server (app:// only on its failure).
  // See rendererUrlToLoad above.
  void loadRenderer(mainWindow)
}

app
  .whenReady()
  .then(() => {
    // Set the AppUserModelId on Windows so notifications and taskbar grouping
    // attribute to this app rather than the generic Electron identity.
    electronApp.setAppUserModelId('com.ericwait.airshow-traffic-monitor')

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

// Release the loopback renderer server's port on the way out.
app.on('will-quit', () => {
  rendererServer?.close()
  rendererServer = null
})
