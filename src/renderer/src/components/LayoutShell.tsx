import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ThemeMode } from '@shared/ipc'
import { collectLeafIds } from '@shared/panelLayout'
import AboutModal from './AboutModal'
import PanelCanvas from '../layout/PanelCanvas'
import { useAppStore, FR24_RELAYOUT_EVENT } from '../state/store'
import { sessionSnapshot } from '../state/sessionBootstrap'
// The adaptive Wyvern Watch mark (Cream light / Ember dark), imported as a bundled
// asset URL — never inlined as raw SVG — and rendered as a decorative <img>.
import brandMark from '../../../../design/brand/svg/icon.svg'

// Theme toggle (Wyvern Watch reskin, decision 2026-07-19): cycles System ->
// Cream -> Ember -> System. The click sends theme.set to the main process,
// which drives nativeTheme.themeSource — every window (main + pop-outs) and
// the OS chrome pick it up with no per-window sync code here. Local state only
// (no zustand slice) since this label is the only renderer-side consumer; the
// initial value comes from the synchronous session snapshot (see
// state/sessionBootstrap.ts), so it is correct on first paint, not just after
// the round trip to main.
const THEME_ORDER: readonly ThemeMode[] = ['system', 'light', 'dark']
const THEME_LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Cream', dark: 'Ember' }

function nextTheme(current: ThemeMode): ThemeMode {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]
}

// The app shell: a header (brand mark, theme toggle, About) plus the panel
// canvas — a single absolutely-positioned region hosting every open panel
// (ATC audio, field weather, FR24, one per video feed), replacing the old
// hard-coded react-resizable-panels Group/Panel/Separator tree (see
// docs/Panel-System-Plan.md). Panel content composition (which component a
// panel id mounts) lives in layout/LeafFrame.tsx, not here — this file only
// owns the header and the cross-cutting FR24 visibility rule.

function LayoutShell(): React.JSX.Element {
  const setNavState = useAppStore((s) => s.setNavState)
  const overlay = useAppStore((s) => s.overlay)
  const setOverlay = useAppStore((s) => s.setOverlay)
  const panelTree = useAppStore((s) => s.panelTree)
  const layoutRevision = useAppStore((s) => s.layoutRevision)
  const maximizedPanelId = useAppStore((s) => s.maximizedPanelId)
  const dragPanelId = useAppStore((s) => s.dragPanelId)
  const toggleMaximize = useAppStore((s) => s.toggleMaximize)

  // Seeded from the synchronous session snapshot (loaded before React mounts —
  // see main.tsx) so the label is correct on first paint, not a flash of
  // "System" while the async round trip settles.
  const [theme, setTheme] = useState<ThemeMode>(() => sessionSnapshot().theme)
  const cycleTheme = useCallback((): void => {
    setTheme((current) => {
      const next = nextTheme(current)
      void window.api.theme.set(next)
      return next
    })
  }, [])

  // Mirror FR24 nav-state pushes from main into the store. onNavState returns an
  // unsubscribe, so a StrictMode/HMR re-mount never stacks listeners.
  useEffect(() => window.api.fr24.onNavState(setNavState), [setNavState])

  // Escape restores a maximized panel from anywhere in the window (mirrors the
  // existing solo/fill-panel Escape patterns in AudioPanel/VideoGrid).
  useEffect(() => {
    if (maximizedPanelId === null) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') toggleMaximize(maximizedPanelId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [maximizedPanelId, toggleMaximize])

  // Consolidated FR24 visibility rule (LOAD-BEARING INVARIANT, decision
  // 2026-07-19; see docs/Panel-System-Plan.md § Store slice) — replaces the
  // old overlay-only effect. The native WebContentsView paints ABOVE all DOM,
  // so it must be hidden whenever ANY of these hold: its leaf isn't in the
  // tree at all (closed), a DOM overlay/modal is open, a header-drag is in
  // progress (dragPanelId; wired now for feature/panel-drag-dock), or some
  // OTHER panel is maximized.
  const fr24Visible = useMemo(
    () =>
      collectLeafIds(panelTree).includes('fr24') &&
      overlay === null &&
      dragPanelId === null &&
      (maximizedPanelId === null || maximizedPanelId === 'fr24'),
    [panelTree, overlay, dragPanelId, maximizedPanelId]
  )

  // Single-writer sequencing: a hide transition applies immediately (the
  // native view eats pointer events, so hiding it promptly is required, not
  // cosmetic). A hidden -> visible transition waits TWO rAF ticks after
  // whatever just changed the layout, so Fr24Panel's own ResizeObserver-driven
  // `fr24:setBounds` (reacting to the very same commit) lands first — without
  // this, reappearing could show one frame at stale bounds. Initialized to
  // `false` so a fr24Visible-true first mount also takes this path (there is
  // no prior bounds report on mount either).
  const prevFr24VisibleRef = useRef(false)
  useEffect(() => {
    if (fr24Visible === prevFr24VisibleRef.current) return
    prevFr24VisibleRef.current = fr24Visible

    if (!fr24Visible) {
      window.api.fr24.setVisible(false)
      return undefined
    }

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.api.fr24.setVisible(true)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [fr24Visible])

  // A structural tree commit (a settled splitter drag; a future open/close/
  // move/snap) nudges FR24 to re-measure. Fr24Panel's own rAF-throttled
  // ResizeObserver/listener does the actual work; Splitter also dispatches
  // this event live during a drag (layout/Splitter.tsx), not just on commit.
  useEffect(() => {
    window.dispatchEvent(new Event(FR24_RELAYOUT_EVENT))
  }, [layoutRevision])

  return (
    <div className="app-shell" data-fr24-hidden={fr24Visible ? undefined : 'true'}>
      <header className="app-header">
        <img className="app-brand-mark" src={brandMark} alt="" aria-hidden="true" />
        <h1 className="app-brand">Airshow Traffic Monitor</h1>
        <span className="app-badge">Phase 1 · skeleton</span>
        <div className="app-header-spacer" />
        <button
          type="button"
          className="theme-toggle-btn"
          aria-label={`Theme: ${THEME_LABEL[theme]} — click to cycle System, Cream, Ember`}
          title="Cycle theme (System / Cream / Ember)"
          onClick={cycleTheme}
        >
          Theme: {THEME_LABEL[theme]}
        </button>
        <button
          type="button"
          className="help-btn"
          aria-label="Help and About"
          title="Help / About"
          onClick={() => setOverlay('about')}
        >
          ?
        </button>
      </header>

      <div className="app-body">
        <PanelCanvas />
      </div>

      {overlay === 'about' && <AboutModal onClose={() => setOverlay(null)} />}
    </div>
  )
}

export default LayoutShell
