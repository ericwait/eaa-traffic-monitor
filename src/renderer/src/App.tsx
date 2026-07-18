import LayoutShell from './components/LayoutShell'

// The renderer root. Phase 1 mounts the three-panel walking skeleton; the app's
// window/lifecycle wiring lives in the main process (src/main), and the native
// FlightRadar24 view is composited over the tracking panel's region from there.
function App(): React.JSX.Element {
  return <LayoutShell />
}

export default App
