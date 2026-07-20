import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Live-video smoke, rewritten for per-feed panels (docs/Panel-System-Plan.md):
// the main window no longer has a single grid with uniform/emphasized/fill
// modes — each feed is its own panel on the canvas (layout/LeafFrame.tsx).
// Proves the per-tile identity chrome renders and that each feed is a
// first-class, independently addressable panel — WITHOUT depending on any
// YouTube network content. CI is a network-restricted box: the IFrame API
// script cannot load there, so every tile stays in its own loading/offline
// placeholder state. That is fine and expected — this suite makes NO
// assertions about YT.Player internals, actual playback, or the LIVE/OFFLINE
// badge's specific value, only that the identity chrome and per-panel
// plumbing are present.
//
// Prerequisite: `electron-vite build` must have run so out/main/index.js and
// out/renderer exist. `just e2e` builds first.

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({ args: [mainEntry], env: e2eEnv() })

  // Keep YouTube off the network so every tile stays in its offline placeholder
  // state, deterministically, on a developer machine too (see audio.spec.ts's
  // sibling comment in the pre-rewrite version of this file for the full
  // rationale — unchanged by the panel-canvas work).
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

test('every feed is its own panel, addressable by its video: panel id', async () => {
  for (const feed of defaultFeeds) {
    const leaf = page.locator(`.leaf-frame[data-panel-id="video:${feed.id}"]`)
    await expect(leaf).toHaveCount(1)
    await expect(leaf.getByTestId('video-tile')).toHaveAttribute('data-feed-id', feed.id)
  }
})

test('the fit toggle defaults every tile to fit mode', async () => {
  for (const feed of defaultFeeds) {
    const tile = page.locator(`[data-testid="video-tile"][data-feed-id="${feed.id}"]`)
    await expect(tile).toHaveAttribute('data-fit-mode', 'fit')
  }
})

test('the main window has no emphasize/fill controls — those are pop-out-grid-only', async () => {
  // Superseded by per-panel maximize (decision 2026-07-19); see panels.spec.ts.
  await expect(page.locator('.video-tile-emphasize-btn')).toHaveCount(0)
  await expect(page.locator('.video-tile-fill-btn')).toHaveCount(0)
})
