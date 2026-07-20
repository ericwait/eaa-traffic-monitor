// Panel identity metadata: PanelId -> a human title and a coarse "kind" (which
// body component LeafFrame mounts). `@shared/panelLayout` itself cannot own
// this — it must stay Electron/DOM-free and knows nothing about
// `youtube/defaultFeeds.ts`, which is renderer-owned (see that module's
// buildDefaultTree doc comment).

import type { PanelId } from '@shared/panelLayout'
import { defaultFeeds } from '../youtube/defaultFeeds'

export type PanelKind = 'audio' | 'weather' | 'fr24' | 'video'

const VIDEO_PREFIX = 'video:'

/** Which body component a panel id maps to. */
export function panelKind(id: PanelId): PanelKind {
  if (id === 'audio') return 'audio'
  if (id === 'weather') return 'weather'
  if (id === 'fr24') return 'fr24'
  return 'video'
}

/** The bare feed id for a `video:${feedId}` panel id (unchecked — only meaningful once `panelKind(id) === 'video'`). */
export function videoFeedIdOf(id: PanelId): string {
  return id.slice(VIDEO_PREFIX.length)
}

const KIND_TITLES: Record<Exclude<PanelKind, 'video'>, string> = {
  audio: 'ATC Audio',
  weather: 'Field Weather',
  fr24: 'Flight Tracking'
}

/** The title shown in a panel's chrome — the feed's own label for video panels, falling back to the bare feed id if it has rotated out of `defaultFeeds`. */
export function panelTitle(id: PanelId): string {
  const kind = panelKind(id)
  if (kind === 'video') {
    const feedId = videoFeedIdOf(id)
    return defaultFeeds.find((f) => f.id === feedId)?.label ?? feedId
  }
  return KIND_TITLES[kind]
}

/**
 * The `.panel-head` className for panel `id`, given the store's current
 * `dragPanelId` — appends the static `panel-head--draggable` affordance class
 * (every header is a drag source, see layout/useHeaderDrag.ts) plus
 * `panel-head--dragging` while THIS panel is the one actually being
 * header-dragged (docs/Panel-System-Plan.md's CSS section). `base` is the
 * panel's own existing header class string (e.g. `'panel-head audio-head'`)
 * — AudioPanel/WeatherPanel/Fr24Panel/LeafFrame's video head each call this
 * rather than reimplementing the same string-building four times.
 */
export function panelHeadClassName(base: string, id: PanelId, dragPanelId: PanelId | null): string {
  return `${base} panel-head--draggable${dragPanelId === id ? ' panel-head--dragging' : ''}`
}
