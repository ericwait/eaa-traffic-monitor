import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultFeeds } from '../../src/renderer/src/youtube/defaultFeeds'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Snaps e2e (PR5 "feature/layout-snaps" of the panel-system effort — see
// docs/Panel-System-Plan.md § Test plan § layoutProfiles): applies the 2x2
// template with explicit zone assignments (structure asserted via
// `data-panel-id` rect geometry), saves the result as a named profile, checks
// the native Layout menu picks the profile up as a radio item, perturbs the
// layout via the Move-panel modal (PR4), then re-applies the saved profile
// from LayoutManagerModal — proving the profile restores the EXACT same
// arrangement. The `isConnected` check on a video-tile handle captured before
// the perturb+re-apply sequence is the load-bearing proxy for the plan's
// core guarantee: template/profile switches never remount a video panel,
// because every path (template Apply -> `applyTree`, profile Apply ->
// the store's `applyProfile`, a Move-panel commit -> `movePanel`) only ever
// swaps `panelTree`, which PanelCanvas renders in fixed id-sorted DOM order
// (PR2) — a leaf present in both the old and new tree keeps its exact DOM.
//
// Like channels.spec.ts/popout.spec.ts, this suite launches with
// E2E_USERDATA pointing at a throwaway directory: applying a template and
// saving/renaming/deleting profiles REWRITES `session.panelLayout` (closing
// six of the seven default video panels along the way), and the operator's
// real profile — and every OTHER spec that shares the default, non-isolated
// userData — must never see that.

const ZONE_D_FEED = defaultFeeds[0]
const PROFILE_NAME = 'Show Day'
const PROFILE_RENAMED = 'Show Day 2'

let app: ElectronApplication
let page: Page
let userDataDir: string

/** Poll until the "Layout" submenu contains an item labeled `label` — profile radio items appear only after the renderer's next `layout:menuSync` push, an async round trip. */
async function waitForLayoutMenuItem(label: string): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(({ Menu }, itemLabel) => {
        const menu = Menu.getApplicationMenu()
        const layoutMenu = menu?.items.find((i) => i.label === 'Layout')
        return layoutMenu?.submenu?.items.some((i) => i.label === itemLabel) ?? false
      }, label)
    )
    .toBe(true)
}

/** Poll until the "Layout" submenu no longer contains an item labeled `label` (a deleted/renamed-away profile). */
async function waitForLayoutMenuItemGone(label: string): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(({ Menu }, itemLabel) => {
        const menu = Menu.getApplicationMenu()
        const layoutMenu = menu?.items.find((i) => i.label === 'Layout')
        return layoutMenu?.submenu?.items.some((i) => i.label === itemLabel) ?? false
      }, label)
    )
    .toBe(false)
}

/** Same shape as panels.spec.ts's own helper: find + click a "Layout" submenu item by label, via the native Menu itself (not a simulated OS click). Waits for the item to exist first. */
async function clickLayoutMenuItem(label: string): Promise<void> {
  await waitForLayoutMenuItem(label)
  await app.evaluate(({ Menu }, itemLabel) => {
    const menu = Menu.getApplicationMenu()
    const layoutMenu = menu?.items.find((i) => i.label === 'Layout')
    const item = layoutMenu?.submenu?.items.find((i) => i.label === itemLabel)
    item?.click()
  }, label)
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atm-e2e-layout-profiles-'))
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

// Boxes captured right after applying the 2x2 template (test below) — reused
// later to prove the re-applied saved profile reproduces the EXACT same
// geometry, not just "some" 2x2-shaped arrangement.
let fr24BoxAfterApply: { x: number; y: number; width: number; height: number }
let audioBoxAfterApply: { x: number; y: number; width: number; height: number }
let weatherBoxAfterApply: { x: number; y: number; width: number; height: number }
let videoBoxAfterApply: { x: number; y: number; width: number; height: number }

test('the Layout Manager opens from the native Layout menu and hides FR24 underneath it', async () => {
  await clickLayoutMenuItem('Layout Manager…')
  await expect(page.getByTestId('layout-manager-modal')).toBeVisible()
  // Same consolidated FR24 rule every other overlay proves (panels.spec.ts's
  // Move-panel test) — opening this modal sets `overlay: 'layout-manager'`.
  await expect(page.locator('.app-shell')).toHaveAttribute('data-fr24-hidden', 'true')
})

test('selecting the 2x2 template pre-fills a sane default assignment (audio, weather, fr24, then the first open video feed)', async () => {
  await page.getByTestId('template-card-2x2').click()
  await expect(page.getByTestId('template-card-2x2')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('template-assign')).toBeVisible()

  await expect(page.getByTestId('zone-assign-zone-a')).toHaveValue('audio')
  await expect(page.getByTestId('zone-assign-zone-b')).toHaveValue('weather')
  await expect(page.getByTestId('zone-assign-zone-c')).toHaveValue('fr24')
  await expect(page.getByTestId('zone-assign-zone-d')).toHaveValue(`video:${ZONE_D_FEED.id}`)
})

test('applying the 2x2 template with a chosen assignment replaces the whole layout, closing every unassigned panel', async () => {
  // Re-assign to a deterministic arrangement distinct from the pre-fill, so
  // this test actually exercises operator choice, not just the default:
  // zone-a=fr24 (top-left), zone-b=audio (top-right), zone-c=weather
  // (bottom-left), zone-d=the same video feed (bottom-right).
  await page.getByTestId('zone-assign-zone-a').selectOption('fr24')
  await page.getByTestId('zone-assign-zone-b').selectOption('audio')
  await page.getByTestId('zone-assign-zone-c').selectOption('weather')
  await page.getByTestId('zone-assign-zone-d').selectOption(`video:${ZONE_D_FEED.id}`)
  await page.getByTestId('template-apply').click()

  // Apply does not auto-close the modal (Save-as-profile stays reachable
  // right after) — close it explicitly to inspect the canvas underneath.
  await page.getByTestId('layout-manager-close').click()
  await expect(page.getByTestId('layout-manager-modal')).toHaveCount(0)
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-fr24-hidden', 'true')

  // Exactly the four assigned panels remain — the 2x2 template has no
  // video-rest zone, so every OTHER default video feed is now closed.
  await expect(page.locator('.leaf-frame')).toHaveCount(4)
  for (const id of ['fr24', 'audio', 'weather', `video:${ZONE_D_FEED.id}`]) {
    await expect(page.locator(`.leaf-frame[data-panel-id="${id}"]`)).toHaveCount(1)
  }

  fr24BoxAfterApply = (await page.locator('.leaf-frame[data-panel-id="fr24"]').boundingBox())!
  audioBoxAfterApply = (await page.locator('.leaf-frame[data-panel-id="audio"]').boundingBox())!
  weatherBoxAfterApply = (await page.locator('.leaf-frame[data-panel-id="weather"]').boundingBox())!
  videoBoxAfterApply = (await page
    .locator(`.leaf-frame[data-panel-id="video:${ZONE_D_FEED.id}"]`)
    .boundingBox())!

  // 2x2 geometry: fr24/audio share the top row, weather/the video feed share
  // the bottom row, left column left of right column.
  expect(fr24BoxAfterApply.y).toBeCloseTo(audioBoxAfterApply.y, 0)
  expect(weatherBoxAfterApply.y).toBeCloseTo(videoBoxAfterApply.y, 0)
  expect(weatherBoxAfterApply.y).toBeGreaterThan(fr24BoxAfterApply.y)
  expect(fr24BoxAfterApply.x).toBeLessThan(audioBoxAfterApply.x)
  expect(weatherBoxAfterApply.x).toBeLessThan(videoBoxAfterApply.x)
})

test('saving the current layout as a named profile lists it as active, and the native Layout menu picks it up', async () => {
  await clickLayoutMenuItem('Layout Manager…')
  await page.getByTestId('profile-name-input').fill(PROFILE_NAME)
  await page.getByTestId('profile-save').click()

  await expect(page.getByTestId('profile-row-0')).toContainText(PROFILE_NAME)
  await expect(page.getByTestId('profile-row-0')).toHaveAttribute('data-active', 'true')
  await page.getByTestId('layout-manager-close').click()

  // The menu's own profile radio — extends layout:menuSync/layout:command
  // (src/main/menu.ts / layout/menuBridge.ts).
  await waitForLayoutMenuItem(PROFILE_NAME)
})

test('renaming the profile updates its row and the native menu label, keeping it active', async () => {
  await clickLayoutMenuItem('Layout Manager…')
  await page.getByTestId('profile-rename-0').click()
  await page.getByTestId('profile-rename-input-0').fill(PROFILE_RENAMED)
  await page.getByTestId('profile-rename-save-0').click()

  await expect(page.getByTestId('profile-row-0')).toContainText(PROFILE_RENAMED)
  await expect(page.getByTestId('profile-row-0')).toHaveAttribute('data-active', 'true')
  await page.getByTestId('layout-manager-close').click()

  await waitForLayoutMenuItem(PROFILE_RENAMED)
  await waitForLayoutMenuItemGone(PROFILE_NAME)
})

test('perturbing via the Move-panel modal clears the active-profile match; re-applying the saved profile restores the EXACT geometry WITHOUT remounting the video tile', async () => {
  // Stream-survival proxy: capture a live handle on the video tile BEFORE
  // perturbing OR re-applying — it must stay connected through BOTH tree
  // swaps below (movePanel's commit, then applyProfile's commit).
  const videoTileHandle = await page
    .locator(`[data-testid="video-tile"][data-feed-id="${ZONE_D_FEED.id}"]`)
    .elementHandle()
  expect(videoTileHandle).not.toBeNull()

  // Perturb: swap fr24 and weather (center zone) via the deterministic
  // Move-panel modal (PR4) — same mechanics as panels.spec.ts's own
  // Move-panel test.
  const fr24Leaf = page.locator('.leaf-frame[data-panel-id="fr24"]')
  await fr24Leaf.getByTestId('leaf-move-fr24').click()
  await page.getByTestId('move-panel-target').selectOption('weather')
  await page.getByTestId('move-panel-zone-center').check()
  await page.getByTestId('move-panel-submit').click()
  await expect(page.getByTestId('move-panel-modal')).toHaveCount(0)

  // The swap actually moved fr24 into weather's OLD (bottom-left) rect —
  // both were in the left column, so only y moves; x is unaffected by this
  // particular pair — proving the perturb is real, not a no-op.
  const perturbedFr24Box = (await fr24Leaf.boundingBox())!
  expect(perturbedFr24Box.y).not.toBeCloseTo(fr24BoxAfterApply.y, 0)
  expect(perturbedFr24Box.y).toBeCloseTo(weatherBoxAfterApply.y, 0)
  expect(perturbedFr24Box.x).toBeCloseTo(weatherBoxAfterApply.x, 0)

  await clickLayoutMenuItem('Layout Manager…')
  // The canvas no longer matches the saved profile exactly (a structural
  // edit clears `activeProfileName` — docs/Panel-System-Plan.md § Store slice).
  await expect(page.getByTestId('profile-row-0')).not.toHaveAttribute('data-active', 'true')

  await page.getByTestId('profile-apply-0').click()
  await expect(page.getByTestId('profile-row-0')).toHaveAttribute('data-active', 'true')
  await page.getByTestId('layout-manager-close').click()

  // Restored to the EXACT rects captured right after the original template
  // Apply — not just "a" 2x2 shape, but the SAME saved arrangement.
  const restoredFr24Box = (await fr24Leaf.boundingBox())!
  expect(restoredFr24Box.x).toBeCloseTo(fr24BoxAfterApply.x, 0)
  expect(restoredFr24Box.y).toBeCloseTo(fr24BoxAfterApply.y, 0)
  const restoredAudioBox = (await page.locator('.leaf-frame[data-panel-id="audio"]').boundingBox())!
  const restoredWeatherBox = (await page
    .locator('.leaf-frame[data-panel-id="weather"]')
    .boundingBox())!
  const restoredVideoBox = (await page
    .locator(`.leaf-frame[data-panel-id="video:${ZONE_D_FEED.id}"]`)
    .boundingBox())!
  expect(restoredAudioBox.x).toBeCloseTo(audioBoxAfterApply.x, 0)
  expect(restoredAudioBox.y).toBeCloseTo(audioBoxAfterApply.y, 0)
  expect(restoredWeatherBox.x).toBeCloseTo(weatherBoxAfterApply.x, 0)
  expect(restoredWeatherBox.y).toBeCloseTo(weatherBoxAfterApply.y, 0)
  expect(restoredVideoBox.x).toBeCloseTo(videoBoxAfterApply.x, 0)
  expect(restoredVideoBox.y).toBeCloseTo(videoBoxAfterApply.y, 0)

  // THE load-bearing proof: the SAME DOM node captured before the perturb is
  // still attached to the document after both tree swaps — the video leaf
  // was never unmounted/remounted (a remount would have detached it).
  expect(await videoTileHandle!.evaluate((el) => el.isConnected)).toBe(true)
})

test('deleting the profile removes its row and its native-menu radio item', async () => {
  await clickLayoutMenuItem('Layout Manager…')
  await page.getByTestId('profile-delete-0').click()
  await expect(page.getByTestId('profile-row-0')).toHaveCount(0)
  await expect(page.getByTestId('profile-list')).toHaveCount(0)
  await page.getByTestId('layout-manager-close').click()

  await waitForLayoutMenuItemGone(PROFILE_RENAMED)
})
