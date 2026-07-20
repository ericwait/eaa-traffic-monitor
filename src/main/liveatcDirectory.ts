import type { LiveAtcSearchResult } from '@shared/ipc'
import { parseLiveAtcSearch } from '@shared/liveatcDirectory'
import { KOSH_FALLBACK_FEEDS, KOSH_FALLBACK_QUERIES } from '@shared/koshFallback'
import { browserUserAgent, httpGet } from './http'

// The main-process half of the channel manager's "what can I listen to?"
// directory: fetch https://www.liveatc.net/search/?icao=<icao> (browser UA via
// ./http — a bare/bot client gets a Cloudflare block page) and parse it with the
// pure shared parser.
//
// Politeness contract (same spirit as the .pls rule in CLAUDE.md): results are
// cached per ICAO and only re-fetched when the cache is stale or the operator
// explicitly refreshes ({ fresh: true }). The page is only ever requested from
// an operator gesture (opening the Add-channel dialog / clicking refresh) —
// never on a timer.

/** How long a fetched directory stays fresh. */
const CACHE_TTL_MS = 10 * 60_000

interface CacheEntry {
  fetchedAt: number
  result: Extract<LiveAtcSearchResult, { ok: true }>
}

/** Cache of parsed directories, keyed by normalised ICAO query. */
const cache = new Map<string, CacheEntry>()

/** LiveATC's search accepts loose station queries ("osh", "kosh", "egll"). */
const ICAO_QUERY = /^[a-z0-9]{2,8}$/

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Resolve a live-search failure: for the monitored airport (osh/kosh) serve the
 * bundled snapshot instead — at the show, "LiveATC's directory is unreachable"
 * must not mean "no channels can be added" (decision 2026-07-19). Marked
 * `source: 'bundled'` (the dialog says so) and never cached, so the next
 * gesture tries LiveATC again. Every other airport reports the failure.
 */
function failOrFallback(failure: Extract<LiveAtcSearchResult, { ok: false }>): LiveAtcSearchResult {
  if (!KOSH_FALLBACK_QUERIES.has(failure.icao)) return failure
  console.warn(
    `[liveatc] search for "${failure.icao}" failed (${failure.error}) — serving the bundled KOSH list`
  )
  return {
    ok: true,
    icao: failure.icao,
    feeds: [...KOSH_FALLBACK_FEEDS],
    fetchedAt: Date.now(),
    source: 'bundled'
  }
}

/**
 * Fetch + parse the LiveATC feed directory for one airport query. Returns a
 * typed result — never throws across IPC. Pass `{ fresh: true }` to bypass the
 * cache (the dialog's refresh button).
 */
export async function searchLiveAtc(
  icao: string,
  opts?: { fresh?: boolean }
): Promise<LiveAtcSearchResult> {
  const query = icao.trim().toLowerCase()
  if (!ICAO_QUERY.test(query)) {
    return {
      ok: false,
      icao: query,
      kind: 'unknown',
      error: `"${icao}" is not a searchable station code (2–8 letters/digits)`
    }
  }

  if (!opts?.fresh) {
    const hit = cache.get(query)
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.result
  }

  const url = `https://www.liveatc.net/search/?icao=${encodeURIComponent(query)}`

  let body: string
  try {
    const res = await httpGet(url, browserUserAgent(), true)
    if (res.statusCode >= 400) {
      return failOrFallback({
        ok: false,
        icao: query,
        kind: 'network',
        error: `LiveATC search returned HTTP ${res.statusCode}`
      })
    }
    body = res.body ?? ''
  } catch (err: unknown) {
    return failOrFallback({
      ok: false,
      icao: query,
      kind: 'network',
      error: `could not reach LiveATC search: ${errMessage(err)}`
    })
  }

  const feeds = parseLiveAtcSearch(body)

  // Zero feeds from a 200 usually means "no feeds for this station", but it is
  // also what a Cloudflare interstitial or a page redesign parses to — say so,
  // as a typed failure, instead of showing a silently empty list.
  if (feeds.length === 0) {
    const blocked = /attention required|you have been blocked|cf-error-details/i.test(body)
    return failOrFallback({
      ok: false,
      icao: query,
      kind: blocked ? 'network' : 'notfound',
      error: blocked
        ? 'LiveATC is blocking automated access right now (Cloudflare) — try again later'
        : `no LiveATC feeds found for "${query}" (or the page layout changed)`
    })
  }

  const result: Extract<LiveAtcSearchResult, { ok: true }> = {
    ok: true,
    icao: query,
    feeds,
    fetchedAt: Date.now(),
    source: 'live'
  }
  cache.set(query, { fetchedAt: result.fetchedAt, result })
  return result
}

/** Drop cached directories (all of them). Used by tests and config reloads. */
export function clearLiveAtcCache(): void {
  cache.clear()
}
