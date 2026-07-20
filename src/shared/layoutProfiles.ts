// Pure CRUD ops over a `LayoutProfile[]` list — the "named saved layouts" half
// of snaps (docs/Panel-System-Plan.md § Key interactions § Snaps; the
// template-gallery half is @shared/layoutTemplates.ts). LayoutManagerModal
// (`feature/layout-snaps`) is the only UI caller; the store's profile CRUD
// actions (state/store.ts) delegate to these rather than manipulating the
// array inline, so the list manipulation itself stays unit-testable without a
// zustand store or React in the loop (tests/unit/layoutProfiles.test.ts).
//
// Electron/DOM-free like panelLayout.ts/layoutTemplates.ts (compiles in both
// tsconfigs). Every op here is a pure function returning a NEW array on an
// actual change and the EXACT SAME array reference on a no-op (an empty/
// whitespace name, an out-of-range index, a rename collision) — the same
// discipline panelLayout.ts's tree ops use, so a store can cheaply skip a
// state update (and a session-persist write) on a rejected edit.
//
// Profile names are the menu's own labels (src/main/menu.ts renders one radio
// item per name) and the list order is what `CmdOrCtrl+Alt+1..9` counts
// against (see layout:menuSync's `profiles` field), so this module also
// enforces the invariant a menu needs: names are unique within the list, and
// `saveProfile` upserts by exact name match rather than ever creating a
// second entry with the same label.

import { normalizeTree, type LayoutNode, type LayoutProfile } from './panelLayout'

/**
 * Deep-clone a layout tree so a saved profile's snapshot can never be
 * disturbed by a later in-place mutation of the tree it was copied from.
 * Every panelLayout.ts tree op already returns fresh objects rather than
 * mutating (so aliasing is not a live bug today), but a profile snapshot is
 * long-lived session state, not a transient render value — cloning here is
 * the cheap belt-and-suspenders that keeps that true even if a future op
 * ever slips.
 */
export function cloneLayoutNode(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return { ...node }
  return {
    ...node,
    children: node.children.map(cloneLayoutNode),
    sizes: node.sizes.slice()
  }
}

/** Trim + reject an empty/whitespace-only name — the shared guard every naming op below applies identically. */
function cleanName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Save `tree` as a named profile: a new entry appended at the end (so its
 * index — what the `CmdOrCtrl+Alt+N` accelerators and `applyProfileByIndex`
 * count against — is stable for every OTHER profile already saved) when
 * `name` is new, or an in-place overwrite of the existing entry with that
 * exact name (Save-As-same-name is "update this profile", not "create a
 * duplicate"). An empty/whitespace `name` is a no-op (same array reference).
 */
export function saveProfile(
  profiles: LayoutProfile[],
  name: string,
  tree: LayoutNode
): LayoutProfile[] {
  const cleaned = cleanName(name)
  if (cleaned === null) return profiles

  const snapshot: LayoutProfile = { name: cleaned, tree: cloneLayoutNode(normalizeTree(tree)) }
  const existingIndex = profiles.findIndex((p) => p.name === cleaned)
  if (existingIndex === -1) return [...profiles, snapshot]

  const next = profiles.slice()
  next[existingIndex] = snapshot
  return next
}

/**
 * Rename the profile at `index` to `newName`. A no-op (same array reference)
 * when: `index` is out of range, `newName` is empty/whitespace, the name is
 * unchanged, or another profile already has that exact name (names stay
 * unique — see this module's header comment on why the menu depends on that).
 */
export function renameProfile(
  profiles: LayoutProfile[],
  index: number,
  newName: string
): LayoutProfile[] {
  if (index < 0 || index >= profiles.length) return profiles
  const cleaned = cleanName(newName)
  if (cleaned === null) return profiles
  if (profiles[index].name === cleaned) return profiles
  if (profiles.some((p, i) => i !== index && p.name === cleaned)) return profiles

  const next = profiles.slice()
  next[index] = { ...next[index], name: cleaned }
  return next
}

/** Delete the profile at `index`. A no-op (same array reference) when `index` is out of range. */
export function deleteProfile(profiles: LayoutProfile[], index: number): LayoutProfile[] {
  if (index < 0 || index >= profiles.length) return profiles
  const next = profiles.slice()
  next.splice(index, 1)
  return next
}

/**
 * The tree saved at `index`, or `null` when `index` is out of range — the
 * apply-by-index path both LayoutManagerModal's "Apply" button and the
 * native menu's `CmdOrCtrl+Alt+1..9` profile radios use (index = the
 * profile's position in `layoutProfiles`, exactly what `layout:menuSync`
 * reports and `layout:command`'s `apply-profile` carries — see
 * src/main/menu.ts / src/renderer/src/layout/menuBridge.ts). Callers still
 * run the result through `normalizeTree` (the store's `applyProfile` action
 * does) rather than trusting a hand-edited session's profile tree verbatim.
 */
export function applyProfileByIndex(profiles: LayoutProfile[], index: number): LayoutNode | null {
  return profiles[index]?.tree ?? null
}
