import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { LayoutCommand, LayoutMenuSyncPayload } from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'

// The native application menu — the FR24-safe surface for a "Move/reopen a
// panel" affordance that must sit above the FR24 WebContentsView, which
// paints above all DOM (CLAUDE.md gotcha). Two menus land in PR4:
//   - Panels: a checkbox per panel id (audio, weather, fr24, each `video:`
//     feed), toggling it open/closed in the renderer's canvas.
//   - Layout: "Reset to Default Layout", plus (PR5, `feature/layout-snaps`) a
//     "Main Window Layout…" launcher for LayoutManagerModal (the template
//     gallery + named-profile CRUD dialog — retitled in the
//     panel-canvas-decouple effort to make clear it governs the MAIN window
//     only) and one radio item per saved profile, the first nine carrying
//     `CmdOrCtrl+Alt+1..9` accelerators.
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

/** How many saved profiles get a `CmdOrCtrl+Alt+N` accelerator — Electron/OS menu accelerators only have single digits to spare, and the plan caps it at 1..9 (docs/Panel-System-Plan.md § File inventory). Any profile beyond this still gets its own (unaccelerated) radio item. */
const ACCELERATED_PROFILE_COUNT = 9

/** One profile's `CmdOrCtrl+Alt+N` radio item (index 0-based; N = index + 1), or a plain radio with no accelerator past the ninth. */
function profileMenuItem(
  name: string,
  index: number,
  activeProfileName: string | null,
  sendCommand: (command: LayoutCommand) => void
): MenuItemConstructorOptions {
  return {
    label: name,
    type: 'radio',
    checked: name === activeProfileName,
    ...(index < ACCELERATED_PROFILE_COUNT ? { accelerator: `CmdOrCtrl+Alt+${index + 1}` } : {}),
    click: () => sendCommand({ type: 'apply-profile', index })
  }
}

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

  const profileItems: MenuItemConstructorOptions[] =
    sync && sync.profiles.length > 0
      ? [
          { type: 'separator' },
          ...sync.profiles.map((name, index) =>
            profileMenuItem(name, index, sync.activeProfileName, sendCommand)
          )
        ]
      : []

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
        },
        { type: 'separator' },
        {
          label: 'Main Window Layout…',
          click: () => sendCommand({ type: 'open-layout-manager' })
        },
        ...profileItems
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
