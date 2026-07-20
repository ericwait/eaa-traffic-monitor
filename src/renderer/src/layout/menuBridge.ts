import type { LayoutCommand, LayoutMenuSyncPayload } from '@shared/ipc'
import { buildDefaultTree, collectLeafIds, type PanelId } from '@shared/panelLayout'
import { defaultFeeds } from '../youtube/defaultFeeds'
import { useAppStore } from '../state/store'
import { panelTitle } from './panelMeta'

// Bridges the panel-layout store to the native application menu (PR4 of the
// panel-system effort — src/main/menu.ts). The renderer stays the single
// source of truth for panel state: this module only PUSHES a fresh
// `layout:menuSync` payload on every relevant store change and APPLIES the
// `layout:command`s the menu forwards back (a checkbox toggle, "Reset to
// Default Layout"). Native menus paint above the FR24 WebContentsView
// (CLAUDE.md gotcha) — see docs/Panel-System-Plan.md § File inventory.

/** The fixed non-video panel universe. Video ids are derived from `defaultFeeds`, filtered against `excludedFeedIds` (feeds an open pop-out currently owns — see hydratePanelLayout's identical prune reasoning). */
const FIXED_PANEL_IDS: readonly PanelId[] = ['audio', 'weather', 'fr24']

/**
 * Derive the `layout:menuSync` payload from live inputs: every panel the
 * operator could toggle (the three fixed panels, plus each `defaultFeeds`
 * video feed not currently claimed by an open pop-out), each with its
 * open/closed state (whether its id is a leaf in the current tree) and a
 * human title (see layout/panelMeta.ts), plus the maximized panel (if any).
 * Pure — no Electron/DOM/store reads — so it is directly vitest-importable
 * (tests/unit/menuBridge.test.ts is its guardian).
 */
export function buildMenuSyncPayload(
  openLeafIds: readonly PanelId[],
  maximizedPanelId: PanelId | null,
  excludedFeedIds: ReadonlySet<string> = new Set()
): LayoutMenuSyncPayload {
  const openSet = new Set(openLeafIds)
  const videoIds: PanelId[] = defaultFeeds
    .map((f) => f.id)
    .filter((id) => !excludedFeedIds.has(id))
    .map((id) => `video:${id}` as PanelId)

  const panels = [...FIXED_PANEL_IDS, ...videoIds].map((id) => ({
    id,
    title: panelTitle(id),
    open: openSet.has(id)
  }))

  return { panels, maximizedPanelId }
}

/** Push one fresh sync from the store's current state. */
function pushSync(): void {
  const state = useAppStore.getState()
  const payload = buildMenuSyncPayload(
    collectLeafIds(state.panelTree),
    state.maximizedPanelId,
    new Set(state.poppedOutFeedIds)
  )
  window.api.layout.syncMenu(payload)
}

/** Apply one native-menu command onto the store. */
function applyCommand(command: LayoutCommand): void {
  const state = useAppStore.getState()

  if (command.type === 'toggle-panel') {
    const isOpen = collectLeafIds(state.panelTree).includes(command.id)
    if (isOpen) state.closePanel(command.id)
    else state.openPanel({ type: 'leaf', id: command.id })
    return
  }

  // 'reset-layout': rebuild the first-run tree over whatever feeds this
  // window currently owns (excluding any popped out), and clear a stale
  // maximize — `toggleMaximize` on the CURRENTLY maximized id clears it
  // (maximizing an already-maximized id restores; see store.ts), so this
  // never needs to know or guess which panel to un-maximize.
  const excluded = new Set(state.poppedOutFeedIds)
  const feedIds = defaultFeeds.map((f) => f.id).filter((id) => !excluded.has(id))
  state.applyTree(buildDefaultTree(feedIds))
  if (state.maximizedPanelId !== null) state.toggleMaximize(state.maximizedPanelId)
}

/**
 * Wire the store <-> native menu round trip for the life of the window: an
 * initial sync, a fresh sync on every panelTree/maximize/pop-out-claim
 * change, and command handling for menu clicks. Call once from the app's
 * bootstrap (main.tsx). Returns an unsubscribe for symmetry with the rest of
 * the bootstrap wiring, though nothing tears this down during the app's life.
 */
export function startMenuBridge(): () => void {
  pushSync()

  const unsubscribeStore = useAppStore.subscribe((state, prevState) => {
    if (
      state.panelTree === prevState.panelTree &&
      state.maximizedPanelId === prevState.maximizedPanelId &&
      state.poppedOutFeedIds === prevState.poppedOutFeedIds
    ) {
      return
    }
    pushSync()
  })

  const unsubscribeCommands = window.api.layout.onCommand(applyCommand)

  return () => {
    unsubscribeStore()
    unsubscribeCommands()
  }
}
