import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './assets/main.css'

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
