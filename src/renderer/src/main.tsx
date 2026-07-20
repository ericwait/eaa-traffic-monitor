import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import PopoutApp from './PopoutApp'
import {
  hydrateVideoLayout,
  loadSessionSnapshot,
  startPopoutFeedTracking,
  startVideoLayoutPersistence
} from './state/sessionBootstrap'
// Bundled woff2 @font-face declarations (Barlow Semi Condensed + Inter),
// committed as binaries — no CDN, so the app stays usable offline at the
// airfield (decision 2026-07-19; see docs/WYVERN-RESKIN-PLAN.md Step 2 and
// docs/decisions/README.md). Loads before tokens.css so the font-family stacks
// tokens.css declares resolve to these faces rather than the system fallback
// on first paint.
import './assets/fonts.css'
// Canonical import of the Wyvern Watch design tokens straight from design/brand
// — never copied into src/renderer — so there is exactly one source of truth for
// the color/type/motion system. Vite bundles CSS imports at build time, so this
// path outside the renderer root works in both dev and the packaged loopback
// build (decision 2026-07-19; see docs/decisions/README.md and
// docs/WYVERN-RESKIN-PLAN.md Step 1). Must load BEFORE main.css so main.css's
// compatibility alias layer can re-point at the semantic --color-* variables.
import '../../../design/brand/tokens.css'
import './assets/main.css'

// The persisted session is fetched once, before React mounts, so panel-layout
// and video-layout restore hydrate synchronously (no default-then-restore flash).
// The launch URL role then decides which app to mount: the full three-panel App
// (main window) or the grid-only PopoutApp (a `?window=popout&id=N` window).
async function bootstrap(): Promise<void> {
  await loadSessionSnapshot()

  const container = document.getElementById('root')
  if (!container) {
    // Should be impossible — index.html always ships #root — but a bare crash
    // here would be an inscrutable white window at 6 a.m. Say what went wrong.
    throw new Error('[renderer] #root element not found in index.html; cannot mount the React app')
  }

  const isPopout = window.api.windows.role === 'popout'
  if (!isPopout) {
    // Main-window-only wiring: seed + persist the video layout, and track which
    // feeds are handed off to open pop-outs so the grid hides/returns them.
    hydrateVideoLayout()
    startVideoLayoutPersistence()
    startPopoutFeedTracking()
  }

  createRoot(container).render(<StrictMode>{isPopout ? <PopoutApp /> : <App />}</StrictMode>)
}

void bootstrap()
