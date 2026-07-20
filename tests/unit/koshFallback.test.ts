import { describe, expect, it } from 'vitest'
import { KOSH_FALLBACK_FEEDS, KOSH_FALLBACK_QUERIES } from '../../src/shared/koshFallback'

// The bundled KOSH directory (the Add-channel dialog's offline fallback). The
// data itself is a curated snapshot (koshFallback.json); these tests pin the
// mapping invariants the dialog and engine rely on, not the exact feed set.

describe('KOSH_FALLBACK_FEEDS', () => {
  it('answers for the osh/kosh queries', () => {
    expect(KOSH_FALLBACK_QUERIES.has('osh')).toBe(true)
    expect(KOSH_FALLBACK_QUERIES.has('kosh')).toBe(true)
  })

  it('is a non-trivial list with unique mounts and plsUrls', () => {
    expect(KOSH_FALLBACK_FEEDS.length).toBeGreaterThanOrEqual(20)
    const mounts = KOSH_FALLBACK_FEEDS.map((f) => f.mount)
    expect(new Set(mounts).size).toBe(mounts.length)
    const urls = KOSH_FALLBACK_FEEDS.map((f) => f.plsUrl)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('derives each mount from its plsUrl', () => {
    for (const feed of KOSH_FALLBACK_FEEDS) {
      expect(feed.plsUrl).toBe(`https://www.liveatc.net/play/${feed.mount}.pls`)
    }
  })

  it('never claims a live status for a snapshot', () => {
    for (const feed of KOSH_FALLBACK_FEEDS) {
      expect(feed.status).toBe('unknown')
      expect(feed.listeners).toBeNull()
    }
  })

  it('keeps the curation order: Guard first, Air Boss next', () => {
    expect(KOSH_FALLBACK_FEEDS[0]?.name).toBe('Emergency/Guard')
    expect(KOSH_FALLBACK_FEEDS[1]?.name).toBe('Air Boss 1')
  })
})
