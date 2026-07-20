// Pure parser for a LiveATC search-results page (https://www.liveatc.net/search/
// ?icao=...). LiveATC has no JSON API; the channel-manager UI is built on this
// page instead, fetched main-side (browser UA — see CLAUDE.md) and parsed here.
// Kept pure (no Electron, no DOM, no I/O) so the exact parse — and its tolerance
// for that page's 1990s table soup — is unit-testable against a saved fixture.
//
// Page shape (captured 2026-07-19, tests/unit/fixtures/liveatc-search-osh.html):
// each feed is a `<table class="body">` block containing
//   <td bgcolor="lightblue"><strong>KOSH Tower (North+South) #1</strong></td>
//   <strong>Feed Status:</strong> <font color="green"><strong>UP</strong></font>
//     &nbsp;&nbsp;<strong>Listeners:</strong> 1137
//   <a href="/play/kosh_twr.pls" ...>
// followed by a sibling `<table class="freqTable">` of facility/frequency rows.
//
// Tolerance contract: a feed block missing a name or status still parses (with
// fallbacks) as long as it has a `.pls` link; a page with no recognisable feed
// blocks parses to []. The caller decides whether [] is "no results" or "the
// page layout changed" — this module never throws on weird input.

/** One row of a feed's frequency table. */
export interface LiveAtcFrequency {
  /** Facility name, e.g. "Oshkosh Approach (Fisk)". */
  facility: string
  /** Frequency as printed, e.g. "120.700" (MHz). */
  frequencyMhz: string
}

/** One listenable feed scraped from a LiveATC search page. */
export interface LiveAtcFeed {
  /** The mount id, e.g. "kosh_twr" — unique per feed and stable over time. */
  mount: string
  /** Absolute `.pls` playlist URL, ready to use as a stream's plsUrl. */
  plsUrl: string
  /** Human feed name, e.g. "KOSH Tower (North+South) #1". */
  name: string
  /**
   * Whether LiveATC reports the feed as broadcasting right now. 'unknown' only
   * on bundled-fallback entries (see koshFallback.ts) — a snapshot can't know.
   */
  status: 'up' | 'down' | 'unknown'
  /** Current listener count if printed, else null. */
  listeners: number | null
  /** The feed's frequency table (may be empty). */
  frequencies: LiveAtcFrequency[]
}

/** Decode the handful of HTML entities that actually occur in feed names. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .trim()
}

// Segment boundary: each feed lives in its own `<table class="body">`. The
// attribute order/spacing is theirs to change, so match loosely on the class.
const FEED_TABLE_SPLIT = /<table[^>]*class="body"[^>]*>/gi

// The `.pls` link inside a block. Mount charset is conservative-but-observed:
// word chars, dot, dash (e.g. kosh9_depmon_1836, zau_osh).
const PLS_LINK = /\/play\/([A-Za-z0-9_.-]+)\.pls/

// The lightblue title cell.
const FEED_NAME = /bgcolor="lightblue"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i

// "Feed Status:" then UP/DOWN inside whatever font/strong wrapping.
const FEED_STATUS = /Feed Status:[\s\S]{0,120}?\b(UP|DOWN)\b/i

// "Listeners:" then an integer.
const LISTENERS = /Listeners:\s*<\/strong>\s*(\d+)|Listeners:\s*(\d+)/i

// One freqTable row: facility cell (class td0/td1) then bolded frequency cell.
const FREQ_ROW = /<td class="td[01]">([\s\S]*?)<\/td>\s*<td>\s*<b>([\s\S]*?)<\/b>/gi

/**
 * Parse a LiveATC search-results page into its listenable feeds.
 *
 * Feeds are returned in page order (LiveATC groups them sensibly), deduplicated
 * by mount. Blocks without a `.pls` link (page header, ads, the search form)
 * are skipped. Never throws; unrecognisable input yields `[]`.
 */
export function parseLiveAtcSearch(html: string): LiveAtcFeed[] {
  const segments = html.split(FEED_TABLE_SPLIT)
  const feeds: LiveAtcFeed[] = []
  const seen = new Set<string>()

  // segments[0] is everything before the first feed table — never a feed.
  for (const segment of segments.slice(1)) {
    const pls = PLS_LINK.exec(segment)
    if (!pls) continue
    const mount = pls[1]
    if (seen.has(mount)) continue
    seen.add(mount)

    const nameMatch = FEED_NAME.exec(segment)
    const name = nameMatch ? decodeEntities(nameMatch[1].replace(/<[^>]*>/g, '')) : mount

    const statusMatch = FEED_STATUS.exec(segment)
    const status: LiveAtcFeed['status'] =
      statusMatch && statusMatch[1].toUpperCase() === 'UP' ? 'up' : 'down'

    const listenersMatch = LISTENERS.exec(segment)
    const listeners = listenersMatch ? Number(listenersMatch[1] ?? listenersMatch[2]) : null

    const frequencies: LiveAtcFrequency[] = []
    for (const row of segment.matchAll(FREQ_ROW)) {
      const facility = decodeEntities(row[1].replace(/<[^>]*>/g, ''))
      const frequencyMhz = decodeEntities(row[2].replace(/<[^>]*>/g, ''))
      if (facility.length > 0 && frequencyMhz.length > 0) {
        frequencies.push({ facility, frequencyMhz })
      }
    }

    feeds.push({
      mount,
      plsUrl: `https://www.liveatc.net/play/${mount}.pls`,
      name: name.length > 0 ? name : mount,
      status,
      listeners: listeners !== null && Number.isFinite(listeners) ? listeners : null,
      frequencies
    })
  }

  return feeds
}
