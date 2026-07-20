import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Panel-canvas basics (docs/Panel-System-Plan.md, PR2 "feature/panel-canvas-shell"):
// the default layout renders every panel with a stable `data-panel-id`, field
// weather is promoted to its own top-level panel (no longer nested inside ATC
// audio), and maximize/Escape work end to end. Deeper canvas behavior
// (splitter drag geometry, fit/fill toggling, snap templates, header
// drag-to-dock) lands with later PRs in the panel-system effort.

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({ args: [mainEntry], env: e2eEnv() })

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
})

test('the default layout renders a data-panel-id frame for every panel: audio, weather, fr24, and each video feed', async () => {
  const expectedIds = ['audio', 'weather', 'fr24', ...defaultFeeds.map((f) => `video:${f.id}`)]
  for (const id of expectedIds) {
    await expect(page.locator(`.leaf-frame[data-panel-id="${id}"]`)).toHaveCount(1)
  }
  // Exactly these, and no others — proves the render list and the tree's leaf
  // set are exactly in sync.
  await expect(page.locator('.leaf-frame')).toHaveCount(expectedIds.length)
})

test('weather is its own top-level panel, not nested inside ATC audio', async () => {
  const weatherLeaf = page.locator('.leaf-frame[data-panel-id="weather"]')
  await expect(weatherLeaf).toHaveCount(1)
  await expect(weatherLeaf.getByTestId('weather-panel')).toBeVisible()

  const audioLeaf = page.locator('.leaf-frame[data-panel-id="audio"]')
  await expect(audioLeaf.getByTestId('weather-panel')).toHaveCount(0)
})

test('double-clicking a panel header maximizes it; every other panel is hidden but stays mounted; Escape restores', async () => {
  const fr24Leaf = page.locator('.leaf-frame[data-panel-id="fr24"]')
  const audioLeaf = page.locator('.leaf-frame[data-panel-id="audio"]')

  await fr24Leaf.locator('.panel-head').first().dblclick()
  await expect(fr24Leaf).toHaveAttribute('data-maximized', 'true')
  await expect(audioLeaf).toBeHidden() // visibility:hidden, per LOAD-BEARING INVARIANT #4
  await expect(audioLeaf).toHaveCount(1) // still in the DOM — not unmounted

  await page.keyboard.press('Escape')
  await expect(fr24Leaf).not.toHaveAttribute('data-maximized', 'true')
  await expect(audioLeaf).toBeVisible()
})

test('the maximize chrome button does the same as the header double-click', async () => {
  const audioLeaf = page.locator('.leaf-frame[data-panel-id="audio"]')
  await audioLeaf.getByTestId('leaf-maximize-audio').click()
  await expect(audioLeaf).toHaveAttribute('data-maximized', 'true')

  await audioLeaf.getByTestId('leaf-maximize-audio').click() // toggling again restores
  await expect(audioLeaf).not.toHaveAttribute('data-maximized', 'true')
})
