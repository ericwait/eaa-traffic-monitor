import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { OpenPopoutRequest, PopoutState, PopoutSummary, WindowBoundsState } from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import { buildBalancedGrid, type PanelId } from '@shared/panelLayout'
import { nextPopoutId, popoutSummaries, type PopoutSlicePatch } from '@shared/session'
import { getSessionState, mergePopouts, patchPopout, removePopout, upsertPopout } from './session'
import { boundsStateFor, resolveSavedBounds, trackWindowBounds } from './windowState'

// Pop-out window manager (Phase 4). A pop-out is the SAME renderer bundle loaded
// at `?window=popout&id=N`, which the preload reads to render a grid-only window
// (no ATC, no FR24) for a subset of feeds — carried to a second/third monitor.
//
// Ownership model:
//   - The main process owns every pop-out BrowserWindow and its session slice
//     (bounds/display, feeds, layout, per-feed volumes). Bounds are tracked here;
//     the renderer persists only layout/volumes back through windows:patchPopout.
//   - Opening hands a feed off the main grid; closing returns it. A broadcast of
//     the open set drives that hand-off in every window.
//   - QUIT is not CLOSE: on quit the windows close but their slices stay in the
//     session so the next launch restores them (the `quitting` guard below). A
//     user closing one pop-out removes its slice and returns its feeds.

const DEFAULT_POPOUT_WIDTH = 960
const DEFAULT_POPOUT_HEIGHT = 600

/** Resolve the renderer URL for a given query string (injected so the loopback
 *  server / dev server / app:// fallback logic stays owned by index.ts). */
export type RendererUrlResolver = (query: string) => Promise<string>

export class PopoutManager {
  private readonly windows = new Map<number, BrowserWindow>()
  private readonly resolveUrl: RendererUrlResolver
  /** Runtime window icon (Windows/Linux); undefined on macOS (uses the .icns). */
  private readonly icon: string | undefined
  /** True once the app is quitting: close pop-outs WITHOUT wiping their slices. */
  private quitting = false

  constructor(resolveUrl: RendererUrlResolver, icon?: string) {
    this.resolveUrl = resolveUrl
    this.icon = icon
  }

  /** Mark that the app is quitting so pop-out closes preserve the session for restore. */
  setQuitting(): void {
    this.quitting = true
  }

  /**
   * Open a pop-out for a subset of feeds. The slice is persisted before the window
   * loads so the pop-out renderer can read its feeds/layout by id. Returns the id.
   */
  openPopout(request: OpenPopoutRequest): number {
    const id = nextPopoutId(getSessionState())
    const slice: PopoutState = {
      id,
      // A real position is written by spawn() once the window exists; this is a
      // placeholder only until then.
      bounds: request.bounds ?? {
        x: 0,
        y: 0,
        width: DEFAULT_POPOUT_WIDTH,
        height: DEFAULT_POPOUT_HEIGHT,
        displayId: null
      },
      feedIds: [...request.feedIds],
      // The pop-out's own panel-canvas tree (decision 2026-07-20) — a fresh
      // balanced grid over its starting feeds, the same shape a from-scratch
      // main-window video region gets. `request.layout` (VideoLayoutState) is
      // no longer read here; it survives on `OpenPopoutRequest` only because
      // nothing has removed the field yet (see @shared/ipc's doc comment).
      tree: buildBalancedGrid(request.feedIds.map((f): PanelId => `video:${f}`)),
      videoFit: {},
      volumes: {}
    }
    upsertPopout(slice)
    this.spawn(id, request.bounds ?? null)
    this.broadcast()
    return id
  }

  /** Recreate every persisted pop-out on launch (validating each against the live displays). */
  restoreAll(): void {
    for (const slice of getSessionState().popouts) this.spawn(slice.id, slice.bounds)
  }

  /** Close a pop-out on request (its slice is removed and its feeds return to the main grid). */
  closePopout(id: number): void {
    this.windows.get(id)?.close()
  }

  /**
   * Persist a pop-out renderer's own layout / fit / per-feed volumes / feed
   * set into its slice. Broadcasts the open-pop-out set whenever `feedIds`
   * is part of the patch — that's what tells every OTHER window (the main
   * grid's `startPopoutFeedTracking`, and this feed's `MergeIntoControl`)
   * that a feed changed hands, e.g. a per-leaf close inside a multi-feed
   * pop-out (`usePopoutLayout`'s `closePanel`) returning just that one feed
   * to the main window without closing the whole pop-out.
   */
  patchPopout(id: number, patch: PopoutSlicePatch): void {
    if (!this.windows.has(id)) return
    patchPopout(id, patch)
    if (patch.feedIds !== undefined) this.broadcast()
  }

  /**
   * "Merge into…": combine two pop-outs into one by moving `sourceId`'s feeds
   * into `targetId`'s window and closing `sourceId`'s — an explicit in-window
   * control, never window-to-window drag (unreliable in Electron), so merging
   * is always a deliberate pick from a menu of the OTHER open pop-outs
   * (decision 2026-07-20; see docs/design/Video.md § Pop-outs and restore).
   *
   * The target renderer read its slice once at bootstrap (see
   * sessionBootstrap.ts's `currentPopoutSlice`), so — same as a relaunch
   * restoring a slice — it is reloaded to pick up the combined feed set; there
   * is no live feed-list patch path in the pop-out renderer today. Returns
   * `false` (no-op, nothing closed or reloaded) if the ids are equal, either
   * pop-out is unknown, or either window already went away (a race with a
   * manual close).
   */
  mergePopout(sourceId: number, targetId: number): boolean {
    if (sourceId === targetId) return false
    const sourceWin = this.windows.get(sourceId)
    const targetWin = this.windows.get(targetId)
    if (!sourceWin || !targetWin || sourceWin.isDestroyed() || targetWin.isDestroyed()) {
      return false
    }

    if (!mergePopouts(sourceId, targetId)) return false

    if (!targetWin.webContents.isDestroyed()) targetWin.webContents.reload()
    this.broadcast()
    // Closing triggers the normal 'closed' handler below, which removes the
    // source's slice (already gone — a harmless no-op) and re-broadcasts.
    sourceWin.close()
    return true
  }

  /** Create the BrowserWindow for a pop-out slice and wire its lifecycle. */
  private spawn(id: number, savedBounds: WindowBoundsState | null): void {
    if (this.windows.has(id)) return

    const resolved = savedBounds ? resolveSavedBounds(savedBounds, `pop-out ${id}`) : null
    const win = new BrowserWindow({
      width: resolved?.bounds.width ?? DEFAULT_POPOUT_WIDTH,
      height: resolved?.bounds.height ?? DEFAULT_POPOUT_HEIGHT,
      ...(resolved ? { x: resolved.bounds.x, y: resolved.bounds.y } : {}),
      show: false,
      backgroundColor: '#0b0f14',
      title: `Airshow Video — window ${id}`,
      ...(this.icon ? { icon: this.icon } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        // Same rule as the main window: the pop-out plays video and must not be
        // background-throttled to a crawl when it is on an unfocused monitor.
        backgroundThrottling: false
      }
    })
    this.windows.set(id, win)

    win.on('ready-to-show', () => win.show())

    // Persist the ACTUAL bounds/display (validated, or Electron-placed for a fresh
    // pop-out) so the slice matches reality — including a recenter off a lost monitor.
    patchPopout(id, { bounds: boundsStateFor(win) })
    const disposeTracking = trackWindowBounds(win, (bounds) => patchPopout(id, { bounds }))

    win.on('closed', () => {
      disposeTracking()
      this.windows.delete(id)
      // A user close returns the feeds and forgets the slice; a quit keeps it.
      if (!this.quitting) {
        removePopout(id)
        this.broadcast()
      }
    })

    void this.load(win, id)
  }

  /** Load the pop-out renderer at its `?window=popout&id=N` URL. */
  private async load(win: BrowserWindow, id: number): Promise<void> {
    const url = await this.resolveUrl(`?window=popout&id=${id}`)
    if (win.isDestroyed()) return
    try {
      await win.loadURL(url)
    } catch (err: unknown) {
      console.error(`[popouts] failed to load pop-out ${id} at ${url}:`, err)
    }
  }

  /** Push the current open-pop-out set to every window so the main grid hands feeds off. */
  private broadcast(): void {
    const summaries: PopoutSummary[] = popoutSummaries(getSessionState())
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      win.webContents.send(IpcChannels.windowsPopoutsChanged, summaries)
    }
  }
}
