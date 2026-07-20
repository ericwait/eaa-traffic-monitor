import { useLayoutEffect, useRef, useState } from 'react'
import type { PanelId, Rect } from '@shared/panelLayout'
import { computeAspectRect } from '@shared/videoGeometry'
import { useAppStore } from '../state/store'
import AudioPanel from '../audio/AudioPanel'
import WeatherPanel from '../weather/WeatherPanel'
import Fr24Panel from '../components/Fr24Panel'
import VideoTile from '../components/VideoTile'
import { defaultFeeds } from '../youtube/defaultFeeds'
import { panelHeadClassName, panelKind, panelTitle, videoFeedIdOf } from './panelMeta'
import PanelChromeButtons from './PanelChromeButtons'

// One absolutely-positioned leaf in the panel canvas. `rect` is style-only —
// see PanelCanvas.tsx's render-order comment: this component is mounted once
// per open panel id and never remounted by a rearrangement, only repositioned.
//
// Chrome note: AudioPanel/WeatherPanel/Fr24Panel already ship their OWN
// `.panel-head` (title + their own actions) unchanged from before this PR —
// see PanelChromeButtons.tsx's header comment for why this component does
// NOT wrap them in a second, duplicate header. Only the video body (which had
// no per-tile header before this PR) gets one built here.

interface LeafFrameProps {
  panelId: PanelId
  rect: Rect
  /** True for every non-maximized leaf while some OTHER leaf is maximized — visibility:hidden, never unmounted (players/streams keep running). */
  hidden: boolean
  isMaximized: boolean
}

interface VideoLeafBodyProps {
  panelId: PanelId
  toggleMaximize: () => void
}

function VideoLeafBody({ panelId, toggleMaximize }: VideoLeafBodyProps): React.JSX.Element {
  const feedId = videoFeedIdOf(panelId)
  const feed = defaultFeeds.find((f) => f.id === feedId)
  const title = panelTitle(panelId)
  const fitMode = useAppStore((s) => s.videoFit[feedId] ?? 'fit')
  const setVideoFit = useAppStore((s) => s.setVideoFit)
  const dragPanelId = useAppStore((s) => s.dragPanelId)

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
        onDoubleClick={toggleMaximize}
      >
        <h2 className="panel-title">{title}</h2>
        <div className="panel-head-spacer" />
        <PanelChromeButtons
          panelId={panelId}
          title={title}
          onPopOut={popOut}
          fit={{
            mode: fitMode,
            onToggle: () => setVideoFit(feedId, fitMode === 'fit' ? 'fill' : 'fit')
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

function LeafFrame({ panelId, rect, hidden, isMaximized }: LeafFrameProps): React.JSX.Element {
  const toggleMaximize = useAppStore((s) => s.toggleMaximize)
  const kind = panelKind(panelId)
  const doToggleMaximize = (): void => toggleMaximize(panelId)

  const style: React.CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  }

  let body: React.ReactNode
  switch (kind) {
    case 'audio':
      body = <AudioPanel />
      break
    case 'weather':
      body = <WeatherPanel />
      break
    case 'fr24':
      body = <Fr24Panel />
      break
    case 'video':
      body = <VideoLeafBody panelId={panelId} toggleMaximize={doToggleMaximize} />
      break
  }

  return (
    <div
      className={`leaf-frame${hidden ? ' leaf-frame--hidden' : ''}`}
      style={style}
      data-panel-id={panelId}
      data-maximized={isMaximized ? 'true' : undefined}
    >
      {body}
    </div>
  )
}

export default LeafFrame
