import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit tier only. Pure logic — no DOM, no Electron, no I/O — so the default
// node environment is correct. The `@shared` alias mirrors the app configs so
// tests import the same modules the app does. The e2e tier (Playwright for
// Electron) is a separate runner; see playwright.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    // Keep vitest away from the Playwright specs, which use a different runner.
    exclude: ['tests/e2e/**', 'node_modules/**', 'out/**', 'dist/**']
  }
})
