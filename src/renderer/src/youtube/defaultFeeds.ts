// EAA rotates which YouTube live videoIds are actually live — often daily
// during AirVenture — so this curated list is a dated snapshot, not a live
// feed of truth. Scraped 2026-07-18 (Phase 3 development) from
// https://www.youtube.com/@EAA/streams: fetched the raw HTML with a browser
// user agent, located the page's `ytInitialData` JSON, walked the selected
// "Live" tab's `richGridRenderer` contents, and kept only entries whose
// thumbnail carried a `THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE` badge (the actual
// "LIVE" badge YouTube renders) rather than a still-listed past broadcast.
// Seven cams were live at scrape time — more than the ~4-6 estimated going in,
// so all seven are kept.
//
// When a feed's videoId has rotated (EAA started a new stream under a new id,
// so this one now 404s or reports "not embeddable"), its tile simply shows
// its offline state — that is the DESIGNED behavior (see
// docs/design/Video.md § Risks and known limitations), not a bug to work
// around here.
//
// EDIT THIS FILE to update a stale feed: replace the videoId (and label, if
// the cam itself changed) for the entry that went dark. A human-editable
// config file the operator can change without touching source lands in a
// later phase — this hardcoded list is the Phase 3 stand-in.

export interface DefaultFeed {
  /** Stable id for this feed slot — used as the React key and store reference, independent of videoId churn. */
  id: string
  /** Human label shown in the tile's identity overlay and every status/error message. */
  label: string
  /** The YouTube videoId to embed. Rotates; see the file header. */
  videoId: string
}

export const defaultFeeds: DefaultFeed[] = [
  { id: 'warbirds', label: 'Warbirds', videoId: '8XtERF62tGA' },
  { id: 'ultralights', label: 'Ultralights', videoId: 'frrnSfxoFkM' },
  { id: 'seaplane-base', label: 'Seaplane Base', videoId: 'Kpr9ZJphux0' },
  { id: 'green-dot', label: 'Green Dot', videoId: 'CvBfCakKQOA' },
  { id: 'vintage', label: 'Vintage', videoId: 'ZAsxWfxeaVY' },
  { id: 'boeing-plaza', label: 'Boeing Plaza', videoId: 'rXH0zy6sLqo' },
  { id: 'featured', label: 'Featured Stream', videoId: 'J_xWAqcnRw4' }
]
