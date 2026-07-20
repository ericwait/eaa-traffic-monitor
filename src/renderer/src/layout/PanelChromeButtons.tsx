import type { PanelId } from '@shared/panelLayout'
import { useAppStore } from '../state/store'

// Shared maximize/close (and, for video panels, pop-out) chrome buttons.
//
// AudioPanel/Fr24Panel/WeatherPanel each already ship their own proper header
// (title + their own actions) — LeafFrame does NOT wrap them in a second,
// duplicate header (that would visibly diverge from today's single-header-
// per-panel arrangement). Instead those three components import THIS
// component directly and drop it into their existing header row. Video
// panels have no header of their own before this PR, so LeafFrame builds one
// and uses this component there too. Either way every panel ends up with the
// same maximize/close (+ pop-out for video) affordances from one definition.

interface PanelChromeButtonsProps {
  panelId: PanelId
  title: string
  /** Present only for video panels — pop-out is not a concept for audio/weather/fr24. */
  onPopOut?: () => void
}

function PanelChromeButtons({
  panelId,
  title,
  onPopOut
}: PanelChromeButtonsProps): React.JSX.Element {
  const maximizedPanelId = useAppStore((s) => s.maximizedPanelId)
  const toggleMaximize = useAppStore((s) => s.toggleMaximize)
  const closePanel = useAppStore((s) => s.closePanel)
  const isMaximized = maximizedPanelId === panelId

  return (
    <div className="panel-head-actions">
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
