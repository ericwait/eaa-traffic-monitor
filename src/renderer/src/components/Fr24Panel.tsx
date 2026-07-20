import { useCallback, useEffect, useRef } from 'react'
import type { Fr24Bounds } from '@shared/ipc'
import { boundsEqual, rectToBounds } from '@shared/fr24Bounds'
import { useAppStore, FR24_RELAYOUT_EVENT } from '../state/store'
import PanelChromeButtons from '../layout/PanelChromeButtons'
import { panelHeadClassName } from '../layout/panelMeta'

// The Flight Tracking panel: a toolbar plus a NON-SCROLLING placeholder region
// that the native FR24 WebContentsView is positioned over. The renderer never
// draws the map — it measures where the map should be and tells the main process
// via fr24:setBounds. The bounds math assumes no scroll offset, hence the
// region must never scroll (see the CSS: overflow hidden, fixed to the panel).
//
// Its own leaf on the panel canvas (layout/LeafFrame.tsx) — the measurement
// logic below is untouched by the panel-canvas work; only the header gains
// the shared maximize/close chrome (layout/PanelChromeButtons.tsx).

const PANEL_ID = 'fr24' as const
const PANEL_TITLE = 'Flight Tracking'

/**
 * Report the region's current rect to the main process as FR24 view bounds.
 * rAF-throttled, trailing-edge: many resize callbacks in one frame collapse into
 * a single measurement taken at frame time (the freshest layout), which tracks
 * the divider smoothly. A debounce here would read as jank, so we don't use one.
 */
function Fr24Panel(): React.JSX.Element {
  const navState = useAppStore((s) => s.navState)
  const toggleMaximize = useAppStore((s) => s.toggleMaximize)
  const dragPanelId = useAppStore((s) => s.dragPanelId)
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
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        // Reset the guard, or a StrictMode remount (dev React mounts twice)
        // sees a stale id and skips every future measure — the view then never
        // receives bounds and stays invisible in `just dev` while production
        // builds work. Only measure() itself clears the ref otherwise.
        rafRef.current = null
      }
    }
  }, [scheduleMeasure])

  const nav = window.api.fr24.nav

  return (
    <section className="fr24-panel" aria-label="Flight Tracking">
      <header
        className={panelHeadClassName('panel-head', PANEL_ID, dragPanelId)}
        onDoubleClick={() => toggleMaximize(PANEL_ID)}
      >
        <h2 className="panel-title">{PANEL_TITLE}</h2>
        <div className="panel-head-spacer" />
        <PanelChromeButtons panelId={PANEL_ID} title={PANEL_TITLE} />
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
