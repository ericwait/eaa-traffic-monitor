import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Audio-panel smoke for the built app. Proves the ATC Audio pillar mounts, the
// eight curated streams render as strips with their default labels, each carries
// a status pill and a priority-rank badge, the mute + solo toggles flip, and the
// on-demand connect model holds: every stream starts DISCONNECTED and clicking a
// pill connects (then disconnects) that stream.
//
// CRITICAL: this spec must NEVER depend on LiveATC being reachable — CI is a
// network-restricted Linux box. We launch with AUDIO_E2E=1, which starts from a
// deterministic all-disconnected default (session restore is skipped under the
// harness) and shortens the reconnect backoff. After a connect click we assert
// only that the pill LEAVES 'disconnected' and lands in the *set* of connected
// states {connecting, live, reconnecting, feed-down, error}: with no network it
// settles into reconnecting/feed-down, with network it reaches connecting/live —
// either way the assertion holds without waiting on the network.
//
// Prerequisite: `electron-vite build` must have run (out/main + out/renderer).
// `just e2e` builds first.

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

/** The states a stream can be in once connected (i.e. no longer 'disconnected'). */
const CONNECTED_STATES = new Set(['connecting', 'live', 'reconnecting', 'feed-down', 'error'])

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // Short backoff + no audible autoplay so the smoke never waits on a network
  // or a user gesture.
  app = await electron.launch({ args: [mainEntry], env: e2eEnv({ AUDIO_E2E: '1' }) })
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

test('every strip carries an activity light and a status pill defaulting to disconnected', async () => {
  for (const [id] of DEFAULT_STREAMS) {
    await expect(page.getByTestId(`activity-light-${id}`)).toBeVisible()

    const pill = page.getByTestId(`status-chip-${id}`)
    await expect(pill).toBeVisible()
    // On-demand model: nothing connects at launch, so every pill starts
    // 'disconnected'. This resolves immediately and never waits on the network.
    await expect(pill).toHaveAttribute('data-status', 'disconnected')
  }
})

test('the status pill is a real button that connects, then disconnects, on click', async () => {
  const pill = page.getByTestId('status-chip-guard')
  await expect(pill).toHaveAttribute('data-status', 'disconnected')

  // Clicking a disconnected pill connects the stream — it leaves 'disconnected'
  // and lands in a connected state. Network-agnostic: reconnecting/feed-down with
  // no network, connecting/live with one.
  await pill.click()
  await expect
    .poll(async () => CONNECTED_STATES.has((await pill.getAttribute('data-status')) ?? ''))
    .toBe(true)

  // Clicking again disconnects it and cancels any retry — back to 'disconnected'.
  await pill.click()
  await expect(pill).toHaveAttribute('data-status', 'disconnected')
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

test('every strip shows its priority rank badge (P1..P8)', async () => {
  // Priorities come from config: Guard is P1 (highest), ATIS is P8 (lowest).
  await expect(page.getByTestId('priority-guard')).toHaveText('P1')
  await expect(page.getByTestId('priority-atis')).toHaveText('P8')
  for (const [id] of DEFAULT_STREAMS) {
    await expect(page.getByTestId(`priority-${id}`)).toBeVisible()
  }
})

test('every strip carries a duck-target data attribute, ungated at full (1)', async () => {
  // With no priority stream forcing a duck (and no solo held), every stream's
  // duck target rides at 1 — verifiable from the DOM without any audio.
  for (const [id] of DEFAULT_STREAMS) {
    await expect(page.getByTestId(`stream-strip-${id}`)).toHaveAttribute('data-duck-target', '1')
  }
})

test('the solo toggle flips its pressed state and marks the strip soloed', async () => {
  const solo = page.getByTestId('solo-tower')
  await expect(solo).toHaveAttribute('aria-pressed', 'false')
  await solo.click()
  await expect(solo).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('stream-strip-tower')).toHaveAttribute('data-soloed', 'true')
  // A different strip is silenced by the solo (duck target driven to 0).
  await expect(page.getByTestId('stream-strip-fisk')).toHaveAttribute('data-duck-target', '0')
  // Clicking again releases; the mix returns to full.
  await solo.click()
  await expect(solo).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('stream-strip-fisk')).toHaveAttribute('data-duck-target', '1')
})

test('every strip has an output-device picker defaulting to System default', async () => {
  for (const [id] of DEFAULT_STREAMS) {
    const picker = page.getByTestId(`device-${id}`)
    await expect(picker).toBeVisible()
    // The synthetic default option is always present and selected initially.
    await expect(picker.locator('option').first()).toHaveText('System default')
  }
})
