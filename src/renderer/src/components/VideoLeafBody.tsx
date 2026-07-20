import { useLayoutEffect, useRef, useState } from 'react'
import type { FeedAudioState } from '@shared/ipc'
import type { PanelId } from '@shared/panelLayout'
import { computeAspectRect } from '@shared/videoGeometry'
import { useLayoutController } from '../layout/LayoutController'
import { panelHeadClassName, panelTitle, videoFeedIdOf } from '../layout/panelMeta'
import PanelChromeButtons from '../layout/PanelChromeButtons'
import VideoTile from './VideoTile'
import { defaultFeeds } from '../youtube/defaultFeeds'

// The video leaf body: header chrome (title, fit toggle, pop out, plus the
// shared move/maximize/close buttons) around the fit/fill `.video-tile-stage`
// wrapper that positions the actual `VideoTile` (YouTube) player. This is the
// fourth leaf-body kind the main window supplies to the panel canvas via
// `renderLeafBody` (see components/LayoutShell.tsx's `renderMainLeafBody`) —
// AudioPanel/WeatherPanel/Fr24Panel are the other three. Previously this was
// a function defined inside layout/LeafFrame.tsx; moving it here (decision
// 2026-07-20) is what makes LeafFrame itself generic — see that file's header
// comment and layout/LayoutController.ts.
//
// Reads/writes layout state ONLY through `useLayoutController()`, never
// `useAppStore` directly, so this exact component (fit/fill stage math
// included) is also what a pop-out window's canvas renders for every one of
// its own video leaves (PopoutApp.tsx's `renderPopoutLeafBody`), against its
// own `usePopoutLayout` controller instead of the main window's store.

export interface VideoLeafBodyProps {
  panelId: PanelId
  /**
   * Present ONLY inside a pop-out window (decision 2026-07-20; see
   * docs/design/Layout.md's pop-out section). Pop-outs, unlike the main
   * window, persist a per-feed volume/mute state (`PopoutState.volumes`), so
   * this wires that through to `VideoTile`'s own mute/volume controls; the
   * main window's tiles pass no audio props at all (unchanged behavior).
   * Its presence also hides the header "pop out again" button (a pop-out's
   * feed is already in its own window) and the "Move panel…" button (a
   * pop-out's reorg path is header-drag-to-dock on its own canvas, not the
   * Move-panel modal — main-window-only by decision).
   */
  popout?: {
    initialVolume?: number
    initialMuted?: boolean
    onAudioChange: (state: FeedAudioState) => void
  }
}

function VideoLeafBody({ panelId, popout }: VideoLeafBodyProps): React.JSX.Element {
  const feedId = videoFeedIdOf(panelId)
  const feed = defaultFeeds.find((f) => f.id === feedId)
  const title = panelTitle(panelId)
  const controller = useLayoutController()
  const fitMode = controller.videoFit[feedId] ?? 'fit'
  const dragPanelId = controller.dragPanelId

  const slotRef = useRef<HTMLDivElement | null>(null)
  const [slotSize, setSlotSize] = useState({ width: 0, height: 0 })

  // Layout effect (not a plain effect): measures synchronously before paint so
  // a freshly-mounted tile never flashes at its stale (zero) stage size.
  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el) return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      setSlotSize({ width: r.width, height: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stageRect = computeAspectRect(slotSize, fitMode)

  // Pop-out-only — a video panel already inside a pop-out never opens a
  // SECOND pop-out for itself (see this component's `popout` prop doc
  // comment), so this handler/button only exists for the main window.
  const popOut = (): void => {
    void window.api.windows.openPopout({
      feedIds: [feedId],
      layout: { mode: 'uniform', emphasizedFeedId: null, fillPanelFeedId: null }
    })
  }

  return (
    <>
      <header
        className={panelHeadClassName('panel-head leaf-frame-head', panelId, dragPanelId)}
        onDoubleClick={() => controller.toggleMaximize(panelId)}
      >
        <h2 className="panel-title">{title}</h2>
        <div className="panel-head-spacer" />
        <PanelChromeButtons
          panelId={panelId}
          title={title}
          onPopOut={popout ? undefined : popOut}
          hideMove={popout !== undefined}
          fit={{
            mode: fitMode,
            onToggle: () => controller.setVideoFit(feedId, fitMode === 'fit' ? 'fill' : 'fit')
          }}
        />
      </header>
      <div className="panel-slot" ref={slotRef}>
        {feed && (
          <div
            className="video-tile-stage"
            data-fit-mode={fitMode}
            style={{
              left: stageRect.x,
              top: stageRect.y,
              width: stageRect.width,
              height: stageRect.height
            }}
          >
            <VideoTile
              feed={feed}
              fitMode={fitMode}
              initialVolume={popout?.initialVolume}
              initialMuted={popout?.initialMuted}
              onAudioChange={popout?.onAudioChange}
            />
          </div>
        )}
      </div>
    </>
  )
}

export default VideoLeafBody
