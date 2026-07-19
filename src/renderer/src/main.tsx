import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import {
  hydrateVideoLayout,
  loadSessionSnapshot,
  startVideoLayoutPersistence
} from './state/sessionBootstrap'
import './assets/main.css'

// The persisted session is fetched once, before React mounts, so panel-layout
// and video-layout restore hydrate synchronously (no default-then-restore flash).
// Only then is the app rendered.
async function bootstrap(): Promise<void> {
  await loadSessionSnapshot()

  // Seed the store's video layout from the session, then start persisting changes.
  hydrateVideoLayout()
  startVideoLayoutPersistence()

  const container = document.getElementById('root')
  if (!container) {
    // Should be impossible — index.html always ships #root — but a bare crash
    // here would be an inscrutable white window at 6 a.m. Say what went wrong.
    throw new Error('[renderer] #root element not found in index.html; cannot mount the React app')
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
