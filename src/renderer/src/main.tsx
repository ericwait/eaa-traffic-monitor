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
