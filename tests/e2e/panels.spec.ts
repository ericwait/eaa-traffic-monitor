import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Panel-canvas basics (docs/Panel-System-Plan.md, PR2 "feature/panel-canvas-shell"):
// the default layout renders every panel with a stable `data-panel-id`, field
// weather is promoted to its own top-level panel (no longer nested inside ATC
// audio), and maximize/Escape work end to end. PR4
// ("feature/panel-menu-move") adds close/reopen via the native Panels menu,
// the Move-panel modal, and the video fit/fill toggle — see below. Deeper
// canvas behavior (splitter drag geometry, snap templates, header
// drag-to-dock) lands with later PRs in the panel-system effort.

/**
 * Click a native "Panels" menu checkbox by its label (the panel's title —
 * see layout/menuBridge.ts's buildMenuSyncPayload / layout/panelMeta.ts's
 * panelTitle). Polls until the item exists — the menu is rebuilt on every
 * `layout:menuSync` push, and this waits out that round trip rather than
 * racing it — then invokes the MenuItem's own click handler directly
 * (the plan's test-notes pattern: `electronApp.evaluate` against the native
 * menu, not simulating an OS menu-bar click).
 */
async function clickPanelsMenuItem(electronApp: ElectronApplication, label: string): Promise<void> {
  await expect
    .poll(() =>
      electronApp.evaluate(({ Menu }, itemLabel) => {
        const menu = Menu.getApplicationMenu()
        const panelsMenu = menu?.items.find((i) => i.label === 'Panels')
        return panelsMenu?.submenu?.items.some((i) => i.label === itemLabel) ?? false
      }, label)
    )
    .toBe(true)

  await electronApp.evaluate(({ Menu }, itemLabel) => {
    const menu = Menu.getApplicationMenu()
    const panelsMenu = menu?.items.find((i) => i.label === 'Panels')
    const item = panelsMenu?.submenu?.items.find((i) => i.label === itemLabel)
    item?.click()
  }, label)
}

/** Same shape as clickPanelsMenuItem, but for the "Layout" menu (e.g. "Reset to Default Layout"). */
async function clickLayoutMenuItem(electronApp: ElectronApplication, label: string): Promise<void> {
  await electronApp.evaluate(({ Menu }, itemLabel) => {
    const menu = Menu.getApplicationMenu()
    const layoutMenu = menu?.items.find((i) => i.label === 'Layout')
    const item = layoutMenu?.submenu?.items.find((i) => i.label === itemLabel)
    item?.click()
  }, label)
}

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

// --- PR4 ("feature/panel-menu-move"): close/reopen, the native Panels menu,
// the Move-panel modal, and the fit/fill toggle. -----------------------------

const REOPEN_FEED = defaultFeeds[0]
const FIT_FEED = defaultFeeds[1]

test('the close chrome button removes exactly that panel', async () => {
  const panelId = `video:${REOPEN_FEED.id}`
  const leaf = page.locator(`.leaf-frame[data-panel-id="${panelId}"]`)
  await leaf.getByTestId(`leaf-close-${panelId}`).click()
  await expect(leaf).toHaveCount(0)
  // Every other panel is untouched.
  const remainingIds = [
    'audio',
    'weather',
    'fr24',
    ...defaultFeeds.map((f) => `video:${f.id}`)
  ].filter((id) => id !== panelId)
  for (const id of remainingIds) {
    await expect(page.locator(`.leaf-frame[data-panel-id="${id}"]`)).toHaveCount(1)
  }
})

test('reopening via the native Panels menu restores the frame, landing in the bottom row (not the left column)', async () => {
  const panelId = `video:${REOPEN_FEED.id}`
  await clickPanelsMenuItem(app, REOPEN_FEED.label)

  const leaf = page.locator(`.leaf-frame[data-panel-id="${panelId}"]`)
  await expect(leaf).toHaveCount(1)

  // Fix C (src/shared/panelLayout.ts insertVideoLeafBottom, exercised the same
  // way as the pop-out-close reopen path in tests/e2e/popout.spec.ts): the
  // reopened tile lands to the right of the audio column, at least as far
  // down as every other video tile.
  const audioBox = (await page.locator('.leaf-frame[data-panel-id="audio"]').boundingBox())!
  const reopenedBox = (await leaf.boundingBox())!
  const otherVideoBoxes = await Promise.all(
    defaultFeeds
      .filter((f) => f.id !== REOPEN_FEED.id)
      .map((f) => page.locator(`.leaf-frame[data-panel-id="video:${f.id}"]`).boundingBox())
  )
  expect(reopenedBox.x).toBeGreaterThanOrEqual(audioBox.x + audioBox.width - 1)
  const maxOtherY = Math.max(...otherVideoBoxes.map((b) => b!.y))
  expect(reopenedBox.y).toBeGreaterThanOrEqual(maxOtherY - 1)
})

test('the Panels menu checkbox toggle also closes an open panel (not just reopens a closed one)', async () => {
  const panelId = `video:${REOPEN_FEED.id}`
  await clickPanelsMenuItem(app, REOPEN_FEED.label)
  await expect(page.locator(`.leaf-frame[data-panel-id="${panelId}"]`)).toHaveCount(0)

  // Leave it reopened for the rest of the suite (matches the default layout's
  // full panel set the first test asserted).
  await clickPanelsMenuItem(app, REOPEN_FEED.label)
  await expect(page.locator(`.leaf-frame[data-panel-id="${panelId}"]`)).toHaveCount(1)
})

test('the Move-panel modal opens over a "Move panel…" click, hides FR24 underneath it, and swaps two panels via the center zone', async () => {
  const weatherLeaf = page.locator('.leaf-frame[data-panel-id="weather"]')
  const fr24Leaf = page.locator('.leaf-frame[data-panel-id="fr24"]')

  const weatherBoxBefore = (await weatherLeaf.boundingBox())!
  const fr24BoxBefore = (await fr24Leaf.boundingBox())!

  await weatherLeaf.getByTestId('leaf-move-weather').click()
  await expect(page.getByTestId('move-panel-modal')).toBeVisible()
  // The consolidated FR24 rule keys off `overlay === null` — opening this
  // modal (which sets `overlay: 'move-panel'`) must hide the native view
  // exactly like every other overlay (docs/Panel-System-Plan.md § Store slice).
  await expect(page.locator('.app-shell')).toHaveAttribute('data-fr24-hidden', 'true')

  await page.getByTestId('move-panel-target').selectOption('fr24')
  await page.getByTestId('move-panel-zone-center').check()
  await page.getByTestId('move-panel-submit').click()

  await expect(page.getByTestId('move-panel-modal')).toHaveCount(0)
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-fr24-hidden', 'true')

  // A center-zone move swaps the two leaves' tree positions — weather now
  // occupies fr24's old rect and vice versa; audio (untouched) stays put.
  const weatherBoxAfter = (await weatherLeaf.boundingBox())!
  const fr24BoxAfter = (await fr24Leaf.boundingBox())!
  expect(weatherBoxAfter.x).toBeCloseTo(fr24BoxBefore.x, 0)
  expect(weatherBoxAfter.y).toBeCloseTo(fr24BoxBefore.y, 0)
  expect(fr24BoxAfter.x).toBeCloseTo(weatherBoxBefore.x, 0)
  expect(fr24BoxAfter.y).toBeCloseTo(weatherBoxBefore.y, 0)

  // Swap back so the rest of the suite (and any test relying on the default
  // arrangement) sees the panels where they started.
  await weatherLeaf.getByTestId('leaf-move-weather').click()
  await page.getByTestId('move-panel-target').selectOption('fr24')
  await page.getByTestId('move-panel-zone-center').check()
  await page.getByTestId('move-panel-submit').click()
  await expect(page.getByTestId('move-panel-modal')).toHaveCount(0)
})

test('Escape closes the Move-panel modal without moving anything', async () => {
  const audioLeaf = page.locator('.leaf-frame[data-panel-id="audio"]')
  const boxBefore = (await audioLeaf.boundingBox())!

  await audioLeaf.getByTestId('leaf-move-audio').click()
  await expect(page.getByTestId('move-panel-modal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('move-panel-modal')).toHaveCount(0)

  const boxAfter = (await audioLeaf.boundingBox())!
  expect(boxAfter.x).toBeCloseTo(boxBefore.x, 0)
  expect(boxAfter.y).toBeCloseTo(boxBefore.y, 0)
})

test('the fit/fill toggle flips data-fit-mode on a video panel', async () => {
  const panelId = `video:${FIT_FEED.id}`
  const stage = page.locator(`.leaf-frame[data-panel-id="${panelId}"] .video-tile-stage`)
  const toggle = page
    .locator(`.leaf-frame[data-panel-id="${panelId}"]`)
    .getByTestId(`leaf-fit-${panelId}`)

  await expect(stage).toHaveAttribute('data-fit-mode', 'fit') // default per docs/Panel-System-Plan.md
  await toggle.click()
  await expect(stage).toHaveAttribute('data-fit-mode', 'fill')
  await toggle.click()
  await expect(stage).toHaveAttribute('data-fit-mode', 'fit')
})

test('the Layout menu\'s "Reset to Default Layout" clears a maximize and restores the full default panel set', async () => {
  const fr24Leaf = page.locator('.leaf-frame[data-panel-id="fr24"]')
  await fr24Leaf.getByTestId('leaf-maximize-fr24').click()
  await expect(fr24Leaf).toHaveAttribute('data-maximized', 'true')

  await clickLayoutMenuItem(app, 'Reset to Default Layout')

  await expect(fr24Leaf).not.toHaveAttribute('data-maximized', 'true')
  const expectedIds = ['audio', 'weather', 'fr24', ...defaultFeeds.map((f) => `video:${f.id}`)]
  for (const id of expectedIds) {
    await expect(page.locator(`.leaf-frame[data-panel-id="${id}"]`)).toHaveCount(1)
  }
  await expect(page.locator('.leaf-frame')).toHaveCount(expectedIds.length)
})
