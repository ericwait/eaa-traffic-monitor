import type { LiveAtcFeed } from './liveatcDirectory'
import koshFallback from './koshFallback.json'

// The bundled KOSH feed directory — the Add-channel dialog's offline fallback
// (decision 2026-07-19). LiveATC's search page sits behind Cloudflare and can
// block even well-behaved clients; at the show, "the directory is unreachable"
// must not mean "no channels can be added". This list was hand-curated from
// every OSH `.pls` on LiveATC (captured 2026-07-19, source: koshFallback.json)
// with operator-friendly names; it is served ONLY when a live search for
// osh/kosh fails, marked `source: 'bundled'` so the dialog can say so.
//
// Status is 'unknown' on every entry: a snapshot cannot know what is
// broadcasting right now, and a false "up" would invite connecting to a dead
// feed. Kept in shared so both the main-process fallback and tests use one list.

/** The airport queries the bundled fallback answers for. */
export const KOSH_FALLBACK_QUERIES: ReadonlySet<string> = new Set(['osh', 'kosh'])

const MOUNT_FROM_PLS = /\/play\/([A-Za-z0-9_.-]+)\.pls$/

/** The bundled KOSH feeds, in the curation's priority order. */
export const KOSH_FALLBACK_FEEDS: readonly LiveAtcFeed[] = [...koshFallback.streams]
  .sort((a, b) => a.priority - b.priority)
  .map((s) => ({
    mount: MOUNT_FROM_PLS.exec(s.plsUrl)?.[1] ?? s.id,
    plsUrl: s.plsUrl,
    name: s.label,
    status: 'unknown' as const,
    listeners: null,
    frequencies: []
  }))
