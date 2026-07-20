// The snap-template catalog: fixed ZONE shapes (a tree of named zones, not
// concrete panels) plus `instantiateTemplate`, which substitutes a real panel
// (or the balanced remainder of open video feeds) into each zone. Templates
// are the "gallery" half of snaps (docs/Panel-System-Plan.md § Key
// interactions); named, saved arrangements (the other half) are just
// `LayoutNode` snapshots and need no template machinery of their own.
//
// Electron/DOM-free like panelLayout.ts (compiles in both tsconfigs) — this
// module only depends on panelLayout's pure tree ops.

import {
  buildBalancedGrid,
  normalizeSizes,
  type LayoutNode,
  type Orientation,
  type PanelId
} from './panelLayout'

// ---------------------------------------------------------------------------
// Zone tree — the template's own vocabulary. Structurally identical to
// LayoutNode except leaves name a zone id instead of a concrete PanelId.
// ---------------------------------------------------------------------------

export type ZoneId = string

export interface ZoneLeaf {
  type: 'leaf'
  zone: ZoneId
}

export interface ZoneSplit {
  type: 'split'
  id: string
  orientation: Orientation
  children: ZoneNode[]
  sizes: number[]
}

export type ZoneNode = ZoneLeaf | ZoneSplit

export interface LayoutTemplate {
  id: string
  name: string
  tree: ZoneNode
}

/** Reserved zone id: instantiates to `buildBalancedGrid` of whatever open video feed isn't explicitly assigned elsewhere in the template. */
export const VIDEO_REST_ZONE: ZoneId = 'video-rest'

/** What the operator picks per zone in LayoutManagerModal: a concrete panel, or `null`/absent to collapse that zone out of the tree entirely. */
export type ZoneAssignment = Record<ZoneId, PanelId | null | undefined>

function zoneLeaf(zone: ZoneId): ZoneLeaf {
  return { type: 'leaf', zone }
}

function zoneSplit(
  id: string,
  orientation: Orientation,
  children: ZoneNode[],
  sizes: number[]
): ZoneSplit {
  return { type: 'split', id, orientation, children, sizes }
}

// ---------------------------------------------------------------------------
// The catalog. Zone ids are self-documenting for the 'default' template
// (audio/weather/fr24/video-rest, mirroring buildDefaultTree's shape so
// instantiating it with the identity assignment reproduces the same
// arrangement) and generic (zone-a/b/c/d) for the pure geometric templates.
// ---------------------------------------------------------------------------

const defaultTemplate: LayoutTemplate = {
  id: 'default',
  name: 'Default',
  tree: zoneSplit(
    'default-root',
    'horizontal',
    [
      zoneSplit(
        'default-audio-weather',
        'vertical',
        [zoneLeaf('audio'), zoneLeaf('weather')],
        [70, 30]
      ),
      zoneSplit(
        'default-right',
        'vertical',
        [zoneLeaf('fr24'), zoneLeaf(VIDEO_REST_ZONE)],
        [62, 38]
      )
    ],
    [22, 78]
  )
}

const twoByTwoTemplate: LayoutTemplate = {
  id: '2x2',
  name: '2 x 2',
  tree: zoneSplit(
    '2x2-rows',
    'vertical',
    [
      zoneSplit('2x2-row0', 'horizontal', [zoneLeaf('zone-a'), zoneLeaf('zone-b')], [50, 50]),
      zoneSplit('2x2-row1', 'horizontal', [zoneLeaf('zone-c'), zoneLeaf('zone-d')], [50, 50])
    ],
    [50, 50]
  )
}

const bigLeftTemplate: LayoutTemplate = {
  id: 'big-left',
  name: 'Big Left',
  tree: zoneSplit(
    'big-left-root',
    'horizontal',
    [
      zoneLeaf('zone-a'),
      zoneSplit('big-left-right', 'vertical', [zoneLeaf('zone-b'), zoneLeaf('zone-c')], [50, 50])
    ],
    [60, 40]
  )
}

const tallRightTemplate: LayoutTemplate = {
  id: 'tall-right',
  name: 'Tall Right',
  tree: zoneSplit(
    'tall-right-root',
    'horizontal',
    [
      zoneSplit('tall-right-left', 'vertical', [zoneLeaf('zone-a'), zoneLeaf('zone-b')], [50, 50]),
      zoneLeaf('zone-c')
    ],
    [40, 60]
  )
}

const threeColumnsTemplate: LayoutTemplate = {
  id: 'three-columns',
  name: 'Three Columns',
  tree: zoneSplit(
    'three-columns-root',
    'horizontal',
    [zoneLeaf('zone-a'), zoneLeaf('zone-b'), zoneLeaf('zone-c')],
    [34, 33, 33]
  )
}

/** The full snap-template gallery, in display order. */
export const layoutTemplates: readonly LayoutTemplate[] = [
  defaultTemplate,
  twoByTwoTemplate,
  bigLeftTemplate,
  tallRightTemplate,
  threeColumnsTemplate
]

function videoFeedIdOf(id: PanelId): string | null {
  return id.startsWith('video:') ? id.slice('video:'.length) : null
}

/**
 * Substitute concrete panels into `template`'s zones. An unassigned zone
 * (absent from `zoneAssignment`, or explicitly `null`) collapses out of the
 * tree, same as a 1-child split collapsing after a removal. `VIDEO_REST_ZONE`
 * instantiates to a balanced grid of every id in `openVideoIds` NOT already
 * placed by another zone's assignment. `null` if nothing survives at all
 * (every zone unassigned and no open videos for `video-rest`).
 */
export function instantiateTemplate(
  template: LayoutTemplate,
  zoneAssignment: ZoneAssignment,
  openVideoIds: readonly string[]
): LayoutNode | null {
  const assignedVideoIds = new Set<string>()
  for (const assigned of Object.values(zoneAssignment)) {
    if (!assigned) continue
    const feedId = videoFeedIdOf(assigned)
    if (feedId !== null) assignedVideoIds.add(feedId)
  }
  const restVideoIds = openVideoIds.filter((id) => !assignedVideoIds.has(id))

  function build(node: ZoneNode): LayoutNode | null {
    if (node.type === 'leaf') {
      if (node.zone === VIDEO_REST_ZONE) {
        return buildBalancedGrid(restVideoIds.map((id): PanelId => `video:${id}`))
      }
      const assigned = zoneAssignment[node.zone]
      return assigned ? { type: 'leaf', id: assigned } : null
    }

    const survivors: LayoutNode[] = []
    const survivorSizes: number[] = []
    for (let i = 0; i < node.children.length; i++) {
      const built = build(node.children[i])
      if (built === null) continue
      survivors.push(built)
      survivorSizes.push(node.sizes[i] ?? 0)
    }

    if (survivors.length === 0) return null
    if (survivors.length === 1) return survivors[0]
    return {
      type: 'split',
      id: node.id,
      orientation: node.orientation,
      children: survivors,
      sizes: normalizeSizes(survivorSizes)
    }
  }

  return build(template.tree)
}
