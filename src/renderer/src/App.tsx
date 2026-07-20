import LayoutShell from './components/LayoutShell'

// The renderer root. LayoutShell renders the header plus the panel canvas
// (src/renderer/src/layout/PanelCanvas.tsx), which mounts ATC audio, field
// weather, FR24, and every video feed as first-class panels (see
// layout/LeafFrame.tsx) — this file no longer injects the audio panel via a
// slot prop, since LeafFrame hosts each panel body directly by panel id. The
// app's window/lifecycle wiring lives in the main process (src/main), and the
// native FlightRadar24 view is composited over its panel's region from there.
function App(): React.JSX.Element {
  return <LayoutShell />
}

export default App
