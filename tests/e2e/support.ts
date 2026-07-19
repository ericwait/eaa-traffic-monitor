import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'

// Shared launch + window-selection helpers for the Electron e2e specs. Kept in
// one place so the origin the main renderer loads from is matched identically by
// every suite — it changed in Phase 2b (decision 2026-07-19): the packaged
// renderer now loads from a loopback http server, with app:// as the fallback.

// Playwright loads the e2e specs as CommonJS (the repo's main/preload are CJS, so
// the package is not "type": "module"), which makes __dirname available here too.
export const projectRoot = join(__dirname, '..', '..')
export const mainEntry = join(projectRoot, 'out', 'main', 'index.js')

/**
 * Is this the main renderer's URL? The app has TWO webContents: the main
 * renderer and the FR24 WebContentsView (about:blank under the e2e override).
 * The main renderer loads from the loopback http origin in packaged mode, or
 * app:// if the loopback bind failed — accept EITHER. about:blank (the FR24
 * view) matches neither, so the FR24-view-exclusion property is preserved.
 */
export function isMainRendererUrl(url: string): boolean {
  return url.startsWith('http://127.0.0.1:') || url.startsWith('app://')
}

/**
 * Resolve the main renderer window, polling briefly because `firstWindow()` can
 * return either webContents and the FR24 view may appear first.
 */
export async function getMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const main = electronApp.windows().find((p) => isMainRendererUrl(p.url()))
    if (main) return main
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    'e2e: the main renderer window (loopback http://127.0.0.1 or app://) never appeared'
  )
}

/**
 * Build a launch env stripped of the two vars that break a headed Electron:
 *   ELECTRON_RUN_AS_NODE — forces Node mode, no app/BrowserWindow,
 *   ELECTRON_RENDERER_URL — would divert us to a (absent) dev server.
 * Defaults NODE_ENV=production and points the FR24 view at about:blank so the
 * suites never depend on the network; `extra` overrides/adds per suite.
 */
export function e2eEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_RENDERER_URL') continue
    if (value !== undefined) env[key] = value
  }
  env.NODE_ENV = 'production'
  env.FR24_URL_OVERRIDE = 'about:blank'
  return { ...env, ...extra }
}
