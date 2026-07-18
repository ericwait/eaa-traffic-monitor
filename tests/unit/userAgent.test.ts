import { describe, it, expect } from 'vitest'
import { stripUserAgentTokens } from '@shared/userAgent'

// The FR24 Cloudflare challenge is the dominant Phase 1 risk; the mitigation is
// a UA that reads as plain Chrome. These lock the transform so a future Electron
// upgrade (which changes the version tokens) can't silently re-expose us.

const APP = 'eaa-traffic-monitor'

// A representative Electron 43 default UA on macOS: note both the app-name
// product token and the Electron token that must be removed.
const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `${APP}/0.0.0 Chrome/122.0.6261.156 Electron/43.1.1 Safari/537.36`

describe('stripUserAgentTokens', () => {
  it('removes both the Electron token and the app-name product token', () => {
    const cleaned = stripUserAgentTokens(ELECTRON_UA, APP)
    expect(cleaned).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/122.0.6261.156 Safari/537.36'
    )
  })

  it('leaves the Chrome and Safari tokens intact', () => {
    const cleaned = stripUserAgentTokens(ELECTRON_UA, APP)
    expect(cleaned).toContain('Chrome/122.0.6261.156')
    expect(cleaned).toContain('Safari/537.36')
    expect(cleaned).not.toMatch(/Electron/i)
    expect(cleaned).not.toContain(APP)
  })

  it('collapses the whitespace left by the removals (no doubled spaces)', () => {
    const cleaned = stripUserAgentTokens(ELECTRON_UA, APP)
    expect(cleaned).not.toMatch(/ {2,}/)
  })

  it('handles the default-app-name case where the token is just Electron/<ver>', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Electron/43.1.1 Safari/537.36'
    // No app-name token to strip here; only the Electron token should go.
    expect(stripUserAgentTokens(ua, 'Electron')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/122.0.0.0 Safari/537.36'
    )
  })

  it('is a no-op on a UA that has neither token', () => {
    const plain =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36'
    expect(stripUserAgentTokens(plain, APP)).toBe(plain)
  })

  it('tolerates a missing app name argument', () => {
    expect(stripUserAgentTokens(ELECTRON_UA)).not.toMatch(/Electron/i)
  })
})
