import { useEffect, useMemo, useRef, useState } from 'react'
import { collectLeafIds, type DropZone, type PanelId } from '@shared/panelLayout'
import { useAppStore } from '../state/store'
import { panelTitle } from './panelMeta'

// The Move-panel modal (PR4 of the panel-system effort): a target panel +
// placement radios, committed through the store's `movePanel` action (which
// delegates to the pure `movePanel(tree, id, DropTarget)` op in
// @shared/panelLayout). This is the accessible, keyboard/e2e-deterministic
// move path, landed BEFORE pointer-driven header-drag-to-dock
// (`feature/panel-drag-dock`) — see docs/Panel-System-Plan.md § Key
// interactions and docs/decisions/README.md (decision 2026-07-20).
//
// Opened via the `overlay` pattern (`store.openMovePanel`, which sets
// `overlay: 'move-panel'` + `movePanelId` together) — LayoutShell renders this
// component only while `overlay === 'move-panel'`, which the CONSOLIDATED
// FR24 visibility rule already keys off (`overlay === null`), so opening this
// modal hides the native FR24 view under it with no extra plumbing.
//
// Only the `kind: 'panel'` flavor of DropTarget is offered here (a target
// panel + one of its four edges, or 'center' to swap) — root-edge docking is
// reachable the same way by targeting any panel already at that edge, and
// keeping the form to one dropdown + one radio group is what makes this
// deterministic for e2e (`tests/e2e/panels.spec.ts`).

interface MovePanelModalProps {
  /** The panel being moved — the header button that opened this modal is on this panel's own chrome. */
  panelId: PanelId
  onClose: () => void
}

const ZONE_OPTIONS: readonly { zone: DropZone; label: string }[] = [
  { zone: 'left', label: 'Left of target' },
  { zone: 'right', label: 'Right of target' },
  { zone: 'top', label: 'Above target' },
  { zone: 'bottom', label: 'Below target' },
  { zone: 'center', label: 'Swap with target' }
]

function MovePanelModal({ panelId, onClose }: MovePanelModalProps): React.JSX.Element {
  const panelTree = useAppStore((s) => s.panelTree)
  const movePanel = useAppStore((s) => s.movePanel)

  // Recomputed on every render off the live tree (not snapshotted at open) so
  // the target list can never go stale while the modal is open.
  const targets = useMemo(
    () => collectLeafIds(panelTree).filter((id) => id !== panelId),
    [panelTree, panelId]
  )

  const [targetId, setTargetId] = useState<PanelId | ''>(targets[0] ?? '')
  const [zone, setZone] = useState<DropZone>('right')

  const selectRef = useRef<HTMLSelectElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Close on Escape; focus the first meaningful control — same shape as
  // AboutModal/AddChannelModal. Whichever ref is actually mounted (the target
  // select when there's a choice to make, else the sole Close button) wins —
  // reading `.current` here, not `targets.length`, keeps this hook's own
  // deps array honest (see eslint-plugin-react-hooks/exhaustive-deps).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    ;(selectRef.current ?? closeRef.current)?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (targetId === '') return
    movePanel(panelId, { kind: 'panel', targetId, zone })
    onClose()
  }

  const title = panelTitle(panelId)

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="move-panel-modal">
      <div
        className="modal move-panel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="move-panel-title" className="modal-title">
          Move {title}
        </h2>

        {targets.length === 0 ? (
          <>
            <p className="modal-body modal-muted">
              No other open panel to move {title} relative to.
            </p>
            <div className="modal-actions">
              <button type="button" className="modal-close" onClick={onClose} ref={closeRef}>
                Close
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="move-panel-field">
              <label className="move-panel-label" htmlFor="move-panel-target">
                Target panel
              </label>
              <select
                id="move-panel-target"
                ref={selectRef}
                className="move-panel-select"
                data-testid="move-panel-target"
                value={targetId}
                onChange={(e) => setTargetId(e.currentTarget.value as PanelId)}
              >
                {targets.map((id) => (
                  <option key={id} value={id}>
                    {panelTitle(id)}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="move-panel-zones">
              <legend className="move-panel-label">Placement</legend>
              {ZONE_OPTIONS.map((opt) => (
                <label key={opt.zone} className="move-panel-zone">
                  <input
                    type="radio"
                    name="move-panel-zone"
                    value={opt.zone}
                    data-testid={`move-panel-zone-${opt.zone}`}
                    checked={zone === opt.zone}
                    onChange={() => setZone(opt.zone)}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>

            <div className="modal-actions">
              <button type="button" className="modal-close move-panel-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="modal-close" data-testid="move-panel-submit">
                Move
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default MovePanelModal
