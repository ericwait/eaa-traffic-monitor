import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Pop-out smoke (Phase 4, extended decision 2026-07-20 for pop-out layout
// parity): proves the whole hand-off loop WITHOUT any YouTube network content
// (CI is network-restricted; YT is blocked below so every tile stays in its
// offline placeholder) — opening a pop-out spawns a second grid-only window
// at ?window=popout, moves that feed out of the main grid, renders it on the
// pop-out's OWN panel canvas, and closing the pop-out (or its last leaf)
// returns the feed(s) to the main grid.
//
// (decision 2026-07-20) A pop-out renders the SAME panel canvas
// (PanelCanvas/LeafFrame/Splitter/useHeaderDrag) the main window uses — see
// docs/design/Layout.md's pop-out section and src/renderer/src/PopoutApp.tsx
// — so once two feeds share one pop-out (via "Merge into…", since a single
// "pop out" always starts a lone feed in its own window), that window's
// panels split/resize/drag-dock/maximize exactly like the main window's, and
// the id-sorted-DOM-order/never-remount invariant (docs/Panel-System-Plan.md)
// must hold there too — proven below with a live `elementHandle`.
//
// Isolated E2E_USERDATA (same convention as channels.spec.ts/panels.spec.ts/
// layoutProfiles.spec.ts): every pop-out open/merge/drag/close writes
// session.json, and the operator's real profile must never be the test bench.
//
// Prerequisite: `electron-vite build` must have run so out/ exists. `just e2e`
// builds first. FR24 is pinned to about:blank by e2eEnv (never touches the
// network / flightradar24.com).

let app: ElectronApplication
let main: Page
let userDataDir: string

/** The feed the first, single-feed hand-off section pops out. */
const POPPED = defaultFeeds[0]
/** The two feeds combined into one multi-feed pop-out for the canvas-reorg/maximize/stream-survival section below. */
const FEED_A = defaultFeeds[1]
const FEED_B = defaultFeeds[2]

const POINTER_ID = 1

/** Resolve the pop-out window by its `?window=popout` URL, polling until it loads. */
async function getPopoutWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const popout = electronApp.windows().find((p) => p.url().includes('window=popout'))
    if (popout) return popout
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('e2e: the pop-out window (?window=popout) never appeared')
}

/** Resolve at least `count` pop-out windows, polling until they all appear. */
async function getPopoutWindows(electronApp: ElectronApplication, count: number): Promise<Page[]> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const popouts = electronApp.windows().filter((p) => p.url().includes('window=popout'))
    if (popouts.length >= count) return popouts
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`e2e: fewer than ${count} pop-out windows appeared`)
}

/** Center point of a locator's own bounding box. */
async function centerOf(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('e2e: element not measurable')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Header-drag the panel `panelId` (within `page`'s own canvas) to `dropPoint`
 * (viewport coordinates) via dispatched PointerEvents — same technique as
 * tests/e2e/panelDrag.spec.ts: `page.mouse.*` does not reach this app's
 * POINTER-event listeners in this harness (see that file's header comment),
 * so the gesture is driven with a consistent `pointerId` across pointerdown
 * (on the panel's own `.panel-head`, to resolve the dragged id) and
 * move/up (on `.panel-canvas`, where useHeaderDrag.ts's handlers live).
 *
 * Deliberately only TWO moves (cross the slop, then jump straight to
 * `dropPoint`) rather than an intermediate "midpoint" step: dropZones.ts's
 * hysteresis (`withHysteresis`) sticks to whatever the FIRST post-slop
 * hit-test resolved to (typically the dragged panel's own rect, since the
 * pointer has barely moved from its own header) as long as a later point
 * stays within that resolution's highlight rect grown by 8px — an
 * intermediate move between two adjacent panels can land back inside that
 * margin and mask a real target change. `dropPoint` must therefore be picked
 * far enough (well beyond 8px) from the dragged panel's own rect that the
 * final hit-test is unambiguous — see this file's callers for how each
 * `dropPoint` is chosen.
 */
async function dragPanelTo(
  page: Page,
  panelId: string,
  dropPoint: { x: number; y: number }
): Promise<void> {
  const head = page.locator(`.leaf-frame[data-panel-id="${panelId}"] .panel-head`).first()
  const canvas = page.locator('.panel-canvas')
  const start = await centerOf(head)

  await head.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: POINTER_ID,
    clientX: start.x,
    clientY: start.y,
    bubbles: true
  })
  // Cross the 4px slop before the gesture becomes a real drag.
  await canvas.dispatchEvent('pointermove', {
    pointerId: POINTER_ID,
    clientX: start.x + 12,
    clientY: start.y + 12,
    bubbles: true
  })
  await canvas.dispatchEvent('pointermove', {
    pointerId: POINTER_ID,
    clientX: dropPoint.x,
    clientY: dropPoint.y,
    bubbles: true
  })
  await canvas.dispatchEvent('pointerup', {
    pointerId: POINTER_ID,
    clientX: dropPoint.x,
    clientY: dropPoint.y,
    bubbles: true
  })
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atm-e2e-popout-'))
  app = await electron.launch({
    args: [mainEntry],
    env: e2eEnv({ E2E_USERDATA: userDataDir })
  })

  // Keep YouTube off the network so every tile stays in its offline placeholder
  // state (see video.spec.ts) — the pop-out plumbing is what this suite tests.
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['*://*.youtube.com/*', '*://*.ytimg.com/*', '*://*.googlevideo.com/*'] },
      (_details, callback) => callback({ cancel: true })
    )
  })

  await app.firstWindow()
  main = await getMainWindow(app)
  await main.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('the main grid starts with one tile per configured feed', async () => {
  await expect(main.getByTestId('video-tile')).toHaveCount(defaultFeeds.length)
})

test('popping out a feed spawns a window rendering just that feed on its own panel canvas', async () => {
  // The pop-out button lives on the panel's own header now (always visible,
  // not hover-gated) — see layout/PanelChromeButtons.tsx — rather than the
  // video tile's hover cluster: VideoLeafBody's video body no longer wires
  // VideoTile's own onPopOut prop, to avoid a second, redundant affordance.
  await main
    .locator(`.leaf-frame[data-panel-id="video:${POPPED.id}"]`)
    .getByTestId(`leaf-popout-video:${POPPED.id}`)
    .click()

  const popout = await getPopoutWindow(app)
  await popout.waitForLoadState('domcontentloaded')

  // The pop-out renders only the popped feed, on its OWN panel canvas
  // (decision 2026-07-20) — the same `.leaf-frame`/`.panel-canvas` shape the
  // main window uses, not the old CSS-grid `.video-grid` — and has no ATC panel.
  await expect(popout.getByTestId('popout-canvas')).toBeVisible()
  await expect(popout.locator('.panel-canvas')).toBeVisible()
  await expect(popout.locator(`.leaf-frame[data-panel-id="video:${POPPED.id}"]`)).toBeVisible()
  await expect(popout.getByTestId('video-tile')).toHaveCount(1)
  await expect(
    popout.locator(`[data-testid="video-tile"][data-feed-id="${POPPED.id}"]`)
  ).toBeVisible()
  await expect(popout.getByRole('heading', { name: 'ATC Audio' })).toHaveCount(0)
})

test('the popped-out feed is handed off — removed from the main grid', async () => {
  await expect(main.getByTestId('video-tile')).toHaveCount(defaultFeeds.length - 1)
  await expect(main.locator(`[data-testid="video-tile"][data-feed-id="${POPPED.id}"]`)).toHaveCount(
    0
  )
})

test('exactly two windows are open (main + one pop-out)', async () => {
  const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  expect(count).toBe(2)
})

test('closing the pop-out returns its feed to the main grid', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('window=popout')
    )
    win?.close()
  })

  await expect(main.getByTestId('video-tile')).toHaveCount(defaultFeeds.length)
  await expect(
    main.locator(`[data-testid="video-tile"][data-feed-id="${POPPED.id}"]`)
  ).toBeVisible()
})

test('the returned feed lands in the bottom row of the video region, never the left column (Fix C, src/shared/panelLayout.ts insertVideoLeafBottom)', async () => {
  const audioBox = await main.locator('.leaf-frame[data-panel-id="audio"]').boundingBox()
  const poppedBox = await main
    .locator(`.leaf-frame[data-panel-id="video:${POPPED.id}"]`)
    .boundingBox()
  const otherVideoBoxes = await Promise.all(
    defaultFeeds
      .filter((f) => f.id !== POPPED.id)
      .map((f) => main.locator(`.leaf-frame[data-panel-id="video:${f.id}"]`).boundingBox())
  )

  expect(audioBox).toBeTruthy()
  expect(poppedBox).toBeTruthy()
  for (const box of otherVideoBoxes) expect(box).toBeTruthy()

  // Never the left column: the returned tile sits in the right-hand video
  // region, to the right of the audio panel's own column.
  expect(poppedBox!.x).toBeGreaterThanOrEqual(audioBox!.x + audioBox!.width - 1)

  // Bottom row: its top (y) is at least as far down as every other video
  // tile's — i.e. no other video tile is in a row below it.
  const maxOtherY = Math.max(...otherVideoBoxes.map((b) => b!.y))
  expect(poppedBox!.y).toBeGreaterThanOrEqual(maxOtherY - 1)
})

// "Merge into…" (decision 2026-07-20; see docs/design/Video.md § Pop-outs and
// restore): combining two separate pop-outs into one multi-feed window
// through the explicit control, not window-to-window drag. Two DIFFERENT
// feeds from the earlier tests (POPPED already returned to the main grid by
// this point) so this suite starts from a clean, known main-grid state. Once
// merged, the SAME window hosts both feeds on ONE panel canvas — this is
// where pop-out layout parity (reorg/resize/maximize/stream-survival) is
// actually exercised, since a lone "pop out" always starts with a single
// leaf and nothing to reorganize.
test.describe('merging two pop-outs into one multi-feed panel canvas', () => {
  let target: Page
  let source: Page

  test('popping out two different feeds spawns two separate windows; alone, merge is disabled', async () => {
    await main
      .locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
      .getByTestId(`leaf-popout-video:${FEED_A.id}`)
      .click()

    const [popoutA] = await getPopoutWindows(app, 1)
    await popoutA.waitForLoadState('domcontentloaded')

    // Alone, the control is disabled and says so.
    await expect(popoutA.getByTestId('merge-into-select')).toBeDisabled()
    await expect(popoutA.locator('[data-testid="merge-into-select"] option[value=""]')).toHaveText(
      'No other windows'
    )

    await main
      .locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
      .getByTestId(`leaf-popout-video:${FEED_B.id}`)
      .click()

    const popouts = await getPopoutWindows(app, 2)
    for (const p of popouts) await p.waitForLoadState('domcontentloaded')
    expect(popouts).toHaveLength(2)

    // The FIRST pop-out's control re-enables once a second one exists (the
    // live windows:popoutsChanged broadcast, not just the bootstrap snapshot)
    // and lists it by its feed label.
    await expect(popoutA.getByTestId('merge-into-select')).toBeEnabled()
    await expect(
      popoutA.locator('[data-testid="merge-into-select"] option', { hasText: FEED_B.label })
    ).toHaveCount(1)
  })

  test('picking a target moves the source feed into it, closes the source window, and both feeds render on the target canvas', async () => {
    const popouts = await getPopoutWindows(app, 2)
    const flags = await Promise.all(
      popouts.map(
        async (p) =>
          (await p.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`).count()) > 0
      )
    )
    source = popouts[flags.indexOf(true)]
    target = popouts[flags.indexOf(false)]
    expect(source).toBeTruthy()
    expect(target).toBeTruthy()

    await source.getByTestId('merge-into-select').selectOption({ label: FEED_B.label })

    // Exactly one pop-out remains (main + it) — the source window closed.
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(2)

    // The target's renderer reloaded to pick up the merged slice (see
    // src/main/popouts.ts's mergePopout) — both feeds now render as their
    // own `.leaf-frame` on ONE panel canvas, not a grid.
    await target.waitForLoadState('domcontentloaded')
    await expect(target.locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)).toBeVisible()
    await expect(target.locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)).toBeVisible()
    await expect(target.locator('.leaf-frame')).toHaveCount(2)
  })

  test('the main grid is unaffected — neither merged feed returns to it', async () => {
    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
    ).toHaveCount(0)
    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_B.id}"]`)
    ).toHaveCount(0)
  })

  test('a pop-out leaf shows only fit/maximize/close chrome — no "Move panel…" (main-window-only by decision)', async () => {
    const leaf = target.locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
    await expect(leaf.getByTestId(`leaf-fit-video:${FEED_A.id}`)).toBeVisible()
    await expect(leaf.getByTestId(`leaf-maximize-video:${FEED_A.id}`)).toBeVisible()
    await expect(leaf.getByTestId(`leaf-close-video:${FEED_A.id}`)).toBeVisible()
    await expect(leaf.getByTestId(`leaf-move-video:${FEED_A.id}`)).toHaveCount(0)
  })

  test("dragging a panel to the window's right edge docks it as a new side-by-side column (row layout)", async () => {
    // Stream-survival proxy captured here, BEFORE any reorganize below, and
    // checked again after — the load-bearing proof that header-drag never
    // remounts a tile (docs/Panel-System-Plan.md's LOAD-BEARING INVARIANT,
    // which must hold in a pop-out's canvas exactly as it does in the main
    // window's).
    const videoTileHandle = await target
      .locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
      .elementHandle()
    expect(videoTileHandle).not.toBeNull()

    const canvasBox = (await target.locator('.panel-canvas').boundingBox())!
    const leafABoxBefore = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
      .boundingBox())!
    const leafBBoxBefore = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
      .boundingBox())!

    // The default balanced-grid tree for exactly 2 video feeds stacks them
    // (one row each) — confirm that starting shape before changing it, so
    // the transformation below is a real, observable change.
    expect(leafABoxBefore.x).toBeCloseTo(leafBBoxBefore.x, 0)
    expect(leafABoxBefore.width).toBeCloseTo(leafBBoxBefore.width, 0)

    // Drag FEED_B's header to within the canvas's own right-edge margin
    // (docs/Panel-System-Plan.md: dragging to a window edge docks a new
    // full-height column) — an INTENTIONAL root-edge dock, not a panel-edge
    // split, since with only 2 leaves both stacked panels span the canvas's
    // full width, so any point near a panel's own left/right edge is
    // indistinguishable from the canvas's own outer edge. The y coordinate
    // is chosen deep inside FEED_A's (the OTHER leaf's) own territory —
    // comfortably more than the 8px hysteresis margin away from FEED_B's own
    // rect — so `withHysteresis` (dropZones.ts) doesn't stick to FEED_B's
    // own self-hit (the first post-slop hit-test, taken barely away from
    // FEED_B's own header, near-certainly resolves inside FEED_B's own
    // rect) instead of re-resolving fresh at the drop point; see
    // dragPanelTo's own doc comment.
    const rightEdgeDrop = {
      x: canvasBox.x + canvasBox.width - 12,
      y: canvasBox.y + canvasBox.height * 0.85
    }
    await dragPanelTo(target, `video:${FEED_B.id}`, rightEdgeDrop)

    const leafABoxAfter = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
      .boundingBox())!
    const leafBBoxAfter = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
      .boundingBox())!

    // Side by side now: same y/height, B sits to the right of A.
    expect(leafABoxAfter.y).toBeCloseTo(leafBBoxAfter.y, 0)
    expect(leafABoxAfter.height).toBeCloseTo(leafBBoxAfter.height, 0)
    expect(leafBBoxAfter.x).toBeGreaterThanOrEqual(leafABoxAfter.x + leafABoxAfter.width - 1)

    // Still exactly these two leaves — a reorg repositions, never opens/closes a panel.
    await expect(target.locator('.leaf-frame')).toHaveCount(2)

    // Stream-survival, part 1: still connected after this first reorganize.
    expect(await videoTileHandle!.evaluate((el) => el.isConnected)).toBe(true)
  })

  test("dragging that same panel to the window's bottom edge docks it BELOW the other — a vertical (column) split", async () => {
    const canvasBox = (await target.locator('.panel-canvas').boundingBox())!

    // FEED_B now occupies the right-hand column (the previous test's
    // result) — the x coordinate is chosen deep inside FEED_A's (the left
    // column's) own territory, comfortably away from FEED_B's own rect, for
    // the same hysteresis-escaping reason as the right-edge drop above.
    const bottomEdgeDrop = {
      x: canvasBox.x + canvasBox.width * 0.3,
      y: canvasBox.y + canvasBox.height - 12
    }
    await dragPanelTo(target, `video:${FEED_B.id}`, bottomEdgeDrop)

    const leafABoxAfter = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
      .boundingBox())!
    const leafBBoxAfter = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
      .boundingBox())!

    // Vertical (column) split now: same x/width, B sits BELOW A.
    expect(leafABoxAfter.x).toBeCloseTo(leafBBoxAfter.x, 0)
    expect(leafABoxAfter.width).toBeCloseTo(leafBBoxAfter.width, 0)
    expect(leafBBoxAfter.y).toBeGreaterThanOrEqual(leafABoxAfter.y + leafABoxAfter.height - 1)

    await expect(target.locator('.leaf-frame')).toHaveCount(2)

    // Stream-survival, part 2: still connected after the second reorganize.
    const videoTileHandle = await target
      .locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
      .elementHandle()
    expect(await videoTileHandle!.evaluate((el) => el.isConnected)).toBe(true)
  })

  test('resizing via the splitter (keyboard, role="separator") grows one panel and shrinks the other', async () => {
    const splitter = target.locator('.splitter')
    await expect(splitter).toHaveCount(1)
    await expect(splitter).toHaveAttribute('aria-orientation', 'horizontal') // a horizontal BAR divides the now-vertically-stacked panels

    const leafABoxBefore = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
      .boundingBox())!
    const leafBBoxBefore = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
      .boundingBox())!

    for (let i = 0; i < 5; i++) await splitter.press('ArrowDown')

    const leafABoxAfter = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
      .boundingBox())!
    const leafBBoxAfter = (await target
      .locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
      .boundingBox())!

    // ArrowDown grows the TOP panel (A) and shrinks the BOTTOM one (B) —
    // layout/Splitter.tsx's applyDelta, same op the main window uses.
    expect(leafABoxAfter.height).toBeGreaterThan(leafABoxBefore.height)
    expect(leafBBoxAfter.height).toBeLessThan(leafBBoxBefore.height)
    // The combined height (minus the splitter's own thickness) is conserved.
    expect(leafABoxAfter.height + leafBBoxAfter.height).toBeCloseTo(
      leafABoxBefore.height + leafBBoxBefore.height,
      0
    )
  })

  test('maximizing a panel hides the other (still mounted) and Escape restores', async () => {
    const leafA = target.locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
    const leafB = target.locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)

    await leafA.getByTestId(`leaf-maximize-video:${FEED_A.id}`).click()
    await expect(leafA).toHaveAttribute('data-maximized', 'true')
    await expect(leafB).toBeHidden() // visibility:hidden, per LOAD-BEARING INVARIANT #4
    await expect(leafB).toHaveCount(1) // still in the DOM — not unmounted

    await target.keyboard.press('Escape')
    await expect(leafA).not.toHaveAttribute('data-maximized', 'true')
    await expect(leafB).toBeVisible()

    // Stream-survival, part 3: maximize/restore is a visibility toggle, never a remount.
    const videoTileHandle = await target
      .locator(`[data-testid="video-tile"][data-feed-id="${FEED_B.id}"]`)
      .elementHandle()
    expect(await videoTileHandle!.evaluate((el) => el.isConnected)).toBe(true)
  })

  test('closing ONE leaf in a multi-feed pop-out returns just that feed to the main grid — the window stays open', async () => {
    const leafB = target.locator(`.leaf-frame[data-panel-id="video:${FEED_B.id}"]`)
    await leafB.getByTestId(`leaf-close-video:${FEED_B.id}`).click()

    await expect(leafB).toHaveCount(0)
    await expect(target.locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)).toBeVisible()
    await expect(target.locator('.leaf-frame')).toHaveCount(1)

    // Still two windows — the pop-out did NOT close, only one of its leaves did.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)

    // FEED_B is back on the main grid; FEED_A (the pop-out's remaining feed) is still not there.
    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_B.id}"]`)
    ).toBeVisible()
    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
    ).toHaveCount(0)
  })

  test('closing the LAST leaf closes the whole pop-out window — its feed also returns to the main grid', async () => {
    const leafA = target.locator(`.leaf-frame[data-panel-id="video:${FEED_A.id}"]`)
    await leafA.getByTestId(`leaf-close-video:${FEED_A.id}`).click()

    // Back to just the main window.
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1)

    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
    ).toBeVisible()
  })
})
