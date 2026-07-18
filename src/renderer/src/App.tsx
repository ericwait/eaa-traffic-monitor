import { useEffect, useState } from 'react'
import { formatCountdown } from '@shared/format'

// Phase 0 placeholder renderer. The real three-panel layout (audio left, FR24
// top-right, video bottom-right) arrives in Phase 1. This exists only to prove
// the window boots, the renderer mounts, and the app:// / dev-server load path
// both reach a titled dark window (the e2e smoke asserts the title).
function App(): React.JSX.Element {
  const [uptime, setUptime] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setUptime((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="shell">
      <div className="badge">Phase 0 · scaffold</div>
      <h1>EAA Traffic Monitor</h1>
      <p className="tagline">
        Arrange once, then just watch and listen — the unified AirVenture traffic dashboard.
      </p>
      <p className="uptime">
        window up <span>{formatCountdown(uptime)}</span>
      </p>
    </main>
  )
}

export default App
