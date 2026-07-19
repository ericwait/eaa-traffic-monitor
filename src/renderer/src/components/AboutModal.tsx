import { useEffect, useRef } from 'react'

// A small Help/About modal — deliberately real, not a stub. It exists to PROVE
// the z-order rule end to end: it overlaps the FR24 region, and because a
// WebContentsView paints above all DOM, an HTML modal alone can't cover it. The
// fix is that opening any such overlay flips `overlayOpen` in the store, which
// drives fr24:setVisible(false) (wired in LayoutShell). This is the standing
// pattern: every future overlay that can cover the FR24 region does the same.

interface AboutModalProps {
  onClose: () => void
}

function AboutModal({ onClose }: AboutModalProps): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    // Close on Escape; move focus into the dialog for keyboard users.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="about-modal">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-title" className="modal-title">
          Airshow Traffic Monitor
        </h2>
        <p className="modal-body">
          Arrange once, then just watch and listen — the unified AirVenture traffic dashboard.
        </p>
        <p className="modal-body modal-muted">
          Walking skeleton (Phase 1): three-panel layout with a live FlightRadar24 browser panel.
          ATC audio (Phase 2) and the YouTube grid (Phase 3) fill the other panels next.
        </p>
        <p className="modal-body modal-muted">
          This dialog overlaps the flight-tracking view on purpose: while it is open the native FR24
          view is hidden so the dialog can sit on top, then restored on close.
        </p>
        <div className="modal-actions">
          <button type="button" className="modal-close" onClick={onClose} ref={closeRef}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default AboutModal
