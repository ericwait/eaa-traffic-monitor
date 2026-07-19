import { useCallback, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import Fr24Panel from './Fr24Panel'
import AboutModal from './AboutModal'
import VideoGrid from './VideoGrid'
import { useAppStore, FR24_RELAYOUT_EVENT } from '../state/store'

// The three-panel walking skeleton: ATC audio (left), flight tracking (top
// right), live video (bottom right). ATC and video are placeholders that Phases
// 2 and 3 fill; the flight-tracking panel is real — a native FR24 browser view
// tracked gap-free to a resizable DOM region, the foundational layout risk this
// phase de-risks.

// The ATC (left) panel content is injected as a slot so the audio pillar can be
// composed in from App without this shell importing it — keeps the audio and
// video tracks' edits to disjoint regions of this file. Defaults to the Phase 1
// placeholder when no slot is provided.
interface LayoutShellProps {
  atcSlot?: React.ReactNode
}

function LayoutShell({ atcSlot }: LayoutShellProps): React.JSX.Element {
  const setNavState = useAppStore((s) => s.setNavState)
  const overlayOpen = useAppStore((s) => s.overlayOpen)
  const setOverlayOpen = useAppStore((s) => s.setOverlayOpen)

  // Mirror FR24 nav-state pushes from main into the store. onNavState returns an
  // unsubscribe, so a StrictMode/HMR re-mount never stacks listeners.
  useEffect(() => window.api.fr24.onNavState(setNavState), [setNavState])

  // The z-order rule: the FR24 WebContentsView paints above all DOM, so any DOM
  // overlay must first hide it. Whenever overlayOpen flips, sync view visibility.
  useEffect(() => {
    window.api.fr24.setVisible(!overlayOpen)
  }, [overlayOpen])

  // A divider drag changes panel sizes; nudge the FR24 region to re-measure so
  // its native bounds track the divider. onLayoutChange fires on every pointer
  // move during the drag (the rAF throttle in Fr24Panel collapses the storm).
  const emitRelayout = useCallback((): void => {
    window.dispatchEvent(new Event(FR24_RELAYOUT_EVENT))
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-brand">Airshow Traffic Monitor</h1>
        <span className="app-badge">Phase 1 · skeleton</span>
        <div className="app-header-spacer" />
        <button
          type="button"
          className="help-btn"
          aria-label="Help and About"
          title="Help / About"
          onClick={() => setOverlayOpen(true)}
        >
          ?
        </button>
      </header>

      <div className="app-body">
        <Group orientation="horizontal" className="layout-group" onLayoutChange={emitRelayout}>
          <Panel id="atc" className="panel atc-panel" defaultSize="22" minSize="14">
            {atcSlot ?? (
              <section className="placeholder" aria-label="ATC Audio">
                <header className="panel-head">
                  <h2 className="panel-title">ATC Audio</h2>
                </header>
                <div className="placeholder-body">
                  <p className="placeholder-note">
                    Simultaneous LiveATC streams with per-stream volume, mute, and activity lights
                    land here in Phase 2a.
                  </p>
                </div>
              </section>
            )}
          </Panel>

          <Separator className="separator separator-vertical" />

          <Panel id="right" className="panel" defaultSize="78" minSize="40">
            <Group orientation="vertical" className="layout-group" onLayoutChange={emitRelayout}>
              <Panel id="fr24" className="panel" defaultSize="62" minSize="25">
                <Fr24Panel />
              </Panel>

              <Separator className="separator separator-horizontal" />

              <Panel id="video" className="panel video-panel" defaultSize="38" minSize="12">
                <section className="video-panel-section" aria-label="Live Video">
                  <header className="panel-head">
                    <h2 className="panel-title">Live Video</h2>
                  </header>
                  <VideoGrid />
                </section>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>

      {overlayOpen && <AboutModal onClose={() => setOverlayOpen(false)} />}
    </div>
  )
}

export default LayoutShell
