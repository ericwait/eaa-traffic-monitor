import { useEffect, useMemo } from 'react'
import { useAppStore } from '../state/store'
import { defaultFeeds } from '../youtube/defaultFeeds'
import { computeVideoLayout } from '../youtube/layout'
import VideoTile from './VideoTile'

// The Live Video panel: tiles every configured feed at once (see
// docs/design/Video.md's "many eyes on the field" intent), in either a
// uniform grid or an emphasized 2x2-plus-rail layout, with a fill-panel state
// that hides the grid entirely in favor of one feed. Layout decisions live in
// the shared store (state/store.ts video slice) so double-click/fill-panel
// actions on one tile can affect the whole grid; per-tile playback/audio state
// stays local to VideoTile.

function VideoGrid(): React.JSX.Element {
  const videoLayoutMode = useAppStore((s) => s.videoLayoutMode)
  const emphasizedFeedId = useAppStore((s) => s.emphasizedFeedId)
  const fillPanelFeedId = useAppStore((s) => s.fillPanelFeedId)
  const toggleEmphasizedFeed = useAppStore((s) => s.toggleEmphasizedFeed)
  const setFillPanelFeedId = useAppStore((s) => s.setFillPanelFeedId)
  const exitFillPanel = useAppStore((s) => s.exitFillPanel)

  // Config-file-driven feeds are a later phase; the curated default list is
  // the Phase 3 stand-in (see youtube/defaultFeeds.ts header).
  const feeds = defaultFeeds

  const emphasizedIndex = useMemo(() => {
    if (emphasizedFeedId == null) return null
    const idx = feeds.findIndex((f) => f.id === emphasizedFeedId)
    return idx === -1 ? null : idx // a stale/removed emphasized id degrades to uniform, not a crash
  }, [feeds, emphasizedFeedId])

  const layout = useMemo(
    () => computeVideoLayout(feeds.length, emphasizedIndex),
    [feeds.length, emphasizedIndex]
  )

  const fillFeed = fillPanelFeedId != null ? feeds.find((f) => f.id === fillPanelFeedId) : undefined

  // Escape always exits fill-panel mode, from anywhere in the window.
  useEffect(() => {
    if (!fillFeed) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') exitFillPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fillFeed, exitFillPanel])

  if (fillFeed) {
    return (
      <div className="video-grid video-grid--fill" data-testid="video-grid" data-layout-mode="fill">
        <VideoTile
          key={fillFeed.id}
          feed={fillFeed}
          emphasized
          filled
          onToggleEmphasize={exitFillPanel}
          onFillPanel={exitFillPanel}
        />
      </div>
    )
  }

  return (
    <div
      className={`video-grid video-grid--${videoLayoutMode}`}
      data-testid="video-grid"
      data-layout-mode={videoLayoutMode}
      style={{
        gridTemplateColumns: layout.gridTemplateColumns,
        gridTemplateRows: layout.gridTemplateRows,
        gridTemplateAreas: layout.gridTemplateAreas
      }}
    >
      {feeds.map((feed, index) => (
        <VideoTile
          key={feed.id}
          feed={feed}
          area={layout.tileArea(index)}
          emphasized={videoLayoutMode === 'emphasized' && index === emphasizedIndex}
          filled={false}
          onToggleEmphasize={() => toggleEmphasizedFeed(feed.id)}
          onFillPanel={() => setFillPanelFeedId(feed.id)}
        />
      ))}
    </div>
  )
}

export default VideoGrid
