import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeedAudioState, PopoutSummary, VideoLayoutState } from '@shared/ipc'
import { popoutSummaries } from '@shared/session'
import { defaultFeeds } from './youtube/defaultFeeds'
import { computeVideoLayout } from './youtube/layout'
import VideoTile from './components/VideoTile'
import { currentPopoutSlice, sessionSnapshot } from './state/sessionBootstrap'

// The pop-out window's renderer — the SAME bundle as the main window, rendered
// grid-only (no ATC, no FR24) when the launch URL is `?window=popout&id=N`. It
// manages a subset of feeds handed off from the main grid, with its own layout
// and per-feed volumes, persisted back into its session slice through the
// windows:patchPopout channel so the whole arrangement survives a relaunch.
//
// Its layout state is LOCAL (not the main store's video slice) so a pop-out and
// the main window never share an emphasis/fill decision.

const { popoutId } = window.api.windows

/** A feed id's display label, falling back to the raw id if it has rotated out of `defaultFeeds`. */
function feedLabel(feedId: string): string {
  return defaultFeeds.find((f) => f.id === feedId)?.label ?? feedId
}

/** "Warbirds", or "Warbirds + Ultralights" for a multi-feed pop-out; falls back to the window id if it somehow carries no feeds. */
function popoutLabel(summary: PopoutSummary): string {
  return summary.feedIds.length > 0
    ? summary.feedIds.map(feedLabel).join(' + ')
    : `Window ${summary.id}`
}

/**
 * The "Merge into…" control (decision 2026-07-20; see docs/design/Video.md §
 * Pop-outs and restore): lists every OTHER currently-open pop-out by its feed
 * label(s), and on a pick asks the main process to move THIS window's feeds
 * into the chosen target and close this window. Disabled — "No other
 * windows" — when this is the only pop-out open. Deliberately not
 * window-to-window drag (unreliable in Electron): the merge is always an
 * explicit selection from a list.
 */
function MergeIntoControl({ thisId }: { thisId: number }): React.JSX.Element {
  // Seeded from the bootstrap snapshot (already loaded before mount — see
  // sessionBootstrap.ts), then kept live by the same windows:popoutsChanged
  // broadcast the main grid uses for feed hand-off.
  const [others, setOthers] = useState<PopoutSummary[]>(() =>
    popoutSummaries(sessionSnapshot()).filter((p) => p.id !== thisId)
  )
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.api.windows.onPopoutsChanged((popouts) => {
        setOthers(popouts.filter((p) => p.id !== thisId))
      }),
    [thisId]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      const targetId = Number(e.currentTarget.value)
      e.currentTarget.value = ''
      if (!Number.isFinite(targetId)) return
      setMerging(true)
      setError(null)
      void window.api.windows.mergePopout(thisId, targetId).then((ok) => {
        setMerging(false)
        if (!ok) setError('Could not merge — the other window may have just closed.')
      })
    },
    [thisId]
  )

  const disabled = others.length === 0 || merging

  return (
    <div className="popout-toolbar" data-testid="popout-toolbar">
      <div className="merge-into">
        <label htmlFor="merge-into-select" className="merge-into-label">
          Merge into
        </label>
        <select
          id="merge-into-select"
          className="merge-into-select"
          data-testid="merge-into-select"
          disabled={disabled}
          value=""
          title={others.length === 0 ? 'No other pop-out windows are open' : undefined}
          onChange={handleChange}
        >
          <option value="" disabled>
            {others.length === 0 ? 'No other windows' : merging ? 'Merging…' : 'Merge into…'}
          </option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {popoutLabel(p)}
            </option>
          ))}
        </select>
        {error && (
          <span className="merge-into-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

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
        {popoutId !== null && <MergeIntoControl thisId={popoutId} />}
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
      {popoutId !== null && <MergeIntoControl thisId={popoutId} />}
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
