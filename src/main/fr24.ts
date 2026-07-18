import { app, session, shell, WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Fr24Bounds, Fr24NavAction, Fr24NavState } from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import { stripUserAgentTokens } from '@shared/userAgent'
import {
  FR24_HOME_URL,
  FR24_HOST_SUFFIX,
  FR24_PARTITION,
  FR24_PERSIST_DEBOUNCE_MS
} from './fr24Constants'
import { getFr24LastUrl, setFr24LastUrl } from './session'

// The FR24 browser panel — a native WebContentsView attached to the main
// window's content view. This is the Phase 1 keystone: FR24 refuses iframe
// embedding (x-frame-options + Cloudflare), so the tracking pillar must be a
// real, independent browser context.
//
// Load-bearing rules encoded here:
//  - persist:fr24 session so the FR24 Gold login and a passed Cloudflare
//    challenge survive relaunch.
//  - a plain-Chrome UA (Electron/app tokens stripped) for Cloudflare hygiene.
//  - the view paints ABOVE all DOM, so bounds come from a non-scrolling DOM
//    region via IPC, and overlays hide it with setVisible(false).
//  - last-URL persistence (debounced) → near-free map-position restore.

const isDev = !app.isPackaged

/**
 * Decide whether a URL the FR24 page tried to open should escape to the system
 * browser. Anything NOT on flightradar24.com (help pages, account pages, ad
 * click-throughs) opens externally; FR24's own pop-ups are simply denied.
 */
function isExternalUrl(rawUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(rawUrl)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname !== FR24_HOST_SUFFIX && !hostname.endsWith(`.${FR24_HOST_SUFFIX}`)
  } catch {
    // Unparseable target — do not hand it to the OS.
    return false
  }
}

export class Fr24Controller {
  private readonly mainWindow: BrowserWindow
  private view: WebContentsView | null = null
  private persistTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /**
   * Create the view, harden its session, attach it to the main window, wire
   * navigation/persistence, and load the restored (or home) URL. Safe to call
   * once per controller.
   */
  attach(): void {
    if (this.view) {
      console.warn('[fr24] attach() called twice; ignoring the second call.')
      return
    }

    // Cloudflare hygiene: give the persistent partition a plain-Chrome UA before
    // the view loads anything. setUserAgent on the session covers every request
    // the partition makes.
    const partitionSession = session.fromPartition(FR24_PARTITION)
    try {
      const cleanUa = stripUserAgentTokens(app.userAgentFallback, app.getName())
      partitionSession.setUserAgent(cleanUa)
      if (isDev) console.log(`[fr24] partition UA set to: ${cleanUa}`)
    } catch (err: unknown) {
      console.error(
        '[fr24] failed to set a clean user agent on the persist:fr24 session; ' +
          'FR24 may present a Cloudflare challenge:',
        err
      )
    }

    try {
      this.view = new WebContentsView({
        webPreferences: {
          partition: FR24_PARTITION,
          // This is a third-party site in its own browser context — no Node, no
          // preload, isolated from our app.
          nodeIntegration: false,
          contextIsolation: true
        }
      })
    } catch (err: unknown) {
      console.error('[fr24] failed to create the WebContentsView; FR24 panel unavailable:', err)
      this.view = null
      return
    }

    const wc = this.view.webContents

    // Attach to the window and start with a zero-size, so the view stays
    // invisible until the renderer reports the real region bounds (no flash of a
    // mis-positioned map before the layout measures itself).
    this.mainWindow.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

    // Deny every pop-up; route genuinely external links to the system browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalUrl(url)) {
        shell.openExternal(url).catch((err: unknown) => {
          console.error(`[fr24] failed to open external URL "${url}" in system browser:`, err)
        })
      }
      return { action: 'deny' }
    })

    // Push nav state on every event the toolbar cares about, and (on real and
    // in-page navigations) schedule a debounced URL persist.
    const pushNav = (): void => this.pushNavState()
    wc.on('did-start-loading', pushNav)
    wc.on('did-stop-loading', pushNav)
    wc.on('did-navigate', (_e, url) => {
      console.log(`[fr24] did-navigate -> ${url}`)
      this.pushNavState()
      this.schedulePersist()
    })
    wc.on('did-navigate-in-page', (_e, url) => {
      if (isDev) console.log(`[fr24] did-navigate-in-page -> ${url}`)
      this.pushNavState()
      this.schedulePersist()
    })
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      // -3 is ERR_ABORTED — a normal consequence of a redirect/rapid nav, not a
      // failure worth shouting about.
      if (errorCode === -3) return
      console.error(`[fr24] did-fail-load (${errorCode} ${errorDescription}) for ${validatedURL}`)
      this.pushNavState()
    })

    // Resolve the initial URL: an e2e override wins (CI must never depend on
    // flightradar24.com loading), else the restored URL, else home.
    const override = process.env.FR24_URL_OVERRIDE
    const restored = override ?? getFr24LastUrl() ?? FR24_HOME_URL
    this.loadUrl(restored, restored !== FR24_HOME_URL && !override)
  }

  /** Load a URL, optionally falling back to home if the primary load fails. */
  private loadUrl(url: string, fallbackToHome: boolean): void {
    const wc = this.view?.webContents
    if (!wc) return
    wc.loadURL(url).catch((err: unknown) => {
      console.error(`[fr24] failed to load "${url}":`, err)
      if (fallbackToHome) {
        console.warn(`[fr24] falling back to home view: ${FR24_HOME_URL}`)
        wc.loadURL(FR24_HOME_URL).catch((homeErr: unknown) => {
          console.error(`[fr24] failed to load home view "${FR24_HOME_URL}":`, homeErr)
        })
      }
    })
  }

  /** Reposition/resize the view to match its DOM region (from fr24:setBounds). */
  setBounds(bounds: Fr24Bounds): void {
    if (!this.view) return
    try {
      this.view.setBounds(bounds)
    } catch (err: unknown) {
      console.error('[fr24] setBounds failed for', bounds, err)
    }
  }

  /** Show/hide the view — the overlay/z-order rule (from fr24:setVisible). */
  setVisible(visible: boolean): void {
    if (!this.view) return
    try {
      this.view.setVisible(visible)
    } catch (err: unknown) {
      console.error(`[fr24] setVisible(${visible}) failed:`, err)
    }
  }

  /** Perform a toolbar navigation action (from fr24:nav). */
  nav(action: Fr24NavAction): void {
    const wc = this.view?.webContents
    if (!wc) {
      console.warn(`[fr24] nav("${action}") ignored — no FR24 view.`)
      return
    }
    const history = wc.navigationHistory
    try {
      switch (action) {
        case 'back':
          if (history.canGoBack()) history.goBack()
          break
        case 'forward':
          if (history.canGoForward()) history.goForward()
          break
        case 'reload':
          wc.reload()
          break
        case 'home':
          this.loadUrl(FR24_HOME_URL, false)
          break
        default:
          console.warn(`[fr24] unknown nav action: ${String(action)}`)
      }
    } catch (err: unknown) {
      console.error(`[fr24] nav("${action}") failed:`, err)
    }
  }

  /** Compute and push the current navigation state to the renderer toolbar. */
  pushNavState(): void {
    const wc = this.view?.webContents
    if (!wc || this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return
    try {
      const history = wc.navigationHistory
      const state: Fr24NavState = {
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        url: wc.getURL(),
        isLoading: wc.isLoading()
      }
      this.mainWindow.webContents.send(IpcChannels.fr24NavState, state)
    } catch (err: unknown) {
      console.error('[fr24] failed to push nav state:', err)
    }
  }

  /** Debounced persist of the current URL → near-free map-position restore. */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      const wc = this.view?.webContents
      if (!wc) return
      try {
        const url = wc.getURL()
        // Never persist about:blank / empty (e.g. the e2e override) as a "view".
        if (url && url.startsWith('http')) setFr24LastUrl(url)
      } catch (err: unknown) {
        console.error('[fr24] failed to persist last URL:', err)
      }
    }, FR24_PERSIST_DEBOUNCE_MS)
  }

  /** Remove and destroy the view so window close / quit never crashes. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const view = this.view
    this.view = null
    if (!view) return
    try {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.contentView.removeChildView(view)
      }
    } catch (err: unknown) {
      console.error('[fr24] failed to remove the FR24 view from the window:', err)
    }
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch (err: unknown) {
      console.error('[fr24] failed to close the FR24 webContents:', err)
    }
  }
}
