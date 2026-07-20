import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Pop-out smoke (Phase 4). Proves the whole hand-off loop WITHOUT any YouTube
// network content (CI is network-restricted; YT is blocked below so every tile
// stays in its offline placeholder): opening a pop-out spawns a second grid-only
// window at ?window=popout, moves that feed out of the main grid, renders it in
// the pop-out, and closing the pop-out returns the feed to the main grid.
//
// The merge suite below (decision 2026-07-20) launches with E2E_USERDATA
// pointing at a throwaway directory — same as channels.spec.ts — because
// session.json persists constantly (every pop-out open/merge/close writes it)
// and the operator's real profile must never be the test bench.
//
// Prerequisite: `electron-vite build` must have run so out/ exists. `just e2e`
// builds first. FR24 is pinned to about:blank by e2eEnv (never touches the
// network / flightradar24.com).

let app: ElectronApplication
let main: Page
let userDataDir: string

/** The feed the test pops out — the first tile in the grid. */
const POPPED = defaultFeeds[0]

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

test('popping out a feed spawns a grid-only pop-out window rendering just that feed', async () => {
  // The pop-out button lives on the panel's own header now (always visible,
  // not hover-gated) — see layout/PanelChromeButtons.tsx — rather than the
  // video tile's hover cluster: LeafFrame's video body no longer wires
  // VideoTile's own onPopOut prop, to avoid a second, redundant affordance.
  await main
    .locator(`.leaf-frame[data-panel-id="video:${POPPED.id}"]`)
    .getByTestId(`leaf-popout-video:${POPPED.id}`)
    .click()

  const popout = await getPopoutWindow(app)
  await popout.waitForLoadState('domcontentloaded')

  // The pop-out renders only the popped feed, and has no ATC panel.
  await expect(popout.getByTestId('popout-grid')).toBeVisible()
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

test('the returned feed lands in the bottom row of the video grid, never the left column (Fix C, src/shared/panelLayout.ts insertVideoLeafBottom)', async () => {
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
// this point) so this suite starts from a clean, known main-grid state.
test.describe('merging two pop-outs ("Merge into…")', () => {
  const FEED_A = defaultFeeds[1]
  const FEED_B = defaultFeeds[2]

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

  test('picking a target moves the source feed into it and closes the source window', async () => {
    const popouts = await getPopoutWindows(app, 2)
    const flags = await Promise.all(
      popouts.map(
        async (p) =>
          (await p.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`).count()) > 0
      )
    )
    const source = popouts[flags.indexOf(true)]
    const target = popouts[flags.indexOf(false)]
    expect(source).toBeTruthy()
    expect(target).toBeTruthy()

    await source.getByTestId('merge-into-select').selectOption({ label: FEED_B.label })

    // Exactly one pop-out remains (main + it) — the source window closed.
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(2)

    // The target re-grids to show BOTH feeds (its renderer reloaded to pick
    // up the merged slice — see src/main/popouts.ts's mergePopout).
    await expect(target.getByTestId('video-tile')).toHaveCount(2)
    await expect(
      target.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
    ).toBeVisible()
    await expect(
      target.locator(`[data-testid="video-tile"][data-feed-id="${FEED_B.id}"]`)
    ).toBeVisible()
  })

  test('the main grid is unaffected — neither merged feed returns to it', async () => {
    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_A.id}"]`)
    ).toHaveCount(0)
    await expect(
      main.locator(`[data-testid="video-tile"][data-feed-id="${FEED_B.id}"]`)
    ).toHaveCount(0)
  })
})
