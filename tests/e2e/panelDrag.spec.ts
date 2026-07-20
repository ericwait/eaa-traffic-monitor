import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// The single pointer-simulation e2e for header drag-to-dock
// (docs/Panel-System-Plan.md § Test plan § panelDrag, PR6
// "feature/panel-drag-dock"): header-drags a video panel onto FR24's LEFT
// half — an INTERNAL split boundary (the audio/weather column borders FR24
// there), not a window edge, so the drop resolves as a panel-edge split
// rather than a root-edge dock — asserts the drop-zone highlight is visible
// with the right `data-zone` during the drag, that FR24 (the native
// WebContentsView) is hidden for the whole drag and reappears at correct
// bounds after, and that Escape cancels a drag mid-gesture without moving
// anything.
//
// Pointer simulation: like tests/e2e/channels.spec.ts's own strip-drag test,
// `page.mouse.*` does not reach this app's POINTER-event listeners in this
// harness, so the gesture is driven with dispatched PointerEvents instead —
// dispatched directly on `.panel-head` (pointerdown, to resolve the dragged
// panel id) and on `.panel-canvas` (move/up/cancel — where
// useHeaderDrag.ts's own handlers actually live), never `page.mouse`. A
// consistent `pointerId` across every dispatched event is what lets this
// app's own drag state machine treat them as one gesture; useHeaderDrag.ts's
// `trySetPointerCapture`/`tryReleasePointerCapture` helpers swallow the
// `InvalidPointerId` a browser can throw for a synthetic (not
// actually-hardware-active) pointer id, which is exactly the case here.
//
// Isolated E2E_USERDATA (same convention as channels.spec.ts/popout.spec.ts/
// layoutProfiles.spec.ts): the drop is a real `session.panelLayout` write.

let app: ElectronApplication
let page: Page
let userDataDir: string

const DRAGGED_FEED = defaultFeeds[0]
const DRAGGED_PANEL_ID = `video:${DRAGGED_FEED.id}`

/** Every `data-panel-id` the default layout renders — used to assert the drag never opens/closes a panel, only repositions one. */
const ALL_PANEL_IDS = ['audio', 'weather', 'fr24', ...defaultFeeds.map((f) => `video:${f.id}`)]

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atm-e2e-paneldrag-'))
  app = await electron.launch({
    args: [mainEntry],
    env: e2eEnv({ E2E_USERDATA: userDataDir })
  })

  // Keep YouTube off the network — irrelevant to this suite's assertions, but
  // consistent with every other spec so a developer machine behaves like CI.
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['*://*.youtube.com/*', '*://*.ytimg.com/*', '*://*.googlevideo.com/*'] },
      (_details, callback) => callback({ cancel: true })
    )
  })

  await app.firstWindow()
  page = await getMainWindow(app)
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

/** The main window's native FR24 `WebContentsView` — the sole child of the top-level `contentView` (see tests/e2e/launch.spec.ts's own attachment test). */
async function fr24NativeVisible(): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win?.contentView.children[0]?.getVisible() ?? false
  })
}

async function fr24NativeBounds(): Promise<{ width: number; height: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const b = win?.contentView.children[0]?.getBounds()
    return { width: b?.width ?? 0, height: b?.height ?? 0 }
  })
}

/** Center point of a locator's own bounding box. */
async function centerOf(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('e2e: element not measurable')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const POINTER_ID = 1

test('header-dragging a video panel onto FR24 previews the drop zone, hides FR24 for the whole drag, and docks on release', async () => {
  const draggedLeaf = page.locator(`.leaf-frame[data-panel-id="${DRAGGED_PANEL_ID}"]`)
  const draggedHead = draggedLeaf.locator('.panel-head').first()
  const fr24Leaf = page.locator('.leaf-frame[data-panel-id="fr24"]')
  const canvas = page.locator('.panel-canvas')

  const fr24BoxBefore = (await fr24Leaf.boundingBox())!
  const start = await centerOf(draggedHead)

  // FR24 starts visible (no overlay, no drag, nothing maximized) and NOT
  // marked hidden on the shell.
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-fr24-hidden', 'true')
  expect(await fr24NativeVisible()).toBe(true)

  // pointerdown on the dragged panel's OWN header — panelIdForHeaderPointerDown
  // (useHeaderDrag.ts) resolves the panel id from this exact target.
  await draggedHead.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: POINTER_ID,
    clientX: start.x,
    clientY: start.y,
    bubbles: true
  })

  // Below the 4px slop: still a plain pointerdown, no drag yet, FR24 untouched.
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-fr24-hidden', 'true')

  // Cross the slop threshold — every subsequent move/up dispatches on
  // `.panel-canvas` itself, where useHeaderDrag's own handlers are wired
  // (PanelCanvas.tsx), not on `page.mouse`/`body` (see this file's header
  // comment).
  await canvas.dispatchEvent('pointermove', {
    pointerId: POINTER_ID,
    clientX: start.x + 12,
    clientY: start.y + 12,
    bubbles: true
  })

  // The drag is now live: FR24 hides IMMEDIATELY (synchronous, per the
  // single-writer sequencing in docs/Panel-System-Plan.md § Store slice).
  await expect(page.locator('.app-shell')).toHaveAttribute('data-fr24-hidden', 'true')
  await expect.poll(() => fr24NativeVisible()).toBe(false)
  await expect(draggedHead).toHaveClass(/panel-head--dragging/)

  // Move roughly halfway toward FR24, then land solidly inside FR24's own
  // LEFT zone (an INTERNAL boundary against the audio/weather column, not a
  // window edge — see this file's header comment for why LEFT was chosen
  // over the plan's illustrative "east").
  const midpoint = {
    x: (start.x + fr24BoxBefore.x + 12) / 2,
    y: (start.y + fr24BoxBefore.y + fr24BoxBefore.height / 2) / 2
  }
  await canvas.dispatchEvent('pointermove', {
    pointerId: POINTER_ID,
    clientX: midpoint.x,
    clientY: midpoint.y,
    bubbles: true
  })

  const dropPoint = { x: fr24BoxBefore.x + 12, y: fr24BoxBefore.y + fr24BoxBefore.height / 2 }
  await canvas.dispatchEvent('pointermove', {
    pointerId: POINTER_ID,
    clientX: dropPoint.x,
    clientY: dropPoint.y,
    bubbles: true
  })

  // The drop-zone highlight is visible over FR24, zoned 'left' — the
  // assertion hook tests/e2e/panelDrag.spec.ts exists to prove (mirrors the
  // plan's `dropzone-highlight[data-zone="east"]` example under this app's
  // own DropZone vocabulary: top/bottom/left/right/center).
  const highlight = page.locator('.dropzone-highlight[data-zone="left"]')
  await expect(highlight).toBeVisible()
  const highlightBox = (await highlight.boundingBox())!
  expect(highlightBox.x).toBeCloseTo(fr24BoxBefore.x, -1)
  expect(highlightBox.width).toBeLessThan(fr24BoxBefore.width * 0.6)

  await expect(page.getByTestId('drag-ghost')).toBeVisible()

  // Release over the drop point — commits in ONE store write (movePanel +
  // dragPanelId = null together, state/store.ts's `commitDrag`).
  await canvas.dispatchEvent('pointerup', {
    pointerId: POINTER_ID,
    clientX: dropPoint.x,
    clientY: dropPoint.y,
    bubbles: true
  })

  await expect(page.locator('.dropzone-highlight')).toHaveCount(0)
  await expect(draggedHead).not.toHaveClass(/panel-head--dragging/)

  // The two-rAF reshow: FR24 becomes visible again shortly after the commit,
  // at freshly-measured (non-zero) bounds — never a stale-bounds flash.
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-fr24-hidden', 'true')
  await expect.poll(() => fr24NativeVisible()).toBe(true)
  const boundsAfter = await fr24NativeBounds()
  expect(boundsAfter.width).toBeGreaterThan(0)
  expect(boundsAfter.height).toBeGreaterThan(0)

  // No panel opened or closed — exactly the same panel set, just reflowed.
  for (const id of ALL_PANEL_IDS) {
    await expect(page.locator(`.leaf-frame[data-panel-id="${id}"]`)).toHaveCount(1)
  }
  await expect(page.locator('.leaf-frame')).toHaveCount(ALL_PANEL_IDS.length)

  // Structure: the dragged panel now occupies FR24's OLD left edge (docked to
  // its left, taking roughly half its old width); FR24 itself shifted right,
  // keeping the same height (the split is horizontal — only x/width change).
  const draggedBoxAfter = (await draggedLeaf.boundingBox())!
  const fr24BoxAfter = (await fr24Leaf.boundingBox())!

  expect(draggedBoxAfter.x).toBeCloseTo(fr24BoxBefore.x, -1)
  expect(draggedBoxAfter.y).toBeCloseTo(fr24BoxBefore.y, -1)
  const widthRatio = draggedBoxAfter.width / fr24BoxBefore.width
  expect(widthRatio).toBeGreaterThan(0.35)
  expect(widthRatio).toBeLessThan(0.65)

  expect(fr24BoxAfter.x).toBeGreaterThan(fr24BoxBefore.x)
  expect(fr24BoxAfter.height).toBeCloseTo(fr24BoxBefore.height, -1)
})

test('Escape cancels a drag mid-gesture — no commit, FR24 reappears, nothing moves', async () => {
  const draggedLeaf = page.locator(`.leaf-frame[data-panel-id="${DRAGGED_PANEL_ID}"]`)
  const draggedHead = draggedLeaf.locator('.panel-head').first()
  const weatherLeaf = page.locator('.leaf-frame[data-panel-id="weather"]')
  const canvas = page.locator('.panel-canvas')

  const draggedBoxBefore = (await draggedLeaf.boundingBox())!
  const weatherBoxBefore = (await weatherLeaf.boundingBox())!
  const start = await centerOf(draggedHead)
  const weatherCenter = await centerOf(weatherLeaf)

  await draggedHead.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: POINTER_ID,
    clientX: start.x,
    clientY: start.y,
    bubbles: true
  })
  await canvas.dispatchEvent('pointermove', {
    pointerId: POINTER_ID,
    clientX: weatherCenter.x,
    clientY: weatherCenter.y,
    bubbles: true
  })

  await expect(page.locator('.app-shell')).toHaveAttribute('data-fr24-hidden', 'true')
  await expect(page.locator('.dropzone-highlight')).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(page.locator('.dropzone-highlight')).toHaveCount(0)
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-fr24-hidden', 'true')
  await expect.poll(() => fr24NativeVisible()).toBe(true)

  // A stray pointerup after Escape must be a no-op (the machine was already
  // cleared) — never a late, accidental commit.
  await canvas.dispatchEvent('pointerup', {
    pointerId: POINTER_ID,
    clientX: weatherCenter.x,
    clientY: weatherCenter.y,
    bubbles: true
  })

  const draggedBoxAfter = (await draggedLeaf.boundingBox())!
  const weatherBoxAfter = (await weatherLeaf.boundingBox())!
  expect(draggedBoxAfter.x).toBeCloseTo(draggedBoxBefore.x, -1)
  expect(draggedBoxAfter.y).toBeCloseTo(draggedBoxBefore.y, -1)
  expect(weatherBoxAfter.x).toBeCloseTo(weatherBoxBefore.x, -1)
  expect(weatherBoxAfter.y).toBeCloseTo(weatherBoxBefore.y, -1)
})
