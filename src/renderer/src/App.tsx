import LayoutShell from './components/LayoutShell'
import AudioPanel from './audio/AudioPanel'

// The renderer root. Phase 1 mounted the three-panel walking skeleton; Phase 2a
// fills the left pillar with the live ATC audio panel, injected into the layout
// shell's ATC slot. The app's window/lifecycle wiring lives in the main process
// (src/main), and the native FlightRadar24 view is composited over the tracking
// panel's region from there.
function App(): React.JSX.Element {
  return <LayoutShell atcSlot={<AudioPanel />} />
}

export default App
