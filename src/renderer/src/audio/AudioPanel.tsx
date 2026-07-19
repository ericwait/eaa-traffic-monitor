import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { audioEngine } from './engine'
import StreamStrip from './StreamStrip'

// The ATC Audio panel — the left pillar. Owns the panel header ("ATC Audio" +
// a reload-config button), the config-fallback banner, the autoplay "click to
// enable" hint, and the list of per-stream strips. All live state comes from the
// zustand audio slice, which the engine (a plain-TS singleton) writes into; this
// component only reads it and forwards user gestures to the engine.

function AudioPanel(): React.JSX.Element {
  const order = useAppStore((s) => s.audioOrder)
  const banner = useAppStore((s) => s.audioBanner)
  const needsGesture = useAppStore((s) => s.audioNeedsGesture)
  const setBanner = useAppStore((s) => s.setAudioBanner)
  const soloId = useAppStore((s) => s.audioSolo)

  // Build + start the engine once. ensureStarted is StrictMode-safe and the
  // engine lives for the window's life, so there is deliberately no teardown on
  // unmount — Web Audio can't span processes and this is the audio authority.
  useEffect(() => {
    void audioEngine.ensureStarted()
  }, [])

  // Escape releases a held solo. Guarded on soloId so this never swallows an
  // Escape meant for another surface (e.g. the video fill-panel) when no solo is
  // active — it only acts when there is a solo to release.
  useEffect(() => {
    if (soloId === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') audioEngine.setSolo(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [soloId])

  return (
    <section className="audio-panel" aria-label="ATC Audio">
      <header className="panel-head audio-head">
        <h2 className="panel-title">ATC Audio</h2>
        <div className="audio-head-spacer" />
        <button
          type="button"
          className="audio-reload-btn"
          data-testid="audio-reload"
          // Accessible name deliberately avoids the word "Reload" so it does not
          // collide with the FR24 toolbar's "Reload" button in role-name queries.
          aria-label="Refresh config from disk"
          title="Re-read config.json from disk"
          onClick={() => void audioEngine.reload()}
        >
          &#8635;
        </button>
      </header>

      {banner && (
        <div className="audio-banner" role="alert" data-testid="config-banner">
          <div className="audio-banner-text">
            <strong>Using default config.</strong> {banner.message}
            <span className="audio-banner-path" title={banner.filePath}>
              {banner.filePath}
            </span>
          </div>
          <button
            type="button"
            className="audio-banner-dismiss"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setBanner(null)}
          >
            &times;
          </button>
        </div>
      )}

      {needsGesture && (
        <div className="audio-hint" data-testid="audio-gesture-hint">
          Click anywhere to enable audio.
        </div>
      )}

      <div className="stream-list">
        {order.map((id) => (
          <StreamStrip key={id} id={id} />
        ))}
      </div>
    </section>
  )
}

export default AudioPanel
