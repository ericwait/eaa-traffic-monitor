import type { DropTarget, PanelId, Rect } from '@shared/panelLayout'
import type { Point } from './dropZones'
import { panelTitle } from './panelMeta'

// The fixed overlay layer painted for the life of a header-drag-to-dock
// gesture (docs/Panel-System-Plan.md § Key interactions § Header
// drag-to-dock; state machine in useHeaderDrag.ts): the drop-zone highlight
// (`data-zone`, the assertion hook for tests/e2e/panelDrag.spec.ts) and a
// light drag ghost that follows the pointer. Both are `position: fixed`
// (viewport coordinates) — see useHeaderDrag.ts's header comment for why the
// hook hands this component an already-resolved, viewport-space
// `highlightRect` rather than canvas-local leaves/rootRect this component
// would otherwise have to re-convert itself.

export interface DragOverlayProps {
  draggedId: PanelId
  /** Current pointer position, VIEWPORT coordinates. */
  pointer: Point
  dropTarget: DropTarget | null
  /** `dropHighlightRect`, already resolved in viewport space by useHeaderDrag.ts — `null` when `dropTarget` is `null`, or (defensively) when the target's panel id no longer resolves to a rect. */
  highlightRect: Rect | null
}

/** The drop target's own zone/edge label, used for `data-zone`. `DropZone` ('top'|'bottom'|'left'|'right'|'center') and `RootEdge` ('top'|'bottom'|'left'|'right') share the same edge vocabulary, so one attribute covers both a panel-edge split and a root-edge dock. */
function zoneLabel(target: DropTarget): string {
  return target.kind === 'root' ? target.edge : target.zone
}

function DragOverlay({
  draggedId,
  pointer,
  dropTarget,
  highlightRect
}: DragOverlayProps): React.JSX.Element {
  return (
    <div className="drag-layer" data-testid="drag-layer">
      {dropTarget && highlightRect && (
        <div
          className="dropzone-highlight"
          data-testid="dropzone-highlight"
          data-zone={zoneLabel(dropTarget)}
          style={{
            left: highlightRect.x,
            top: highlightRect.y,
            width: highlightRect.width,
            height: highlightRect.height
          }}
        />
      )}
      <div
        className="drag-ghost"
        data-testid="drag-ghost"
        style={{ left: pointer.x, top: pointer.y }}
      >
        {panelTitle(draggedId)}
      </div>
    </div>
  )
}

export default DragOverlay
