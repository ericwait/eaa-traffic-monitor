import { useEffect, useMemo, useRef, useState } from 'react'
import { collectLeafIds, type LayoutProfile, type PanelId } from '@shared/panelLayout'
import {
  instantiateTemplate,
  layoutTemplates,
  VIDEO_REST_ZONE,
  type LayoutTemplate,
  type ZoneAssignment,
  type ZoneId,
  type ZoneNode
} from '@shared/layoutTemplates'
import { useAppStore } from '../state/store'
import { panelKind, panelTitle, videoFeedIdOf } from './panelMeta'

// The snap-manager dialog (PR5 of the panel-system effort): the template
// gallery + per-zone assignment (docs/Panel-System-Plan.md § Key
// interactions § Snaps), plus named-profile CRUD (save/apply/rename/delete),
// in one modal. Opened via the `overlay` pattern (`'layout-manager'`) from
// the native Layout menu's "Layout Manager…" item ONLY (src/main/menu.ts /
// layout/menuBridge.ts's `open-layout-manager` command) — same z-order
// reasoning as every other overlay (LayoutShell hides the native FR24 view
// under it; see CLAUDE.md gotchas).
//
// Applying a TEMPLATE goes through `applyTree` (which always clears
// `activeProfileName` — a template instantiation isn't a saved profile).
// Applying a PROFILE goes through the store's own `applyProfile` action
// (which SETS `activeProfileName` to that profile's name). Either path only
// ever swaps `panelTree` — never a keyed remount — so panels present in both
// the old and new tree keep their exact DOM (and therefore never reload a
// video stream; see tests/e2e/layoutProfiles.spec.ts's `isConnected` proxy).

interface LayoutManagerModalProps {
  onClose: () => void
}

/** One zone tree's assignable (non-`VIDEO_REST_ZONE`) zone ids in tree order, plus whether it contains a video-rest zone at all. */
interface ZoneScan {
  zoneIds: ZoneId[]
  hasVideoRest: boolean
}

function scanZones(node: ZoneNode): ZoneScan {
  if (node.type === 'leaf') {
    return node.zone === VIDEO_REST_ZONE
      ? { zoneIds: [], hasVideoRest: true }
      : { zoneIds: [node.zone], hasVideoRest: false }
  }
  const zoneIds: ZoneId[] = []
  let hasVideoRest = false
  for (const child of node.children) {
    const scanned = scanZones(child)
    zoneIds.push(...scanned.zoneIds)
    hasVideoRest = hasVideoRest || scanned.hasVideoRest
  }
  return { zoneIds, hasVideoRest }
}

/** The zone dropdown's human label: a zone id that IS itself a fixed panel id shows that panel's own title (audio/weather/fr24 — the 'default' template's zone-naming convention, see layoutTemplates.ts); a generic `zone-a`/`zone-b`/… shows "Zone A"/"Zone B". */
function zoneLabel(zoneId: ZoneId): string {
  if (zoneId === 'audio' || zoneId === 'weather' || zoneId === 'fr24') return panelTitle(zoneId)
  const m = /^zone-([a-z0-9]+)$/i.exec(zoneId)
  return m ? `Zone ${m[1].toUpperCase()}` : zoneId
}

/**
 * A sane pre-fill for a freshly-selected template: an identity pass first
 * (a zone id that's itself a fixed panel id gets that same panel — this is
 * what reproduces `buildDefaultTree`'s exact arrangement for the 'default'
 * template's audio/weather/fr24 zones, per layoutTemplates.ts's own doc
 * comment), then a positional fallback for every other (generic) zone,
 * walking `candidateIds` in order and skipping whatever the identity pass
 * already claimed. Zones left over once `candidateIds` runs out stay
 * unassigned (the operator can still assign one by hand).
 */
function defaultAssignment(
  zoneIds: readonly ZoneId[],
  candidateIds: readonly PanelId[]
): ZoneAssignment {
  const assignment: ZoneAssignment = {}
  const used = new Set<PanelId>()

  for (const zoneId of zoneIds) {
    if (zoneId === 'audio' || zoneId === 'weather' || zoneId === 'fr24') {
      assignment[zoneId] = zoneId
      used.add(zoneId)
    }
  }

  let cursor = 0
  for (const zoneId of zoneIds) {
    if (assignment[zoneId] !== undefined) continue
    while (cursor < candidateIds.length && used.has(candidateIds[cursor])) cursor++
    if (cursor >= candidateIds.length) continue
    assignment[zoneId] = candidateIds[cursor]
    used.add(candidateIds[cursor])
    cursor++
  }

  return assignment
}

/** A tiny flex rendering of a template's zone tree — orientation + proportional flex-grow per child, recursing to a colored leaf swatch. Purely decorative (aria-hidden at the call site); the template's NAME is what's announced. */
function ZonePreviewNode({ node }: { node: ZoneNode }): React.JSX.Element {
  if (node.type === 'leaf') {
    return <div className="template-mini-zone" data-zone={node.zone} />
  }
  return (
    <div
      className="template-mini-split"
      style={{ flexDirection: node.orientation === 'horizontal' ? 'row' : 'column' }}
    >
      {node.children.map((child, i) => (
        <div
          key={node.orientation === 'horizontal' ? `h${i}` : `v${i}`}
          className="template-mini-child"
          style={{ flexGrow: node.sizes[i] ?? 1 }}
        >
          <ZonePreviewNode node={child} />
        </div>
      ))}
    </div>
  )
}

interface ProfileRowProps {
  profile: LayoutProfile
  index: number
  isActive: boolean
  onApply: () => void
  onRename: (name: string) => void
  onDelete: () => void
}

/** One saved profile's row: Apply / inline Rename / Delete. Editing is local component state — nothing is renamed until the inline form submits. */
function ProfileRow({
  profile,
  index,
  isActive,
  onApply,
  onRename,
  onDelete
}: ProfileRowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(profile.name)

  function startEdit(): void {
    setDraft(profile.name)
    setEditing(true)
  }

  function submitEdit(e: React.FormEvent): void {
    e.preventDefault()
    const trimmed = draft.trim()
    if (trimmed.length > 0) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div
      className="layout-manager-profile-row"
      data-testid={`profile-row-${index}`}
      data-active={isActive ? 'true' : undefined}
    >
      {editing ? (
        <form className="layout-manager-profile-rename-form" onSubmit={submitEdit}>
          <input
            className="layout-manager-profile-rename-input"
            data-testid={`profile-rename-input-${index}`}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.currentTarget.value)}
          />
          <button
            type="submit"
            className="panel-head-btn"
            data-testid={`profile-rename-save-${index}`}
          >
            Save
          </button>
          <button type="button" className="panel-head-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <span className="layout-manager-profile-name">
          {profile.name}
          {isActive && <span className="layout-manager-profile-active-badge"> (active)</span>}
        </span>
      )}
      <div className="layout-manager-profile-actions">
        <button
          type="button"
          className="panel-head-btn"
          data-testid={`profile-apply-${index}`}
          onClick={onApply}
        >
          Apply
        </button>
        {!editing && (
          <button
            type="button"
            className="panel-head-btn"
            data-testid={`profile-rename-${index}`}
            onClick={startEdit}
          >
            Rename
          </button>
        )}
        <button
          type="button"
          className="panel-head-btn"
          data-testid={`profile-delete-${index}`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function LayoutManagerModal({ onClose }: LayoutManagerModalProps): React.JSX.Element {
  const panelTree = useAppStore((s) => s.panelTree)
  const layoutProfiles = useAppStore((s) => s.layoutProfiles)
  const activeProfileName = useAppStore((s) => s.activeProfileName)
  const applyTree = useAppStore((s) => s.applyTree)
  const saveProfileAction = useAppStore((s) => s.saveProfile)
  const renameProfileAction = useAppStore((s) => s.renameProfile)
  const deleteProfileAction = useAppStore((s) => s.deleteProfile)
  const applyProfileAction = useAppStore((s) => s.applyProfile)

  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Close on Escape; focus the Close button — same shape as AboutModal/
  // MovePanelModal/AddChannelModal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Recomputed on every render off the LIVE tree (not snapshotted at open —
  // same discipline as MovePanelModal), so a feed opened/closed elsewhere
  // while this modal is open (e.g. via the Panels menu) is never stale.
  const openVideoFeedIds = useMemo(
    () =>
      collectLeafIds(panelTree)
        .filter((id) => panelKind(id) === 'video')
        .map((id) => videoFeedIdOf(id)),
    [panelTree]
  )

  const candidateIds = useMemo<PanelId[]>(
    () => ['audio', 'weather', 'fr24', ...openVideoFeedIds.map((id): PanelId => `video:${id}`)],
    [openVideoFeedIds]
  )

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<ZoneAssignment>({})

  const selectedTemplate: LayoutTemplate | null =
    layoutTemplates.find((t) => t.id === selectedTemplateId) ?? null
  const zoneScan = useMemo(
    () => (selectedTemplate ? scanZones(selectedTemplate.tree) : null),
    [selectedTemplate]
  )

  function selectTemplate(template: LayoutTemplate): void {
    setSelectedTemplateId(template.id)
    setAssignment(defaultAssignment(scanZones(template.tree).zoneIds, candidateIds))
  }

  // "Each panel assignable once" (the plan's own wording) is enforced by
  // CLEARING whichever OTHER zone currently holds `value`, not by disabling
  // that option in every other zone's dropdown — disabling would deadlock a
  // full reassignment rotation (e.g. swapping A<->B<->C with no zone ever
  // free to move through first), which is exactly the scenario
  // tests/e2e/layoutProfiles.spec.ts exercises. This mirrors `swapPanels`'s
  // own "exchange positions" semantics one level up, at the zone-assignment
  // stage rather than the tree stage.
  function handleAssignChange(zoneId: ZoneId, value: string): void {
    const nextValue: PanelId | null = value === '' ? null : (value as PanelId)
    setAssignment((prev) => {
      const next: ZoneAssignment = { ...prev, [zoneId]: nextValue }
      if (nextValue !== null) {
        for (const [otherZoneId, assigned] of Object.entries(prev)) {
          if (otherZoneId !== zoneId && assigned === nextValue) next[otherZoneId] = null
        }
      }
      return next
    })
  }

  const templateResult = useMemo(
    () =>
      selectedTemplate ? instantiateTemplate(selectedTemplate, assignment, openVideoFeedIds) : null,
    [selectedTemplate, assignment, openVideoFeedIds]
  )

  function handleApplyTemplate(): void {
    if (templateResult === null) return
    applyTree(templateResult)
  }

  const [newProfileName, setNewProfileName] = useState('')
  function handleSaveProfile(e: React.FormEvent): void {
    e.preventDefault()
    const trimmed = newProfileName.trim()
    if (trimmed.length === 0) return
    saveProfileAction(trimmed)
    setNewProfileName('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="layout-manager-modal">
      <div
        className="modal layout-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layout-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="layout-manager-title" className="modal-title">
          Layout Manager
        </h2>

        <section className="layout-manager-section">
          <h3 className="layout-manager-subtitle">Templates</h3>
          <p className="modal-body modal-muted">
            Pick a starting shape, assign a panel to each zone, then Apply — this replaces the whole
            layout.
          </p>
          <div className="template-gallery" data-testid="template-gallery">
            {layoutTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="template-card"
                data-testid={`template-card-${template.id}`}
                data-selected={template.id === selectedTemplateId ? 'true' : undefined}
                onClick={() => selectTemplate(template)}
              >
                <div className="template-mini-preview" aria-hidden="true">
                  <ZonePreviewNode node={template.tree} />
                </div>
                <span className="template-card-name">{template.name}</span>
              </button>
            ))}
          </div>

          {selectedTemplate && zoneScan && (
            <div className="layout-manager-assign" data-testid="template-assign">
              <h4 className="layout-manager-subtitle">Assign panels</h4>
              {zoneScan.zoneIds.map((zoneId) => (
                <div key={zoneId} className="move-panel-field layout-manager-zone-field">
                  <label className="move-panel-label" htmlFor={`zone-assign-${zoneId}`}>
                    {zoneLabel(zoneId)}
                  </label>
                  <select
                    id={`zone-assign-${zoneId}`}
                    className="move-panel-select"
                    data-testid={`zone-assign-${zoneId}`}
                    value={assignment[zoneId] ?? ''}
                    onChange={(e) => handleAssignChange(zoneId, e.currentTarget.value)}
                  >
                    <option value="">{'— Unassigned —'}</option>
                    {candidateIds.map((id) => {
                      // Informational only (never disabled — see
                      // handleAssignChange's own comment on why disabling
                      // would deadlock a full reassignment rotation):
                      // choosing an id already claimed by ANOTHER zone
                      // reassigns it here and clears it there.
                      const heldByZoneId = zoneScan.zoneIds.find(
                        (z) => z !== zoneId && assignment[z] === id
                      )
                      return (
                        <option key={id} value={id}>
                          {panelTitle(id)}
                          {heldByZoneId ? ` (currently ${zoneLabel(heldByZoneId)})` : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              ))}
              {zoneScan.hasVideoRest && (
                <p className="modal-body modal-muted">
                  Remaining open video feeds fill a balanced grid automatically.
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-close"
                  data-testid="template-apply"
                  disabled={templateResult === null}
                  onClick={handleApplyTemplate}
                >
                  Apply template
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="layout-manager-section">
          <h3 className="layout-manager-subtitle">Named profiles</h3>
          <form className="layout-manager-save-form" onSubmit={handleSaveProfile}>
            <label className="move-panel-label" htmlFor="profile-name-input">
              Save current layout as
            </label>
            <input
              id="profile-name-input"
              className="move-panel-select layout-manager-profile-name-input"
              data-testid="profile-name-input"
              value={newProfileName}
              spellCheck={false}
              autoComplete="off"
              placeholder="e.g. Show day"
              onChange={(e) => setNewProfileName(e.currentTarget.value)}
            />
            <button
              type="submit"
              className="modal-close"
              data-testid="profile-save"
              disabled={newProfileName.trim().length === 0}
            >
              Save
            </button>
          </form>

          {layoutProfiles.length === 0 ? (
            <p className="modal-body modal-muted">No saved profiles yet.</p>
          ) : (
            <div className="layout-manager-profile-list" data-testid="profile-list">
              {layoutProfiles.map((profile, index) => (
                <ProfileRow
                  key={profile.name}
                  profile={profile}
                  index={index}
                  isActive={activeProfileName === profile.name}
                  onApply={() => applyProfileAction(index)}
                  onRename={(name) => renameProfileAction(index, name)}
                  onDelete={() => deleteProfileAction(index)}
                />
              ))}
            </div>
          )}
        </section>

        <div className="modal-actions">
          <button
            type="button"
            className="modal-close"
            data-testid="layout-manager-close"
            onClick={onClose}
            ref={closeRef}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default LayoutManagerModal
