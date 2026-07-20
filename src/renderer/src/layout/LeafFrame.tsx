import type { PanelId, Rect } from '@shared/panelLayout'

// One absolutely-positioned leaf in the panel canvas. `rect` is style-only —
// see PanelCanvas.tsx's render-order comment: this component is mounted once
// per open panel id and never remounted by a rearrangement, only repositioned.
//
// (decision 2026-07-20) LeafFrame is window-agnostic: it hosts whatever
// `renderLeafBody` returns for a panel id and knows nothing about the
// audio/weather/fr24/video split itself — the window hosting the canvas
// supplies that mapping (see components/LayoutShell.tsx's
// `renderMainLeafBody` for the main window's current four kinds). This is
// what lets a future pop-out window reuse PanelCanvas/LeafFrame with its own
// leaf-body set, without this file changing at all. See
// layout/LayoutController.ts and docs/decisions/README.md.

export interface LeafFrameProps {
  panelId: PanelId
  rect: Rect
  /** True for every non-maximized leaf while some OTHER leaf is maximized — visibility:hidden, never unmounted (players/streams keep running). */
  hidden: boolean
  isMaximized: boolean
  /** Renders this leaf's body for `panelId` — supplied by the window hosting the canvas (PanelCanvas.tsx passes through whatever it was given). */
  renderLeafBody: (panelId: PanelId) => React.ReactNode
}

function LeafFrame({
  panelId,
  rect,
  hidden,
  isMaximized,
  renderLeafBody
}: LeafFrameProps): React.JSX.Element {
  const style: React.CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  }

  return (
    <div
      className={`leaf-frame${hidden ? ' leaf-frame--hidden' : ''}`}
      style={style}
      data-panel-id={panelId}
      data-maximized={isMaximized ? 'true' : undefined}
    >
      {renderLeafBody(panelId)}
    </div>
  )
}

export default LeafFrame
