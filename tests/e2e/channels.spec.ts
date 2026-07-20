import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { mainEntry, getMainWindow, e2eEnv } from './support'

// Channel-manager smoke for the built app: reorder by keyboard and by pointer
// drag (priority = vertical order, top = P1), remove a channel, and add one
// from the LiveATC directory dialog. The suite launches with E2E_USERDATA
// pointing at a throwaway directory — these flows REWRITE config.json, and the
// operator's real profile must never be the test bench.
//
// CRITICAL: like audio.spec, this must never depend on LiveATC being reachable.
// The Add dialog's search self-heals: a failed live search for kosh serves the
// BUNDLED fallback list, so feed rows render either way, and the feed used for
// the add (kosh_wb1, Warbird Area) exists in both the live directory and the
// bundled snapshot.
//
// Tests run serially and share state; each test names the state it expects.

let app: ElectronApplication
let page: Page
let userDataDir: string

/** The streams array of the on-disk config.json in the throwaway userData. */
function configStreams(): { id: string; priority: number }[] {
  const raw = readFileSync(join(userDataDir, 'config.json'), 'utf8')
  return JSON.parse(raw).streams
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atm-e2e-channels-'))
  app = await electron.launch({
    args: [mainEntry],
    env: e2eEnv({ AUDIO_E2E: '1', E2E_USERDATA: userDataDir })
  })
  await app.firstWindow()
  page = await getMainWindow(app)
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('every strip carries a reorder grip and a remove button', async () => {
  for (const id of ['guard', 'tower', 'atis']) {
    await expect(page.getByTestId(`grip-${id}`)).toBeVisible()
    await expect(page.getByTestId(`remove-${id}`)).toBeVisible()
  }
})

test('arrow keys on the grip swap priorities and persist to config.json', async () => {
  // Fresh defaults: guard is P1, tower P2.
  await expect(page.getByTestId('priority-guard')).toHaveText('P1')

  const grip = page.getByTestId('grip-guard')
  await grip.focus()
  await grip.press('ArrowDown')

  await expect(page.getByTestId('priority-guard')).toHaveText('P2')
  await expect(page.getByTestId('priority-tower')).toHaveText('P1')
  await expect.poll(() => configStreams().find((s) => s.id === 'guard')?.priority).toBe(2)

  // Restore: guard back to the top.
  await grip.press('ArrowUp')
  await expect(page.getByTestId('priority-guard')).toHaveText('P1')
  await expect.poll(() => configStreams().find((s) => s.id === 'guard')?.priority).toBe(1)
})

test('dragging a grip reorders the list (bottom strip to the top)', async () => {
  // State: default order (guard first, atis last). The reorder handler listens
  // on POINTER events; Playwright's page.mouse emits only mouse events, so the
  // drag is driven with dispatched PointerEvents (clientY carries the hit test).
  const topStrip = await page.getByTestId('stream-strip-guard').boundingBox()
  if (!topStrip) throw new Error('e2e: top strip not measurable')
  // A Y just above the top strip's midpoint → the hit test yields index 0.
  const dropY = topStrip.y + 2

  await page.getByTestId('grip-atis').dispatchEvent('pointerdown', { button: 0, bubbles: true })
  await expect(page.getByTestId('stream-strip-atis')).toHaveAttribute('data-dragging', 'true')

  // The move/up listeners live on window; the dispatched events must bubble to
  // reach them. clientY drives the drop position (above the top strip → index 0).
  // The priority BADGE reflects stored priority, which only changes on commit —
  // so the mid-drag effect is the visual list order, asserted after pointerup.
  await page.locator('body').dispatchEvent('pointermove', {
    bubbles: true,
    clientX: topStrip.x + topStrip.width / 2,
    clientY: dropY
  })
  await page.locator('body').dispatchEvent('pointerup', { bubbles: true })

  await expect(page.getByTestId('priority-atis')).toHaveText('P1')
  await expect(page.getByTestId('priority-guard')).toHaveText('P2')
  await expect.poll(() => configStreams()[0]?.id).toBe('atis')
})

test('removing a channel drops its strip and renumbers config.json', async () => {
  // State: atis is on top (P1) from the drag test.
  await page.getByTestId('remove-atis').click()

  await expect(page.getByTestId('stream-strip-atis')).toHaveCount(0)
  await expect(page.getByTestId('priority-guard')).toHaveText('P1')
  await expect.poll(() => configStreams().length).toBe(7)
  expect(configStreams().map((s) => s.id)).not.toContain('atis')
})

test('the Add-channel dialog lists directory feeds (live or bundled) and adds one', async () => {
  await page.getByTestId('audio-add-channel').click()
  await expect(page.getByTestId('add-channel-modal')).toBeVisible()

  // The dialog searches for the configured station (kosh) on open. With
  // network it lists LiveATC's live directory; without, the bundled KOSH
  // snapshot — kosh_wb1 (Warbird Area) is in both. Generous timeout: the live
  // attempt may take up to its 10 s network timeout before falling back.
  const warbird = page.getByTestId('add-channel-feed-kosh_wb1')
  await expect(warbird).toBeVisible({ timeout: 30_000 })

  // Already-configured feeds read as added and cannot be re-added: the default
  // 'tower' stream uses the kosh_twr mount.
  await expect(page.getByTestId('add-channel-add-kosh_twr')).toBeDisabled()

  await page.getByTestId('add-channel-add-kosh_wb1').click()

  // The new channel lands at the bottom (lowest priority), disconnected, and
  // its directory row flips to the added state.
  await expect(page.getByTestId('add-channel-add-kosh_wb1')).toBeDisabled()
  await expect(page.getByTestId('stream-strip-kosh_wb1')).toBeVisible()
  await expect(page.getByTestId('priority-kosh_wb1')).toHaveText('P8')
  await expect(page.getByTestId('status-chip-kosh_wb1')).toHaveAttribute(
    'data-status',
    'disconnected'
  )
  await expect.poll(() => configStreams().length).toBe(8)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('add-channel-modal')).toHaveCount(0)
  await expect(page.getByTestId('stream-strip-kosh_wb1')).toBeVisible()
})
