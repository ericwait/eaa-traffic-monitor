import { useCallback, useEffect, useRef } from 'react'
import type { Fr24Bounds } from '@shared/ipc'
import { boundsEqual, rectToBounds } from '@shared/fr24Bounds'
import { useAppStore, FR24_RELAYOUT_EVENT } from '../state/store'

// The Flight Tracking panel: a toolbar plus a NON-SCROLLING placeholder region
// that the native FR24 WebContentsView is positioned over. The renderer never
// draws the map — it measures where the map should be and tells the main process
// via fr24:setBounds. The bounds math assumes no scroll offset, hence the
// region must never scroll (see the CSS: overflow hidden, fixed to the panel).

/**
 * Report the region's current rect to the main process as FR24 view bounds.
 * rAF-throttled, trailing-edge: many resize callbacks in one frame collapse into
 * a single measurement taken at frame time (the freshest layout), which tracks
 * the divider smoothly. A debounce here would read as jank, so we don't use one.
 */
function Fr24Panel(): React.JSX.Element {
  const navState = useAppStore((s) => s.navState)
  const regionRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastSentRef = useRef<Fr24Bounds | null>(null)

  const measure = useCallback((): void => {
    rafRef.current = null
    const el = regionRef.current
    if (!el) return
    const bounds = rectToBounds(el.getBoundingClientRect())
    // Skip redundant IPC when the rounded bounds didn't actually change.
    if (lastSentRef.current && boundsEqual(lastSentRef.current, bounds)) return
    lastSentRef.current = bounds
    window.api.fr24.setBounds(bounds)
    if (import.meta.env.DEV) console.debug('[fr24] setBounds', bounds)
  }, [])

  const scheduleMeasure = useCallback((): void => {
    if (rafRef.current != null) return // already scheduled this frame
    rafRef.current = requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    const el = regionRef.current
    if (!el) return
    scheduleMeasure() // initial sync once mounted

    // ResizeObserver catches size changes from panel-divider drags and window
    // resizes (the region box changes size). The window 'resize' and the layout
    // relayout event are belt-and-suspenders for the rare case where the region
    // moves without its own box changing size.
    const ro = new ResizeObserver(scheduleMeasure)
    ro.observe(el)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener(FR24_RELAYOUT_EVENT, scheduleMeasure)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener(FR24_RELAYOUT_EVENT, scheduleMeasure)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleMeasure])

  const nav = window.api.fr24.nav

  return (
    <section className="fr24-panel" aria-label="Flight Tracking">
      <header className="panel-head">
        <h2 className="panel-title">Flight Tracking</h2>
      </header>

      <div
        className="fr24-toolbar"
        data-testid="fr24-toolbar"
        role="toolbar"
        aria-label="FlightRadar24 navigation"
      >
        <button
          type="button"
          className="fr24-btn"
          aria-label="Back"
          title="Back"
          disabled={!navState.canGoBack}
          onClick={() => nav('back')}
        >
          &#8249;
        </button>
        <button
          type="button"
          className="fr24-btn"
          aria-label="Forward"
          title="Forward"
          disabled={!navState.canGoForward}
          onClick={() => nav('forward')}
        >
          &#8250;
        </button>
        <button
          type="button"
          className="fr24-btn"
          aria-label="Reload"
          title="Reload"
          onClick={() => nav('reload')}
        >
          &#8635;
        </button>
        <button
          type="button"
          className="fr24-btn"
          aria-label="Home"
          title="Home (Oshkosh view)"
          onClick={() => nav('home')}
        >
          &#8962;
        </button>
        <div className="fr24-url" aria-label="Current URL" title={navState.url}>
          <span
            className={`fr24-loading${navState.isLoading ? ' is-loading' : ''}`}
            aria-hidden="true"
          />
          <span className="fr24-url-text">{navState.url || 'about:blank'}</span>
        </div>
      </div>

      {/*
        The native FR24 view is composited over this region. The placeholder text
        shows only when the view is hidden (an overlay is up) or before it paints;
        the map covers it otherwise.
      */}
      <div className="fr24-region" ref={regionRef}>
        <p className="fr24-region-hint">FlightRadar24 loading…</p>
      </div>
    </section>
  )
}

export default Fr24Panel
