import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
// Runtime window icon (Windows/Linux). electron-vite copies this PNG into out/
// at build and resolves the import to its on-disk path; it ships inside out/**.
// macOS ignores BrowserWindow.icon (it uses the app bundle's .icns), so this is
// only applied off-darwin — see createWindow / PopoutManager.
import appIcon from '../../design/brand/png/app-icon-ember-512.png?asset'
import { APP_SCHEME, APP_ORIGIN, registerAppScheme } from './protocol'
import { startRendererServer } from './rendererServer'
import type { RendererServer } from './rendererServer'
import { Fr24Controller } from './fr24'
import { registerFr24Ipc, registerGlobalIpc } from './ipc'
import { flushSession, getSessionState, patchSessionState } from './session'
import { resolveSavedBounds, trackWindowBounds } from './windowState'
import { PopoutManager } from './popouts'
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

// E2E isolation: the Playwright suites exercise flows that WRITE to userData
// (the channel manager rewrites config.json; session.json persists constantly),
// so the harness points the app at a throwaway directory rather than mutating
// the operator's real profile. Must run before app `ready` (userData is read
// lazily but early); ignored entirely outside the harness.
if (process.env.E2E_USERDATA) {
  app.setPath('userData', process.env.E2E_USERDATA)
}

let mainWindow: BrowserWindow | null = null
let fr24: Fr24Controller | null = null
let weatherPoller: WeatherPoller | null = null
let disposeFr24Ipc: (() => void) | null = null
let disposeGlobalIpc: (() => void) | null = null
let disposeBoundsTracking: (() => void) | null = null
// The loopback renderer server (Phase 2b, decision 2026-07-19). Started once and
// reused across window (re)creation; closed on quit.
let rendererServer: RendererServer | null = null
// The pop-out window manager (Phase 4). Created once at ready and shared with the
// windows:* IPC handlers; owns every pop-out BrowserWindow and its session slice.
let popouts: PopoutManager | null = null

// The window icon applied at runtime on Windows/Linux; undefined on macOS, which
// draws the dock/window icon from the app bundle's .icns instead. Shared with
// every pop-out so a second-monitor window carries the same mark.
const windowIcon = process.platform === 'darwin' ? undefined : appIcon

/**
 * Decide the URL a renderer loads from, appending `query` (e.g. `?window=popout&id=1`):
 *   dev server present (ELECTRON_RENDERER_URL) -> the electron-vite HMR server,
 *   otherwise                                  -> the loopback http server,
 *   loopback bind failure                      -> the app:// scheme (degraded).
 *
 * The packaged renderer is served over http (not app://) because the YouTube
 * IFrame API validates the embedding origin and rejects app:// (error 153); a
 * real http(s) origin is required. app:// stays registered as the fallback. The
 * same resolver serves the main window (empty query) and every pop-out.
 */
async function resolveRendererUrl(query = ''): Promise<string> {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) return `${devServerUrl}${query}`

  if (!rendererServer) {
    try {
      rendererServer = await startRendererServer()
    } catch (err: unknown) {
      console.warn(
        '[main] the loopback renderer server failed to start — YouTube tiles will be blank ' +
          '(embed-origin validation rejects app://) — falling back to the app:// scheme:',
        err
      )
      return `${APP_ORIGIN}/index.html${query}`
    }
  }
  return `${rendererServer.url}/index.html${query}`
}

/** Resolve the main renderer URL, then load it into the window (guarded + logged). */
async function loadRenderer(win: BrowserWindow): Promise<void> {
  const url = await resolveRendererUrl()
  if (win.isDestroyed()) return
  try {
    await win.loadURL(url)
  } catch (err: unknown) {
    console.error(`[main] failed to load the renderer at ${url}:`, err)
  }
}

function createWindow(): void {
  // Restore the main window's bounds onto a display that still exists (the pure
  // validator recentres one saved on an unplugged monitor); fall back to the
  // default size on first run and let Electron place it.
  const restored = resolveSavedBounds(getSessionState().window, 'main window')

  mainWindow = new BrowserWindow({
    width: restored?.bounds.width ?? 1280,
    height: restored?.bounds.height ?? 800,
    ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {}),
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Airshow Traffic Monitor',
    ...(windowIcon ? { icon: windowIcon } : {}),
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
  // The weather poller pushes to the main window's renderer, so it lives and
  // dies with that window (see the close handler below).
  weatherPoller = new WeatherPoller(mainWindow)
  weatherPoller.start()

  // Only the FR24 view channels are per-main-window; session/config/audio/windows
  // are app-global (registered once at ready) so pop-outs share them.
  disposeFr24Ipc = registerFr24Ipc(fr24)

  // Persist the main window's bounds/display on every move/resize (debounced by
  // the session store) so a relaunch reopens exactly where it was left.
  disposeBoundsTracking = trackWindowBounds(mainWindow, (bounds) =>
    patchSessionState({ window: bounds })
  )

  // A late-subscribing or reloaded renderer (HMR) misses the FR24 nav events
  // that already fired; re-push current nav state once the renderer finishes
  // loading so the toolbar is always in sync.
  mainWindow.webContents.on('did-finish-load', () => {
    fr24?.pushNavState()
  })

  // Tear the view/IPC down before the window is gone so quit never crashes on a
  // dangling child view or duplicate listeners on re-create.
  mainWindow.on('close', () => {
    disposeBoundsTracking?.()
    disposeBoundsTracking = null
    disposeFr24Ipc?.()
    disposeFr24Ipc = null
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

    // Create the pop-out manager and register the app-global IPC BEFORE any
    // window loads — pop-outs (and the main window) call session/config/windows
    // handlers during their renderer bootstrap.
    popouts = new PopoutManager(resolveRendererUrl, windowIcon)
    // The weather poller is created with the main window (after this), so the
    // global handlers take a getter rather than the instance.
    disposeGlobalIpc = registerGlobalIpc(popouts, () => weatherPoller)

    createWindow()

    // Reopen every pop-out that was open at last quit, each validated onto a
    // connected display (a pop-out whose monitor is gone reappears on primary).
    popouts.restoreAll()

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

// Mark the pop-out manager as quitting BEFORE any window closes, so pop-out
// windows tearing down on quit keep their session slices for next-launch restore
// (a user closing one pop-out still forgets it — that path is not a quit).
app.on('before-quit', () => {
  popouts?.setQuitting()
})

// Flush any debounced session state and release the loopback renderer server's
// port on the way out. flushSession is synchronous + atomic, so a patch still
// inside its ~500 ms debounce window (a last-second layout drag) is not lost.
app.on('will-quit', () => {
  disposeGlobalIpc?.()
  disposeGlobalIpc = null
  flushSession()
  rendererServer?.close()
  rendererServer = null
})
