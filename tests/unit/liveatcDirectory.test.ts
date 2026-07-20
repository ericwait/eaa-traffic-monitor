import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLiveAtcSearch } from '../../src/shared/liveatcDirectory'

// The fixture is a real https://www.liveatc.net/search/?icao=osh response,
// captured through Electron net.request on 2026-07-19. If LiveATC redesigns the
// page these tests fail loudly — recapture the fixture and adjust the parser.
const fixture = readFileSync(new URL('./fixtures/liveatc-search-osh.html', import.meta.url), 'utf8')

describe('parseLiveAtcSearch', () => {
  it('finds every .pls feed on the captured OSH page, deduplicated by mount', () => {
    const feeds = parseLiveAtcSearch(fixture)
    const mounts = feeds.map((f) => f.mount)
    expect(new Set(mounts).size).toBe(mounts.length)
    // The capture had 24 distinct mounts; assert a floor rather than the exact
    // count so a LiveATC feed being added/retired doesn't fail the suite.
    expect(feeds.length).toBeGreaterThanOrEqual(20)
    expect(mounts).toContain('kosh_twr')
    expect(mounts).toContain('kosh_guard')
    expect(mounts).toContain('zau_osh')
  })

  it('extracts the human name, status, and pls URL for a known feed', () => {
    const feeds = parseLiveAtcSearch(fixture)
    const guard = feeds.find((f) => f.mount === 'kosh_guard')
    expect(guard).toBeDefined()
    expect(guard?.name).toBe('KOSH Emergency/Guard')
    expect(guard?.status).toBe('up')
    expect(guard?.plsUrl).toBe('https://www.liveatc.net/play/kosh_guard.pls')
  })

  it('extracts listener counts and frequency tables', () => {
    const feeds = parseLiveAtcSearch(fixture)
    const guard = feeds.find((f) => f.mount === 'kosh_guard')
    expect(guard?.listeners).toBeGreaterThanOrEqual(0)
    expect(guard?.frequencies).toEqual([{ facility: 'Emergency/Guard', frequencyMhz: '121.500' }])
  })

  it('parses every feed with a non-empty name and a well-formed pls URL', () => {
    for (const feed of parseLiveAtcSearch(fixture)) {
      expect(feed.name.length).toBeGreaterThan(0)
      expect(feed.name).not.toMatch(/[<>]/)
      expect(feed.plsUrl).toMatch(/^https:\/\/www\.liveatc\.net\/play\/[A-Za-z0-9_.-]+\.pls$/)
      expect(feed.status === 'up' || feed.status === 'down').toBe(true)
    }
  })

  it('returns [] on unrecognisable input instead of throwing', () => {
    expect(parseLiveAtcSearch('')).toEqual([])
    expect(parseLiveAtcSearch('<html><body>Sorry, you have been blocked</body></html>')).toEqual([])
    expect(parseLiveAtcSearch('not html at all')).toEqual([])
  })

  it('skips blocks without a .pls link and tolerates a missing title', () => {
    const html = [
      '<table class="body"><tr><td>search form, no pls here</td></tr></table>',
      '<table class="body"><tr><td><a href="/play/test_mount.pls">listen</a></td></tr></table>'
    ].join('\n')
    const feeds = parseLiveAtcSearch(html)
    expect(feeds).toHaveLength(1)
    // Name falls back to the mount; an unparsable status reads as down (never a
    // false "up" that invites connecting to a dead feed).
    expect(feeds[0]).toMatchObject({ mount: 'test_mount', name: 'test_mount', status: 'down' })
  })
})
