import { parsePls } from '@shared/plsParser'
import type { ResolveStreamResult } from '@shared/ipc'
import { getStreamById } from './config'
import { browserUserAgent, httpGet } from './http'

// Stream resolution — the main-process half of "make a LiveATC .pls playable".
//
// LiveATC serves a `.pls` playlist whose File1 points at a load-balancer host
// (e.g. http://d.liveatc.net/kosh_twr) that 302-redirects to a rotating stream
// host with a fresh nocache token (e.g. https://s1-fmt2.liveatc.net/kosh_twr?
// nocache=...). We must:
//   1. fetch the .pls with a browser User-Agent (LiveATC + its Cloudflare front
//      reject bot/bare UAs — this is load-bearing, see CLAUDE.md),
//   2. parse File1,
//   3. follow the redirect chain and capture the FINAL (https) URL, so the
//      <audio> element loads a direct, secure-origin stream, and
//   4. cache it per stream id, re-resolving fresh on every reconnect so each
//      reconnect lands on a fresh rotating host (the redirect carries nocache).
//
// The HTTP mechanics (browser UA, net.request, redirect tracking) live in
// ./http.ts, shared with the search-page directory fetch.

/** Cache of resolved final URLs, keyed by stream id. Cleared per {fresh:true}. */
const cache = new Map<string, { finalUrl: string; title: string }>()

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Resolve a stream id to a playable final URL. Cached per id; pass
 * `{ fresh: true }` to bypass the cache (every reconnect does, so it re-lands on
 * a fresh rotating host). Returns a typed result — never throws across IPC — so
 * the renderer can turn a failure into a status-chip state with a real message.
 */
export async function resolveStream(
  streamId: string,
  opts?: { fresh?: boolean }
): Promise<ResolveStreamResult> {
  const fresh = opts?.fresh ?? false

  const stream = getStreamById(streamId)
  if (!stream) {
    return {
      ok: false,
      streamId,
      kind: 'notfound',
      error: `stream "${streamId}" is not in the current config`
    }
  }

  if (!fresh) {
    const hit = cache.get(streamId)
    if (hit) return { ok: true, streamId, finalUrl: hit.finalUrl, title: hit.title }
  }

  const ua = browserUserAgent()

  // 1. Fetch the .pls playlist text.
  let plsBody: string
  try {
    const res = await httpGet(stream.plsUrl, ua, true)
    if (res.statusCode >= 400) {
      return {
        ok: false,
        streamId,
        kind: 'network',
        error: `fetching the playlist ${stream.plsUrl} returned HTTP ${res.statusCode}`
      }
    }
    plsBody = res.body ?? ''
  } catch (err: unknown) {
    return {
      ok: false,
      streamId,
      kind: 'network',
      error: `could not fetch the playlist ${stream.plsUrl}: ${errMessage(err)}`
    }
  }

  // 2. Parse File1 out of it.
  let entryUrl: string
  let entryTitle: string | null
  try {
    const entry = parsePls(plsBody)
    entryUrl = entry.url
    entryTitle = entry.title
  } catch (err: unknown) {
    return {
      ok: false,
      streamId,
      kind: 'parse',
      error: `could not parse the playlist ${stream.plsUrl}: ${errMessage(err)}`
    }
  }

  // 3. Follow the redirect chain to the final (https) stream URL.
  let finalUrl: string
  try {
    const res = await httpGet(entryUrl, ua, false)
    if (res.statusCode >= 400) {
      return {
        ok: false,
        streamId,
        kind: 'network',
        error: `the stream host for "${stream.label}" returned HTTP ${res.statusCode}`
      }
    }
    finalUrl = res.finalUrl
  } catch (err: unknown) {
    return {
      ok: false,
      streamId,
      kind: 'network',
      error: `could not reach the stream host for "${stream.label}": ${errMessage(err)}`
    }
  }

  const title = entryTitle ?? stream.label
  cache.set(streamId, { finalUrl, title })
  return { ok: true, streamId, finalUrl, title }
}

/** Drop a cached resolution (or all of them). Used when config reloads. */
export function clearResolveCache(streamId?: string): void {
  if (streamId) cache.delete(streamId)
  else cache.clear()
}
