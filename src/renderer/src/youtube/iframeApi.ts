/// <reference types="youtube" />

// Loads the YouTube IFrame Player API script exactly once per renderer and
// resolves once `onYouTubeIframeAPIReady` fires. Every VideoTile calls
// loadYouTubeIframeApi() on mount; the memoized promise means only the FIRST
// caller inserts the <script> tag and every caller (mounted concurrently, as
// all grid tiles are on the initial render, or sequentially) awaits the same
// promise instance.
//
// The @types/youtube package is d.ts-only and declares the `YT` namespace as a
// pure ambient global (no import/export), so it is pulled in here via the
// triple-slash reference above rather than tsconfig's `types` array — this
// keeps the dependency self-contained to this file instead of a project-wide
// config edit.
//
// Offline / blocked-script handling: if the script tag fails to load (offline,
// ad-blocker, restrictive CSP) or never signals ready within a reasonable
// window, the promise rejects with a clear, actionable error so callers (see
// player.ts) can put their tile into its offline state instead of hanging
// forever or throwing an unhandled rejection. The app must never crash because
// a third-party script did not load.

export type YouTubeNamespace = typeof YT

declare global {
  interface Window {
    /** Set by us before the script loads; the IFrame API calls it once ready. */
    onYouTubeIframeAPIReady?: () => void
    /** Populated by the loaded https://www.youtube.com/iframe_api script. */
    YT?: YouTubeNamespace
  }
}

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

/** How long to wait for the API to signal ready before treating it as failed. */
const READY_TIMEOUT_MS = 15_000

let apiPromise: Promise<YouTubeNamespace> | null = null

/**
 * Load the YouTube IFrame Player API and resolve with the global `YT`
 * namespace once it is ready to construct players.
 *
 * Safe to call from every tile on every mount: the underlying script load
 * happens at most once per renderer lifetime (barring a load failure, which
 * resets the memo so a later retry can try again — see below).
 */
export function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    // Already loaded — e.g. a dev HMR re-mount after a previous success left
    // window.YT populated even though this module's in-memory memo reset.
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      apiPromise = null
      reject(
        new Error(
          `YouTube IFrame API did not become ready within ${READY_TIMEOUT_MS / 1000}s — ` +
            'offline or blocked. Video tiles will show their offline state.'
        )
      )
    }, READY_TIMEOUT_MS)

    // Chain onto any previously-registered handler rather than clobbering it —
    // defensive in case something else on the page also uses the IFrame API.
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = (): void => {
      previousReady?.()
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (window.YT) {
        resolve(window.YT)
      } else {
        apiPromise = null
        reject(new Error('YouTube IFrame API signaled ready but window.YT is missing.'))
      }
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_SRC}"]`)
    if (existing) return // in flight (or previously loaded) — the ready callback above still fires

    const script = document.createElement('script')
    script.src = IFRAME_API_SRC
    script.async = true
    script.onerror = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      apiPromise = null // let a later call retry from scratch instead of staying stuck forever
      script.remove() // so a retry's querySelector-for-existing check doesn't find a dead tag
      reject(
        new Error(
          'YouTube IFrame API script failed to load (offline or blocked?) — ' +
            'video tiles will show their offline state.'
        )
      )
    }
    document.head.appendChild(script)
  })

  return apiPromise
}
