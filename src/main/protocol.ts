import { protocol, net } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'

// The scheme name the packaged renderer is served from. Kept in one place so
// the privileged registration (index.ts) and the handler (below) can never
// disagree about the string.
export const APP_SCHEME = 'app'

// Fixed host for the packaged renderer. For a `standard` scheme the authority
// (host) segment is meaningful, so we pin a stable one and key routing off the
// pathname alone. The main window loads APP_ORIGIN + '/index.html'; the
// renderer's own relative asset URLs (base: './') then resolve as
// app://bundle/assets/... under the same origin.
export const APP_HOST = 'bundle'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

// Root of the packaged renderer output. electron-vite emits the renderer to
// out/renderer, and the compiled main entry runs from out/main, so the
// renderer sits one directory up and over.
const RENDERER_ROOT = join(__dirname, '../renderer')

/**
 * Wire `app://` to the packaged renderer on disk.
 *
 * Requests like `app://index.html` or `app://assets/index-abc.js` are mapped
 * to files under out/renderer and streamed back via net.fetch(fileURL). Using
 * a privileged (standard + secure) scheme gives the packaged renderer a secure
 * origin — a hard requirement for the YouTube IFrame API handshake and for
 * enumerateDevices()/setSinkId() in the production build.
 *
 * Must be called after app `ready` (protocol.handle requires a ready app).
 */
export function registerAppScheme(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    let requestPath: string
    try {
      const { pathname } = new URL(request.url)
      // Decode percent-encoding, then strip the leading slash so join() treats
      // it as relative to the renderer root.
      requestPath = decodeURIComponent(pathname).replace(/^\/+/, '')
    } catch (err: unknown) {
      console.error(`[protocol] malformed app:// URL "${request.url}":`, err)
      return new Response('Bad Request', { status: 400 })
    }

    // Bare origin (app://bundle or app://bundle/) resolves to the SPA entry.
    if (requestPath === '') {
      requestPath = 'index.html'
    }

    // Path-traversal guard: resolve against the renderer root and confirm the
    // result stays inside it. A crafted `app://../../etc/passwd` must not
    // escape the bundle.
    const resolved = normalize(join(RENDERER_ROOT, requestPath))
    if (!resolved.startsWith(normalize(RENDERER_ROOT))) {
      console.error(
        `[protocol] blocked path traversal outside renderer root: "${request.url}" -> "${resolved}"`
      )
      return new Response('Forbidden', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(resolved).toString())
    } catch (err: unknown) {
      console.error(`[protocol] failed to serve "${request.url}" from "${resolved}":`, err)
      return new Response('Not Found', { status: 404 })
    }
  })
}
