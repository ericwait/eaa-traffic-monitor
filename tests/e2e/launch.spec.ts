import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'

// Launch-smoke for the built app. Proves the packaged main process boots, the
// app:// scheme serves the renderer, and the window mounts to a titled dark
// window. This is the whole e2e tier for the sprint (see docs/development/
// Testing.md); richer scenarios come with the features they cover.
//
// Prerequisite: `electron-vite build` must have run so out/main/index.js and
// out/renderer exist. `just e2e` builds first; the Playwright config does not
// build, so run via `just e2e` (or `npm run build` beforehand).

// Playwright loads this spec as CommonJS (the repo's main/preload are CJS, so
// the package is not "type": "module"), which makes __dirname available.
const projectRoot = join(__dirname, '..', '..')
const mainEntry = join(projectRoot, 'out', 'main', 'index.js')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // Strip ELECTRON_RUN_AS_NODE from the child env. Some IDE-integrated
  // terminals (VS Code family) export it, which forces Electron to run as a
  // plain Node process — no app, no BrowserWindow — and the launch fails with
  // "bad option: --remote-debugging-port". Deleting it here makes the test
  // robust regardless of the shell it inherits.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    // Drop the two vars that break a headed Electron launch:
    //   ELECTRON_RUN_AS_NODE — forces Node mode, no app/BrowserWindow.
    //   ELECTRON_RENDERER_URL — would divert us to a (absent) dev server.
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_RENDERER_URL') continue
    if (value !== undefined) env[key] = value
  }
  env.NODE_ENV = 'production'

  app = await electron.launch({ args: [mainEntry], env })
  page = await app.firstWindow()
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
