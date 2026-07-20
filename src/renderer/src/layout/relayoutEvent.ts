/**
 * Custom DOM event the layout dispatches when a resizable panel divider moves,
 * so the FR24 region can re-measure and re-sync its native view bounds. A
 * plain window event keeps the layout and the FR24 panel decoupled and avoids
 * a store write (and re-render) on every pointer move during a drag.
 *
 * Lives here — not in `state/store.ts` — so the window-agnostic panel canvas
 * (Splitter.tsx dispatches this during a live splitter drag) never needs to
 * import the main window's zustand store just for a constant string.
 * `state/store.ts` re-exports it unchanged for its existing consumers
 * (LayoutShell.tsx, Fr24Panel.tsx), so nothing outside this file and
 * Splitter.tsx needed to change (decision 2026-07-20; see LayoutController.ts
 * and docs/decisions/README.md).
 */
export const FR24_RELAYOUT_EVENT = 'fr24-relayout'
