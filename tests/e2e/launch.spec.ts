import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'

// Launch-smoke for the built app. Proves the packaged main process boots, the
// app:// scheme serves the renderer, the three-panel skeleton mounts, and the
// FR24 WebContentsView is attached to the window's content view and tracks its
// DOM region (non-zero bounds after a resize settle).
//
// CRITICAL: this spec must NEVER depend on flightradar24.com loading — CI is a
// network-restricted Linux box. We point the FR24 view at about:blank via
// FR24_URL_OVERRIDE and assert attachment/bounds/toolbar, never page content.
//
// Prerequisite: `electron-vite build` must have run so out/main/index.js and
// out/renderer exist. `just e2e` builds first.

// Playwright loads this spec as CommonJS (the repo's main/preload are CJS, so
// the package is not "type": "module"), which makes __dirname available.
const projectRoot = join(__dirname, '..', '..')
const mainEntry = join(projectRoot, 'out', 'main', 'index.js')

let app: ElectronApplication
let page: Page

// The app has TWO webContents: the main renderer (served over app://) and the
// FR24 WebContentsView (about:blank under the e2e override). `firstWindow()` can
// return either, so select the main renderer explicitly by its app:// URL rather
// than relying on creation order.
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
    // Drop the two vars that break a headed Electron launch:
    //   ELECTRON_RUN_AS_NODE — forces Node mode, no app/BrowserWindow.
    //   ELECTRON_RENDERER_URL — would divert us to a (absent) dev server.
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_RENDERER_URL') continue
    if (value !== undefined) env[key] = value
  }
  env.NODE_ENV = 'production'
  // Keep the FR24 view off the network: load a blank page instead of FR24 so the
  // test is deterministic and CI-safe. We assert the view is attached and sized,
  // not what it renders.
  env.FR24_URL_OVERRIDE = 'about:blank'

  app = await electron.launch({ args: [mainEntry], env })
  await app.firstWindow() // ensure the app has booted a webContents
  page = await getMainWindow(app)
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('launches to a window titled "EAA Traffic Monitor"', async () => {
  await expect(page).toHaveTitle('EAA Traffic Monitor')
})

test('mounts the renderer and shows the app heading', async () => {
  await expect(page.getByRole('heading', { name: 'EAA Traffic Monitor' })).toBeVisible()
})

test('the BrowserWindow reports the expected title from the main process', async () => {
  const title = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win?.getTitle()
  })
  expect(title).toBe('EAA Traffic Monitor')
})

test('renders all three panel headings', async () => {
  await expect(page.getByRole('heading', { name: 'ATC Audio' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Flight Tracking' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Live Video' })).toBeVisible()
})

test('renders the FR24 navigation toolbar', async () => {
  await expect(page.getByRole('toolbar', { name: 'FlightRadar24 navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('attaches exactly one FR24 WebContentsView to the window content view', async () => {
  const count = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win?.contentView.children.length ?? -1
  })
  expect(count).toBe(1)
})

test('the FR24 view has non-zero bounds after a resize settle', async () => {
  // Resize the window, then let the renderer's rAF-throttled bounds-sync settle.
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setContentSize(1400, 900)
  })

  // Poll the native child view's bounds until both dimensions are positive —
  // proof the DOM region measured itself and drove fr24:setBounds through IPC.
  await expect
    .poll(
      async () => {
        return app.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          const child = win?.contentView.children[0]
          if (!child) return 0
          const b = child.getBounds()
          return Math.min(b.width, b.height)
        })
      },
      { timeout: 10_000, message: 'FR24 view bounds never became non-zero' }
    )
    .toBeGreaterThan(0)
})
