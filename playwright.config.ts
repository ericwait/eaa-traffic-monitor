import { defineConfig } from '@playwright/test'

// Playwright-for-Electron launch smoke. This runner does NOT build the app —
// `just e2e` runs `electron-vite build` first so out/ exists. On CI the same
// job runs under xvfb-run (see .github/workflows/ci.yml).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 }
})
