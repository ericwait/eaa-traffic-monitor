import { useLayoutEffect, useRef, useState } from 'react'
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
// included) is what a pop-out window reuses for its own video tiles in the
// next PR, against its own controller instead of the main window's store.

export interface VideoLeafBodyProps {
  panelId: PanelId
}

function VideoLeafBody({ panelId }: VideoLeafBodyProps): React.JSX.Element {
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
          onPopOut={popOut}
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
            <VideoTile feed={feed} fitMode={fitMode} />
          </div>
        )}
      </div>
    </>
  )
}

export default VideoLeafBody
