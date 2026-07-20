import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveAtcSearchResult } from '@shared/ipc'
import type { LiveAtcFeed } from '@shared/liveatcDirectory'
import { audioEngine } from './engine'

// The channel manager's Add-channel dialog: search LiveATC's directory for an
// airport, list its feeds, and add the ones not already configured. It overlaps
// the FR24 region, so it participates in the standing z-order pattern — it is
// rendered only while store.overlay === 'add-channel' (see AudioPanel), which
// hides the native FR24 view underneath (see LayoutShell / CLAUDE.md).
//
// Directory results are fetched main-side (browser UA) and cached there; the
// dialog only triggers a network fetch from an operator gesture (open / Search /
// Refresh) — never on a timer. Feeds already in the config are shown but
// disabled, so "what can I add?" and "what do I already have?" read in one list.
// A DOWN feed can still be added: at an airshow, feeds come and go, and adding
// a currently-down feed the night before is a normal move.

interface AddChannelModalProps {
  onClose: () => void
}

function AddChannelModal({ onClose }: AddChannelModalProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [icao, setIcao] = useState('')
  const [search, setSearch] = useState<LiveAtcSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  /** plsUrls already present in config — drives the "Added" disabled state. */
  const [configuredUrls, setConfiguredUrls] = useState<ReadonlySet<string>>(new Set())
  /** The mount of an add in flight (disables its button), or null. */
  const [pendingMount, setPendingMount] = useState<string | null>(null)
  /** A failed add's message — shown inline, cleared by the next attempt. */
  const [addError, setAddError] = useState<string | null>(null)

  const runSearch = useCallback(async (query: string, fresh: boolean): Promise<void> => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return
    setLoading(true)
    try {
      setSearch(await window.api.liveatc.search(trimmed, { fresh }))
    } finally {
      setLoading(false)
    }
  }, [])

  // On open: focus the search box, read which plsUrls are already configured,
  // seed the airport query from the configured weather station (KOSH by
  // default — the station of interest is the airport being monitored), and run
  // the initial search against the main-side cache.
  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    void (async () => {
      try {
        const { config } = await window.api.config.get()
        if (cancelled) return
        setConfiguredUrls(new Set(config.streams.map((s) => s.plsUrl)))
        const station = config.weather.station.toLowerCase()
        setIcao(station)
        void runSearch(station, false)
      } catch (err: unknown) {
        console.error('[audio] add-channel dialog could not read config:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runSearch])

  // Close on Escape — same shape as AboutModal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const addFeed = async (feed: LiveAtcFeed): Promise<void> => {
    setPendingMount(feed.mount)
    setAddError(null)
    try {
      const outcome = await audioEngine.addChannel(feed)
      if (outcome.ok) {
        setConfiguredUrls((prev) => new Set(prev).add(feed.plsUrl))
      } else {
        setAddError(outcome.error ?? 'could not add the channel')
      }
    } finally {
      setPendingMount(null)
    }
  }

  const feeds = search?.ok ? search.feeds : []

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="add-channel-modal">
      <div
        className="modal add-channel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-channel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-channel-title" className="modal-title">
          Add ATC channel
        </h2>
        <p className="modal-body modal-muted">
          Feeds come from LiveATC&apos;s directory for an airport code. Channels already on the
          panel are shown grayed out.
        </p>

        <form
          className="add-channel-search"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch(icao, false)
          }}
        >
          <label className="add-channel-icao-label" htmlFor="add-channel-icao">
            Airport
          </label>
          <input
            id="add-channel-icao"
            ref={inputRef}
            className="add-channel-icao"
            data-testid="add-channel-icao"
            type="text"
            value={icao}
            spellCheck={false}
            autoComplete="off"
            placeholder="e.g. kosh"
            onChange={(e) => setIcao(e.currentTarget.value)}
          />
          <button
            type="submit"
            className="add-channel-btn"
            data-testid="add-channel-search"
            disabled={loading || icao.trim().length === 0}
          >
            Search
          </button>
          <button
            type="button"
            className="add-channel-btn"
            data-testid="add-channel-refresh"
            title="Re-fetch the directory from LiveATC (results are otherwise cached for a few minutes)"
            disabled={loading || icao.trim().length === 0}
            onClick={() => void runSearch(icao, true)}
          >
            Refresh
          </button>
        </form>

        <div className="add-channel-results" data-testid="add-channel-results">
          {loading && <p className="add-channel-note">Searching LiveATC…</p>}

          {!loading && search && !search.ok && (
            <p className="add-channel-note add-channel-error" role="alert">
              {search.error}
            </p>
          )}

          {!loading && search?.ok && search.source === 'bundled' && (
            <p className="add-channel-note" data-testid="add-channel-bundled-note">
              LiveATC&apos;s directory is unreachable right now — showing the bundled KOSH feed list
              (live status unknown).
            </p>
          )}

          {!loading &&
            feeds.map((feed) => {
              const alreadyAdded = configuredUrls.has(feed.plsUrl)
              const freqText = feed.frequencies
                .map((f) => `${f.facility} ${f.frequencyMhz}`)
                .join(' · ')
              return (
                <div
                  key={feed.mount}
                  className="add-channel-feed"
                  data-testid={`add-channel-feed-${feed.mount}`}
                  data-added={alreadyAdded}
                >
                  <span
                    className="add-channel-status"
                    data-status={feed.status}
                    title={
                      feed.status === 'up'
                        ? 'Feed is up'
                        : feed.status === 'down'
                          ? 'Feed is down right now'
                          : 'Live status unknown (bundled list)'
                    }
                  />
                  <span className="add-channel-name" title={freqText || feed.name}>
                    {feed.name}
                    <span className="add-channel-meta">
                      {feed.status === 'down' ? 'down · ' : ''}
                      {freqText}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="add-channel-add"
                    data-testid={`add-channel-add-${feed.mount}`}
                    disabled={alreadyAdded || pendingMount !== null}
                    onClick={() => void addFeed(feed)}
                  >
                    {alreadyAdded ? 'Added' : pendingMount === feed.mount ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )
            })}
        </div>

        {addError && (
          <p className="add-channel-note add-channel-error" role="alert">
            {addError}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="modal-close" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddChannelModal
