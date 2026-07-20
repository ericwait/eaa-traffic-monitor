import type { PanelId, VideoFitMode } from '@shared/panelLayout'
import { useLayoutController } from './LayoutController'

// Shared fit/move/maximize/close (and, for video panels, pop-out) chrome
// buttons.
//
// AudioPanel/Fr24Panel/WeatherPanel each already ship their own proper header
// (title + their own actions) — LeafFrame does NOT wrap them in a second,
// duplicate header (that would visibly diverge from today's single-header-
// per-panel arrangement). Instead those three components import THIS
// component directly and drop it into their existing header row.
// components/VideoLeafBody.tsx (the fourth leaf-body kind, supplied by the
// window alongside those three — see LayoutShell.tsx's `renderMainLeafBody`)
// builds its own header and uses this component there too. Either way every
// panel ends up with the same move/maximize/close (+ fit + pop-out for video)
// affordances from one definition.
//
// (decision 2026-07-20) Reads/writes ONLY through `useLayoutController()`,
// never `useAppStore` directly — every caller above renders as a leaf body
// inside the panel canvas, which is always wrapped in a
// `LayoutControllerProvider` (LayoutShell.tsx for the main window today). See
// LayoutController.ts and docs/decisions/README.md.
//
// "Move panel…" (PR4 of the panel-system effort) opens MovePanelModal via the
// `overlay` pattern (`openMovePanel` sets `overlay: 'move-panel'` +
// `movePanelId`) — the accessible, e2e-deterministic move path landed BEFORE
// pointer-driven drag-to-dock (`feature/panel-drag-dock`); see
// docs/Panel-System-Plan.md § Key interactions and docs/decisions/README.md
// (decision 2026-07-20).
//
// The fit/fill toggle (also PR4 — the small PR3 remainder; geometry +
// persistence already existed) flips `videoFit[feedId]` via the `fit` prop —
// LeafFrame's `VideoLeafBody` is the only caller that passes it, since
// fit/fill is not a concept for audio/weather/fr24.
//
// (decision 2026-07-20) Pop-out windows reuse this exact component (via
// VideoLeafBody's `popout` prop) but pass `hideMove` — the Move-panel modal
// and Layout Manager stay main-window-only there, so a pop-out leaf's chrome
// is fit + maximize + close only (plus mute/volume, which live on VideoTile
// itself, not here). See docs/design/Layout.md's pop-out section.

interface PanelChromeButtonsProps {
  panelId: PanelId
  title: string
  /** Present only for video panels — pop-out is not a concept for audio/weather/fr24. */
  onPopOut?: () => void
  /** Present only for video panels — the current fit/fill mode + its toggle callback. */
  fit?: { mode: VideoFitMode; onToggle: () => void }
  /**
   * True only inside a pop-out window (decision 2026-07-20; see
   * components/VideoLeafBody.tsx's `popout` prop): hides "Move panel…". The
   * Move-panel modal and the Layout Manager stay main-window-only —
   * header-drag-to-dock on the pop-out's own canvas is its reorg path
   * instead. Default false (shown) for the main window's leaf chrome.
   */
  hideMove?: boolean
}

function PanelChromeButtons({
  panelId,
  title,
  onPopOut,
  fit,
  hideMove = false
}: PanelChromeButtonsProps): React.JSX.Element {
  const { maximizedPanelId, toggleMaximize, closePanel, openMovePanel } = useLayoutController()
  const isMaximized = maximizedPanelId === panelId

  return (
    <div className="panel-head-actions">
      {fit && (
        <button
          type="button"
          className="panel-head-btn panel-head-btn--fit"
          data-testid={`leaf-fit-${panelId}`}
          aria-label={`${title}: currently ${fit.mode === 'fit' ? 'Fit' : 'Fill'} — click for ${
            fit.mode === 'fit' ? 'Fill' : 'Fit'
          }`}
          title={
            fit.mode === 'fit'
              ? 'Fit (inscribed 16:9) — click to Fill (cropped, no letterboxing)'
              : 'Fill (cropped, no letterboxing) — click to Fit (inscribed 16:9)'
          }
          onClick={fit.onToggle}
        >
          {fit.mode === 'fit' ? 'Fit' : 'Fill'}
        </button>
      )}
      {onPopOut && (
        <button
          type="button"
          className="panel-head-btn"
          data-testid={`leaf-popout-${panelId}`}
          aria-label={`Pop out ${title}`}
          title="Open in its own window (for a second monitor)"
          onClick={onPopOut}
        >
          {'⧉'}
        </button>
      )}
      {!hideMove && (
        <button
          type="button"
          className="panel-head-btn"
          data-testid={`leaf-move-${panelId}`}
          aria-label={`Move ${title}…`}
          title="Move panel… (choose a target panel + placement)"
          onClick={() => openMovePanel(panelId)}
        >
          {'⇄'}
        </button>
      )}
      <button
        type="button"
        className="panel-head-btn"
        data-testid={`leaf-maximize-${panelId}`}
        aria-label={isMaximized ? `Restore ${title}` : `Maximize ${title}`}
        title={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => toggleMaximize(panelId)}
      >
        {isMaximized ? '⤡' : '⛶'}
      </button>
      <button
        type="button"
        className="panel-head-btn"
        data-testid={`leaf-close-${panelId}`}
        aria-label={`Close ${title}`}
        title="Close panel"
        onClick={() => closePanel(panelId)}
      >
        {'×'}
      </button>
    </div>
  )
}

export default PanelChromeButtons
