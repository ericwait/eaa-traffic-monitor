import { createServer } from 'http'
import type { IncomingMessage, ServerResponse, Server } from 'http'
import type { AddressInfo } from 'net'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname, join, normalize, sep } from 'path'

// Loopback renderer server (decision 2026-07-19). The packaged renderer is
// served over a real http(s) origin — a tiny Node http server bound to
// 127.0.0.1 on an ephemeral port — instead of the app:// custom scheme.
//
// Why: the YouTube IFrame Player API validates the embedding origin, and under
// app:// it rejects our tiles with error 153 (verified in Phase 3) — YT accepts
// only http(s) origins. Everything else (device routing, the postMessage
// handshake for LiveATC/analysis) already worked; this is specifically the
// YouTube-embed origin fix. app:// stays registered as a logged degraded
// fallback for the (unexpected) case where the loopback bind fails — see
// src/main/index.ts. No new dependency: Node's built-in http + fs only.

// Root of the packaged renderer output. electron-vite emits the renderer to
// out/renderer; the compiled main entry runs from out/main, so the renderer
// sits one directory up and over — identical to protocol.ts.
const RENDERER_ROOT = join(__dirname, '../renderer')

// Extension -> Content-Type for the file types the renderer bundle emits. An
// unknown extension falls back to application/octet-stream (the browser then
// sniffs / downloads rather than mis-executing it).
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
}

/** A started loopback server: the base origin to load, and a way to shut it down. */
export interface RendererServer {
  /** The base origin, e.g. `http://127.0.0.1:53421` (no trailing slash). */
  url: string
  /** Stop listening and release the port. Safe to call once, on quit. */
  close: () => void
}

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Map a request URL to a file under the renderer root and stream it back. The
 * bare path ('/') resolves to the SPA entry; a path-traversal attempt is blocked
 * with the same guard pattern as protocol.ts; a miss is a logged, contextful 404.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' })
    res.end('Method Not Allowed')
    return
  }

  let requestPath: string
  try {
    // req.url is an origin-relative path (e.g. /assets/index-abc.js?v=1). Parse
    // it against a dummy base to strip the query/hash, then decode + de-slash so
    // join() treats it as relative to the renderer root.
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1')
    requestPath = decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch (err: unknown) {
    console.error(`[rendererServer] malformed request URL "${req.url}":`, err)
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Bad Request')
    return
  }

  // Bare origin resolves to the SPA entry, matching the app:// handler.
  if (requestPath === '') requestPath = 'index.html'

  // Path-traversal guard: resolve against the renderer root and confirm the
  // result stays inside it (same pattern as protocol.ts). The trailing separator
  // on the prefix stops a sibling like `out/renderer-evil` from matching.
  const resolved = normalize(join(RENDERER_ROOT, requestPath))
  const rootPrefix = normalize(RENDERER_ROOT + sep)
  if (resolved !== normalize(RENDERER_ROOT) && !resolved.startsWith(rootPrefix)) {
    console.error(
      `[rendererServer] blocked path traversal outside renderer root: "${req.url}" -> "${resolved}"`
    )
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return
  }

  let size: number
  try {
    const stats = await stat(resolved)
    if (!stats.isFile()) throw new Error('not a regular file')
    size = stats.size
  } catch (err: unknown) {
    console.error(
      `[rendererServer] 404 for "${req.url}" — no file at "${resolved}" ` +
        `(renderer root: "${RENDERER_ROOT}"; did electron-vite build run?):`,
      err
    )
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }

  res.writeHead(200, { 'Content-Type': contentTypeFor(resolved), 'Content-Length': size })
  if (method === 'HEAD') {
    res.end()
    return
  }

  const stream = createReadStream(resolved)
  stream.on('error', (err: unknown) => {
    console.error(`[rendererServer] failed while streaming "${resolved}":`, err)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end()
  })
  stream.pipe(res)
}

/**
 * Start the loopback renderer server. Resolves once it is listening, with the
 * base origin to load and a close(). Rejects (with an actionable message) if the
 * socket can't bind — the caller then logs a warning and falls back to app://.
 */
export function startRendererServer(): Promise<RendererServer> {
  return new Promise<RendererServer>((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void handleRequest(req, res).catch((err: unknown) => {
        console.error(`[rendererServer] unhandled error serving "${req.url}":`, err)
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end()
      })
    })

    // A bind/listen failure (rare on loopback with an ephemeral port) must not
    // crash the app — reject so the caller falls back to app:// with a warning.
    const onEarlyError = (err: Error): void => {
      reject(new Error(`could not start the loopback renderer server on 127.0.0.1: ${err.message}`))
    }
    server.once('error', onEarlyError)

    // Port 0 = OS-assigned ephemeral port; bind to loopback only (never exposed
    // off-host) so the renderer is not reachable from the network.
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onEarlyError)
      const address = server.address() as AddressInfo | null
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('loopback renderer server bound but reported no port'))
        return
      }
      const url = `http://127.0.0.1:${address.port}`
      console.log(
        `[rendererServer] serving the packaged renderer at ${url} (from ${RENDERER_ROOT})`
      )
      resolve({
        url,
        close: () => {
          server.close((err) => {
            if (err) console.warn('[rendererServer] error while closing:', err)
          })
        }
      })
    })
  })
}
