import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'

// Live-video-grid smoke. Proves the grid tiles every configured feed and that
// double-click emphasis actually changes the store/DOM — WITHOUT depending on
// any YouTube network content. CI is a network-restricted box: the IFrame API
// script cannot load there, so every tile stays in its own loading/offline
// placeholder state. That is fine and expected — this suite makes NO
// assertions about YT.Player internals, actual playback, or the LIVE/OFFLINE
// badge's specific value, only that the identity chrome and layout-mode
// plumbing are present and respond to interaction.
//
// Prerequisite: `electron-vite build` must have run so out/main/index.js and
// out/renderer exist. `just e2e` builds first.

const projectRoot = join(__dirname, '..', '..')
const mainEntry = join(projectRoot, 'out', 'main', 'index.js')

let app: ElectronApplication
let page: Page

// Same window-selection pattern as launch.spec.ts: the app has TWO
// webContents (the main app:// renderer and the FR24 WebContentsView under
// about:blank in e2e), so select the main renderer explicitly rather than
// relying on creation order.
async function getMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const main = electronApp.windows().find((p) => p.url().startsWith('app://'))
    if (main) return main
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('e2e: the main app:// renderer window never appeared')
}

test.beforeAll(async () => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_RENDERER_URL') continue
    if (value !== undefined) env[key] = value
  }
  env.NODE_ENV = 'production'
  // Keep the FR24 view off the network, same as launch.spec.ts — irrelevant to
  // this suite but required for the app to boot deterministically in CI.
  env.FR24_URL_OVERRIDE = 'about:blank'

  app = await electron.launch({ args: [mainEntry], env })
  await app.firstWindow()
  page = await getMainWindow(app)
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('renders one video tile per configured default feed', async () => {
  await expect(page.getByTestId('video-tile')).toHaveCount(defaultFeeds.length)
})

test('every tile shows its feed label and a LIVE/OFFLINE badge', async () => {
  for (const feed of defaultFeeds) {
    const tile = page.locator(`[data-testid="video-tile"][data-feed-id="${feed.id}"]`)
    await expect(tile).toBeVisible()
    await expect(tile.getByTestId('video-tile-overlay')).toContainText(feed.label)
    await expect(tile.getByTestId('video-tile-badge')).toHaveText(/LIVE|OFFLINE/)
  }
})

test('the grid starts in uniform layout mode', async () => {
  await expect(page.getByTestId('video-grid')).toHaveAttribute('data-layout-mode', 'uniform')
})

test('double-clicking a tile flips the grid into emphasized layout mode', async () => {
  const firstTile = page.getByTestId('video-tile').first()
  await firstTile.dblclick()
  await expect(page.getByTestId('video-grid')).toHaveAttribute('data-layout-mode', 'emphasized')
  await expect(firstTile).toHaveClass(/video-tile--emphasized/)
})

test('double-clicking the same (now-emphasized) tile fills the whole panel with it', async () => {
  // Per the phase brief: double-click on an already-emphasized tile is the
  // secondary path to "fill panel" (the primary path is the explicit
  // fill-panel button in the hover cluster).
  const firstTile = page.getByTestId('video-tile').first()
  await firstTile.dblclick()
  await expect(page.getByTestId('video-grid')).toHaveAttribute('data-layout-mode', 'fill')
  await expect(page.getByTestId('video-tile')).toHaveCount(1) // only the filled feed renders
  await expect(page.getByTestId('video-tile')).toHaveClass(/video-tile--filled/)
})

test('Escape exits fill-panel mode back to the grid (still emphasized, not reset to uniform)', async () => {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('video-grid')).toHaveAttribute('data-layout-mode', 'emphasized')
  await expect(page.getByTestId('video-tile')).toHaveCount(defaultFeeds.length)
})

test('the explicit demote button returns an emphasized tile to uniform mode', async () => {
  // The reliable, gesture-independent path back to uniform — double-click
  // alone cannot demote (it fills the panel instead once already emphasized;
  // see above), and a real live iframe can swallow a double-click entirely,
  // so this button is the guaranteed control (see VideoTile.tsx).
  const emphasizedTile = page.locator('.video-tile--emphasized')
  await emphasizedTile.hover()
  await emphasizedTile.getByRole('button', { name: /^Demote/ }).click()
  await expect(page.getByTestId('video-grid')).toHaveAttribute('data-layout-mode', 'uniform')
})
