import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeedAudioState, PopoutSummary } from '@shared/ipc'
import { popoutSummaries } from '@shared/session'
import type { PanelId } from '@shared/panelLayout'
import { LayoutControllerProvider } from './layout/LayoutController'
import PanelCanvas from './layout/PanelCanvas'
import { videoFeedIdOf } from './layout/panelMeta'
import { usePopoutLayout } from './layout/usePopoutLayout'
import VideoLeafBody from './components/VideoLeafBody'
import { defaultFeeds } from './youtube/defaultFeeds'
import { currentPopoutSlice, sessionSnapshot } from './state/sessionBootstrap'

// The pop-out window's renderer — the SAME bundle as the main window, mounted
// when the launch URL is `?window=popout&id=N`. It manages a subset of feeds
// handed off from the main grid, on the SAME panel canvas the main window
// uses (decision 2026-07-20; see docs/design/Layout.md's pop-out section) —
// split, resize, drag-to-dock, maximize, and per-feed fit/fill all work
// exactly as they do in the main window, scoped to this window's own feeds.
// `usePopoutLayout` is this window's LayoutController, backed by LOCAL React
// state (not the main window's zustand store) so a pop-out and the main
// window never share an arrangement; its tree/videoFit persist back into
// this pop-out's own PopoutState slice through the windows:patchPopout
// channel so the whole arrangement survives a relaunch. The Layout Manager
// and named profiles stay main-window-only; a pop-out's reorg path is
// header-drag-to-dock on this canvas (or the native Panels/Move-panel
// affordances, which don't apply here since pop-outs have no menu of their
// own beyond the OS default).

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
  const { controller, volumes, setFeedAudio } = usePopoutLayout(popoutId, slice)

  // Escape restores a maximized panel — mirrors LayoutShell's main-window rule.
  useEffect(() => {
    if (controller === null || controller.maximizedPanelId === null) return
    const maximizedId = controller.maximizedPanelId
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') controller.toggleMaximize(maximizedId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller])

  // Every leaf in a pop-out's tree is a `video:` leaf (pop-outs have only
  // video panels) — wires this pop-out's own per-feed audio state through to
  // VideoLeafBody's `popout` prop (see that component's doc comment for why
  // this differs from the main window, which passes no audio props at all).
  const renderLeafBody = useCallback(
    (panelId: PanelId): React.ReactNode => {
      const feedId = videoFeedIdOf(panelId)
      const audio = volumes[feedId] ?? { volume: 100, muted: true }
      return (
        <VideoLeafBody
          panelId={panelId}
          popout={{
            initialVolume: audio.volume,
            initialMuted: audio.muted,
            onAudioChange: (state: FeedAudioState) => setFeedAudio(feedId, state)
          }}
        />
      )
    },
    [volumes, setFeedAudio]
  )

  if (controller === null) {
    // Defensive: the slice was missing or empty (a hand-edited session, or
    // every feed rotated out). Say so rather than showing a blank window.
    return (
      <div className="popout-shell popout-empty" data-testid="popout-empty">
        {popoutId !== null && <MergeIntoControl thisId={popoutId} />}
        <p>No feeds are assigned to this pop-out window.</p>
      </div>
    )
  }

  return (
    <div className="popout-shell">
      {popoutId !== null && <MergeIntoControl thisId={popoutId} />}
      <div className="popout-canvas-wrap" data-testid="popout-canvas">
        <LayoutControllerProvider value={controller}>
          <PanelCanvas renderLeafBody={renderLeafBody} />
        </LayoutControllerProvider>
      </div>
    </div>
  )
}

export default PopoutApp
