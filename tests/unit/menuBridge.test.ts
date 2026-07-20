import { describe, it, expect } from 'vitest'
import { buildMenuSyncPayload } from '@renderer/layout/menuBridge'
import { defaultFeeds } from '@renderer/youtube/defaultFeeds'
import type { PanelId } from '@shared/panelLayout'

// Guardian for the pure `layout:menuSync` derivation (PR4 of the
// panel-system effort — src/main/menu.ts renders the native Panels/Layout
// menu from exactly this payload shape). Kept Electron/DOM-free so it is
// directly vitest-importable, same discipline as dropZones.ts/videoGeometry.ts.

const ALL_VIDEO_IDS: PanelId[] = defaultFeeds.map((f) => `video:${f.id}` as PanelId)

describe('buildMenuSyncPayload', () => {
  it('lists the three fixed panels first, then every default video feed, in that order', () => {
    const payload = buildMenuSyncPayload([], null)
    const ids = payload.panels.map((p) => p.id)
    expect(ids.slice(0, 3)).toEqual(['audio', 'weather', 'fr24'])
    expect(ids.slice(3)).toEqual(ALL_VIDEO_IDS)
  })

  it('marks a panel open exactly when its id is in the open-leaf list', () => {
    const payload = buildMenuSyncPayload(['audio', 'fr24', ALL_VIDEO_IDS[0]], null)
    const byId = Object.fromEntries(payload.panels.map((p) => [p.id, p.open]))
    expect(byId.audio).toBe(true)
    expect(byId.weather).toBe(false)
    expect(byId.fr24).toBe(true)
    expect(byId[ALL_VIDEO_IDS[0]]).toBe(true)
    expect(byId[ALL_VIDEO_IDS[1]]).toBe(false)
  })

  it('carries the maximized panel id straight through unchanged', () => {
    expect(buildMenuSyncPayload([], 'fr24').maximizedPanelId).toBe('fr24')
    expect(buildMenuSyncPayload([], null).maximizedPanelId).toBeNull()
  })

  it('gives every panel a non-empty, human title', () => {
    const payload = buildMenuSyncPayload([], null)
    for (const panel of payload.panels) {
      expect(panel.title.length).toBeGreaterThan(0)
    }
    const audio = payload.panels.find((p) => p.id === 'audio')
    expect(audio?.title).toBe('ATC Audio')
  })

  it('excludes a video feed claimed by an open pop-out entirely, not just marked closed', () => {
    const excludedFeedId = defaultFeeds[0].id
    const payload = buildMenuSyncPayload([], null, new Set([excludedFeedId]))
    expect(payload.panels.map((p) => p.id)).not.toContain(`video:${excludedFeedId}`)
    // 3 fixed panels + every default feed except the one excluded.
    expect(payload.panels).toHaveLength(2 + defaultFeeds.length)
  })

  it('an empty exclusion set (the default) includes every default feed', () => {
    const payload = buildMenuSyncPayload([], null)
    expect(payload.panels).toHaveLength(3 + defaultFeeds.length)
  })
})
