import { app, net } from 'electron'
import { stripUserAgentTokens } from '@shared/userAgent'
import { parsePls } from '@shared/plsParser'
import type { ResolveStreamResult } from '@shared/ipc'
import { getStreamById } from './config'

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
// NOTE (deviation from the brief's "net.fetch / response.url"): Electron's
// net.fetch documents `.url` on the returned Response as unreliable, so it can't
// report the post-redirect URL. We use net.request instead and track each hop's
// redirectUrl from the 'redirect' event — which reliably yields the final URL —
// and set the User-Agent via setHeader (net.request honours it, whereas the DOM
// fetch spec forbids scripts from setting User-Agent). Same intent, correct
// mechanism.

/** Cache of resolved final URLs, keyed by stream id. Cleared per {fresh:true}. */
const cache = new Map<string, { finalUrl: string; title: string }>()

/** Milliseconds before a resolve step (fetch or redirect-follow) gives up. */
const REQUEST_TIMEOUT_MS = 10_000

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A browser-like UA (Electron/app tokens stripped) — LiveATC rejects bot UAs. */
function browserUserAgent(): string {
  return stripUserAgentTokens(app.userAgentFallback, app.getName())
}

interface HttpResult {
  statusCode: number
  /** The final URL after following any redirects. */
  finalUrl: string
  /** The response body, only when `readBody` was requested. */
  body?: string
}

/**
 * GET `url` with a browser UA, following redirects. Tracks each hop so the final
 * URL is reported reliably. When `readBody` is false (resolving a live stream)
 * the (endless) response body is never drained — we take the headers and final
 * URL, then abort immediately so we don't hold a stream socket open.
 */
function httpGet(url: string, ua: string, readBody: boolean): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    let finalUrl = url
    let settled = false

    const request = net.request({ method: 'GET', url, redirect: 'follow' })
    request.setHeader('User-Agent', ua)
    request.setHeader('Accept', '*/*')

    const timer = setTimeout(() => {
      finish(() => {
        safeAbort()
        reject(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`))
      })
    }, REQUEST_TIMEOUT_MS)

    function finish(fn: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    function safeAbort(): void {
      try {
        request.abort()
      } catch {
        /* already closed — ignore */
      }
    }

    // redirect: 'follow' auto-follows; the event is informational — we use it to
    // capture the URL of each hop so `finalUrl` ends on the last one.
    request.on('redirect', (_status, _method, redirectUrl) => {
      finalUrl = redirectUrl
    })

    request.on('response', (response) => {
      const statusCode = response.statusCode
      if (readBody) {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          finish(() =>
            resolve({ statusCode, finalUrl, body: Buffer.concat(chunks).toString('utf8') })
          )
        )
        response.on('error', (err: Error) => finish(() => reject(err)))
      } else {
        // Headers are all we need. We never add a 'data' listener, so the body
        // stays paused (never buffered); aborting the request cuts the socket.
        response.on('error', () => {
          /* aborting mid-stream can surface an error; ignore it */
        })
        finish(() => {
          resolve({ statusCode, finalUrl })
          safeAbort()
        })
      }
    })

    request.on('error', (err: Error) => finish(() => reject(err)))
    request.end()
  })
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
