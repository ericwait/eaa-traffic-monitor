import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeedAudioState, VideoLayoutState } from '@shared/ipc'
import { defaultFeeds } from './youtube/defaultFeeds'
import { computeVideoLayout } from './youtube/layout'
import VideoTile from './components/VideoTile'
import { currentPopoutSlice } from './state/sessionBootstrap'

// The pop-out window's renderer — the SAME bundle as the main window, rendered
// grid-only (no ATC, no FR24) when the launch URL is `?window=popout&id=N`. It
// manages a subset of feeds handed off from the main grid, with its own layout
// and per-feed volumes, persisted back into its session slice through the
// windows:patchPopout channel so the whole arrangement survives a relaunch.
//
// Its layout state is LOCAL (not the main store's video slice) so a pop-out and
// the main window never share an emphasis/fill decision.

const { popoutId } = window.api.windows

function PopoutApp(): React.JSX.Element {
  const slice = useMemo(() => currentPopoutSlice(), [])

  // Feeds in the stable default order, filtered to this pop-out's set.
  const feeds = useMemo(() => {
    const ids = new Set(slice?.feedIds ?? [])
    return defaultFeeds.filter((f) => ids.has(f.id))
  }, [slice])

  const [video, setVideo] = useState<VideoLayoutState>(
    () => slice?.video ?? { mode: 'uniform', emphasizedFeedId: null, fillPanelFeedId: null }
  )
  const [volumes, setVolumes] = useState<Record<string, FeedAudioState>>(() => slice?.volumes ?? {})

  // Each handler persists its change into this pop-out's slice (debounced main-side).
  const toggleEmphasize = useCallback((feedId: string): void => {
    setVideo((prev) => {
      const already = prev.mode === 'emphasized' && prev.emphasizedFeedId === feedId
      const next: VideoLayoutState = {
        ...prev,
        mode: already ? 'uniform' : 'emphasized',
        emphasizedFeedId: already ? null : feedId
      }
      if (popoutId !== null) window.api.windows.patchPopout(popoutId, { video: next })
      return next
    })
  }, [])

  const setFill = useCallback((feedId: string | null): void => {
    setVideo((prev) => {
      const next: VideoLayoutState = { ...prev, fillPanelFeedId: feedId }
      if (popoutId !== null) window.api.windows.patchPopout(popoutId, { video: next })
      return next
    })
  }, [])

  const handleAudioChange = useCallback((feedId: string, state: FeedAudioState): void => {
    setVolumes((prev) => ({ ...prev, [feedId]: state }))
    if (popoutId !== null)
      window.api.windows.patchPopout(popoutId, { volumes: { [feedId]: state } })
  }, [])

  const emphasizedIndex = useMemo(() => {
    if (video.mode !== 'emphasized' || video.emphasizedFeedId == null) return null
    const idx = feeds.findIndex((f) => f.id === video.emphasizedFeedId)
    return idx === -1 ? null : idx
  }, [feeds, video])

  const layout = useMemo(
    () => computeVideoLayout(feeds.length, emphasizedIndex),
    [feeds.length, emphasizedIndex]
  )

  const fillFeed =
    video.fillPanelFeedId != null ? feeds.find((f) => f.id === video.fillPanelFeedId) : undefined

  // Escape exits fill-panel mode (matches the main grid).
  useEffect(() => {
    if (!fillFeed) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFill(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fillFeed, setFill])

  const audioFor = (feedId: string): FeedAudioState =>
    volumes[feedId] ?? { volume: 100, muted: true }

  if (feeds.length === 0) {
    // Defensive: the slice was missing or empty (a hand-edited session, or the
    // feeds rotated out). Say so rather than showing a blank window.
    return (
      <div className="popout-shell popout-empty" data-testid="popout-empty">
        <p>No feeds are assigned to this pop-out window.</p>
      </div>
    )
  }

  if (fillFeed) {
    const audio = audioFor(fillFeed.id)
    return (
      <div className="popout-shell">
        <div
          className="video-grid video-grid--fill"
          data-testid="popout-grid"
          data-layout-mode="fill"
        >
          <VideoTile
            key={fillFeed.id}
            feed={fillFeed}
            emphasized
            filled
            initialVolume={audio.volume}
            initialMuted={audio.muted}
            onAudioChange={(s) => handleAudioChange(fillFeed.id, s)}
            onToggleEmphasize={() => setFill(null)}
            onFillPanel={() => setFill(null)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="popout-shell">
      <div
        className={`video-grid video-grid--${video.mode}`}
        data-testid="popout-grid"
        data-layout-mode={video.mode}
        style={{
          gridTemplateColumns: layout.gridTemplateColumns,
          gridTemplateRows: layout.gridTemplateRows,
          gridTemplateAreas: layout.gridTemplateAreas
        }}
      >
        {feeds.map((feed, index) => {
          const audio = audioFor(feed.id)
          return (
            <VideoTile
              key={feed.id}
              feed={feed}
              area={layout.tileArea(index)}
              emphasized={video.mode === 'emphasized' && index === emphasizedIndex}
              filled={false}
              initialVolume={audio.volume}
              initialMuted={audio.muted}
              onAudioChange={(s) => handleAudioChange(feed.id, s)}
              onToggleEmphasize={() => toggleEmphasize(feed.id)}
              onFillPanel={() => setFill(feed.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

export default PopoutApp
