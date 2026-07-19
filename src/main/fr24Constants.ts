// FR24 view constants. Small and separate so the home preset is easy to find
// and change, and so the (Electron-free) values could later move into the
// config module without touching the view lifecycle in fr24.ts.

/**
 * The "home" preset — the operator's Oshkosh view (KOSH), centered on the field
 * at a zoom that shows the arrival/departure flow. FR24 encodes the map position
 * and zoom directly in the URL path (`/<lat>,<lon>/<zoom>`), so this single
 * string is the whole home view.
 *
 * Hard-coded for Phase 1; becomes config-driven in Phase 2a (the config file
 * gains a tracking home/URL field) — see docs/Implementation-Plan.md.
 */
export const FR24_HOME_URL = 'https://www.flightradar24.com/43.90,-88.77/12'

/**
 * The persistent session partition for the FR24 view. `persist:` makes cookies,
 * localStorage, and cache survive relaunch, so an FR24 Gold login and a passed
 * Cloudflare challenge carry over between sessions (see docs/design/Tracking.md).
 */
export const FR24_PARTITION = 'persist:fr24'

/** The registrable domain the FR24 panel is "at home" on. */
export const FR24_HOST_SUFFIX = 'flightradar24.com'

/**
 * How long to wait after the last navigation event before persisting the FR24
 * URL. FR24 fires `did-navigate-in-page` on every pan/zoom (history.replaceState),
 * so a debounce keeps us from writing session.json on every mouse move while
 * still capturing the final resting view.
 */
export const FR24_PERSIST_DEBOUNCE_MS = 2000
