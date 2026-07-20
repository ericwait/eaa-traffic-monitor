import { app, net } from 'electron'
import { stripUserAgentTokens } from '@shared/userAgent'

// Shared main-process HTTP plumbing for talking to LiveATC — used by both the
// .pls stream resolver and the search-page directory fetch. Two rules are
// load-bearing (see CLAUDE.md): every request sends a browser-like User-Agent
// (LiveATC + its Cloudflare front reject bot/bare UAs), and it rides Electron's
// net.request so the TLS/network fingerprint is Chromium's own — a plain
// Node/curl fetch of the same URLs gets a Cloudflare block page (verified
// 2026-07-19 while building the channel manager).
//
// NOTE (deviation from net.fetch): Electron documents `Response.url` from
// net.fetch as unreliable, so it can't report the post-redirect URL. We use
// net.request and track each hop's redirectUrl from the 'redirect' event —
// which reliably yields the final URL — and set the User-Agent via setHeader
// (net.request honours it, whereas the DOM fetch spec forbids scripts from
// setting User-Agent).

/** Milliseconds before a request (fetch or redirect-follow) gives up. */
export const REQUEST_TIMEOUT_MS = 10_000

/** A browser-like UA (Electron/app tokens stripped) — LiveATC rejects bot UAs. */
export function browserUserAgent(): string {
  return stripUserAgentTokens(app.userAgentFallback, app.getName())
}

export interface HttpResult {
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
export function httpGet(url: string, ua: string, readBody: boolean): Promise<HttpResult> {
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
