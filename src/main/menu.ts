import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { LayoutCommand, LayoutMenuSyncPayload } from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'

// The native application menu — the FR24-safe surface for a "Move/reopen a
// panel" affordance that must sit above the FR24 WebContentsView, which
// paints above all DOM (CLAUDE.md gotcha). Two menus land in PR4:
//   - Panels: a checkbox per panel id (audio, weather, fr24, each `video:`
//     feed), toggling it open/closed in the renderer's canvas.
//   - Layout: "Reset to Default Layout" for now; the snap-manager launcher and
//     named-profile radios (`feature/layout-snaps`) extend this menu later —
//     see the placeholder comment below.
//
// (decision 2026-07-20) Native menus + a DOM Move-panel modal are the
// FR24-safe/accessible move paths landed now; custom pointer-driven
// drag-to-dock (`feature/panel-drag-dock`) is deliberately deferred — see
// docs/Panel-System-Plan.md § Key interactions and docs/decisions/README.md.
//
// This module owns ONLY menu construction + the renderer round trip
// (`layout:menuSync` in, `layout:command` out); it holds no panel-layout
// state of its own — the renderer is the single source of truth and pushes a
// fresh sync on every relevant store change (see
// src/renderer/src/layout/menuBridge.ts).

/** Build the whole application menu from the latest renderer-pushed sync (or `null` before the first one lands). */
export function buildApplicationMenu(
  sync: LayoutMenuSyncPayload | null,
  sendCommand: (command: LayoutCommand) => void
): Menu {
  const panelItems: MenuItemConstructorOptions[] =
    sync && sync.panels.length > 0
      ? sync.panels.map((panel) => ({
          label: panel.id === sync.maximizedPanelId ? `${panel.title} (Maximized)` : panel.title,
          type: 'checkbox',
          checked: panel.open,
          click: () => sendCommand({ type: 'toggle-panel', id: panel.id })
        }))
      : [{ label: 'No panels yet', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    // macOS conventionally leads with the app-identity menu (About/Quit/etc.);
    // omitting it on other platforms matches the existing autoHideMenuBar UX.
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
    { label: 'Panels', submenu: panelItems },
    {
      label: 'Layout',
      submenu: [
        {
          label: 'Reset to Default Layout',
          click: () => sendCommand({ type: 'reset-layout' })
        }
        // PR5 (`feature/layout-snaps`) adds: a "Manage Snaps…" launcher for
        // LayoutManagerModal, a "Save Current as Profile…" item, and
        // CmdOrCtrl+Alt+1..9 radio accelerators for saved profiles — this
        // submenu is the intended landing spot; no manager logic here yet.
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]

  return Menu.buildFromTemplate(template)
}

/** Owns the applied application menu for one main window: rebuilds it on every `layout:menuSync` and forwards clicks back as `layout:command`. */
export interface LayoutMenuController {
  /** Rebuild + (re)apply the application menu from a fresh renderer-pushed sync. */
  handleMenuSync: (payload: LayoutMenuSyncPayload) => void
}

/** Create the controller for `mainWindow` and apply a sensible pre-sync default menu immediately. */
export function createLayoutMenuController(mainWindow: BrowserWindow): LayoutMenuController {
  const sendCommand = (command: LayoutCommand): void => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send(IpcChannels.layoutCommand, command)
  }

  const apply = (sync: LayoutMenuSyncPayload | null): void => {
    Menu.setApplicationMenu(buildApplicationMenu(sync, sendCommand))
  }

  // A sensible default before the renderer's first sync lands (menuBridge
  // sends one on mount, but the menu should never be literally empty in the
  // brief window before that round trip completes).
  apply(null)

  return {
    handleMenuSync: (payload) => apply(payload)
  }
}
