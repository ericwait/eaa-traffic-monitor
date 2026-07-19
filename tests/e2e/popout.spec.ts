import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Pop-out smoke (Phase 4). Proves the whole hand-off loop WITHOUT any YouTube
// network content (CI is network-restricted; YT is blocked below so every tile
// stays in its offline placeholder): opening a pop-out spawns a second grid-only
// window at ?window=popout, moves that feed out of the main grid, renders it in
// the pop-out, and closing the pop-out returns the feed to the main grid.
//
// Prerequisite: `electron-vite build` must have run so out/ exists. `just e2e`
// builds first. FR24 is pinned to about:blank by e2eEnv (never touches the
// network / flightradar24.com).

let app: ElectronApplication
let main: Page

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

test.beforeAll(async () => {
  app = await electron.launch({ args: [mainEntry], env: e2eEnv() })

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
})

test('the main grid starts with one tile per configured feed', async () => {
  await expect(main.getByTestId('video-tile')).toHaveCount(defaultFeeds.length)
})

test('popping out a feed spawns a grid-only pop-out window rendering just that feed', async () => {
  const tile = main.locator(`[data-testid="video-tile"][data-feed-id="${POPPED.id}"]`)
  await tile.hover()
  await tile.getByRole('button', { name: `Pop out ${POPPED.label}` }).click()

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
