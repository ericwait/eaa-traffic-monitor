import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'

// Audio-panel smoke for the built app. Proves the ATC Audio pillar mounts, the
// eight curated streams render as strips with their default labels, each carries
// a status chip, and the mute toggle flips.
//
// CRITICAL: this spec must NEVER depend on LiveATC being reachable — CI is a
// network-restricted Linux box. We launch with AUDIO_E2E=1 (short reconnect
// backoff, no audible autoplay) and assert the chip is in the *set* of valid
// states {connecting, reconnecting, error, live}: with no network the streams
// settle into reconnecting/error, with network they reach connecting/live —
// either way the panel is populated and the assertion holds, without waiting.
//
// Prerequisite: `electron-vite build` must have run (out/main + out/renderer).
// `just e2e` builds first.

const projectRoot = join(__dirname, '..', '..')
const mainEntry = join(projectRoot, 'out', 'main', 'index.js')

/** The curated KOSH defaults (see src/shared/defaultConfig.ts): id -> label. */
const DEFAULT_STREAMS: ReadonlyArray<readonly [string, string]> = [
  ['guard', 'Emergency/Guard'],
  ['tower', 'Tower N+S'],
  ['fisk', 'Fisk VFR Approach'],
  ['gnd', 'Del/Gnd/Misc'],
  ['depmon', 'Departure Monitor'],
  ['tower-s', 'South Tower 18/36'],
  ['airshow', 'Air Show'],
  ['atis', 'ATIS']
]

const VALID_CHIP_STATES = new Set(['connecting', 'live', 'reconnecting', 'error'])

let app: ElectronApplication
let page: Page

// The app has two webContents (the app:// renderer and the FR24 view); select
// the main renderer explicitly by its app:// URL, not by creation order.
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
  env.FR24_URL_OVERRIDE = 'about:blank'
  // Short backoff + no audible autoplay so the smoke never waits on a network
  // or a user gesture.
  env.AUDIO_E2E = '1'

  app = await electron.launch({ args: [mainEntry], env })
  await app.firstWindow()
  page = await getMainWindow(app)
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('mounts the ATC Audio panel heading', async () => {
  await expect(page.getByRole('heading', { name: 'ATC Audio' })).toBeVisible()
})

test('renders all eight curated stream strips with their default labels', async () => {
  for (const [id, label] of DEFAULT_STREAMS) {
    const strip = page.getByTestId(`stream-strip-${id}`)
    await expect(strip).toBeVisible()
    await expect(strip).toContainText(label)
  }
})

test('every strip carries an activity light and a status chip in a valid state', async () => {
  for (const [id] of DEFAULT_STREAMS) {
    await expect(page.getByTestId(`activity-light-${id}`)).toBeVisible()

    const chip = page.getByTestId(`status-chip-${id}`)
    await expect(chip).toBeVisible()
    // 'connecting' is the initial state (already in the valid set), so this
    // resolves immediately and never waits on the reconnect backoff schedule.
    await expect
      .poll(async () => VALID_CHIP_STATES.has((await chip.getAttribute('data-status')) ?? ''))
      .toBe(true)
  }
})

test('the mute toggle flips its pressed state', async () => {
  // Guard ships unmuted, so its toggle starts at aria-pressed="false".
  const mute = page.getByTestId('mute-guard')
  await expect(mute).toBeVisible()
  const before = await mute.getAttribute('aria-pressed')
  await mute.click()
  const expected = before === 'true' ? 'false' : 'true'
  await expect(mute).toHaveAttribute('aria-pressed', expected)
})
