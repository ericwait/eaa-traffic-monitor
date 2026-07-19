// Pure `.pls` playlist parser. LiveATC hands out `.pls` files (an INI-flavoured
// playlist format) from `/play/<mount>.pls`; the stream URL we actually want is
// the `File1=` entry. Kept here (no Electron, no DOM, no I/O) so the exact
// parse — and its tolerance for the messy real-world variants — is unit-testable.
//
// A `.pls` in the wild looks like:
//   [playlist]
//   numberofentries=1
//   File1=http://d.liveatc.net/kosh_twr?nocache=2026...
//   Title1=KOSH Twr
//   Length1=-1
//   Version=2
// but we must tolerate CRLF line endings, a UTF-8 BOM, a missing Title, blank
// and junk lines, and (defensively) entries numbered other than 1.

/** The one thing we need from a `.pls`: the stream URL and its optional title. */
export interface PlsEntry {
  /** The resolved `FileN=` value — the stream (or redirecting) URL. */
  url: string
  /** The `TitleN=` value if present, else null. */
  title: string | null
}

// FileN / TitleN keys, case-insensitively. The value is everything after the
// FIRST `=` (stream URLs carry `=` inside their query string, so we must not
// split on every `=`), with surrounding whitespace trimmed.
const FILE_LINE = /^\s*File(\d+)\s*=\s*(.+?)\s*$/i
const TITLE_LINE = /^\s*Title(\d+)\s*=\s*(.+?)\s*$/i

/**
 * Parse `.pls` text into the stream entry we care about.
 *
 * Picks the lowest-numbered `FileN` entry (normally `File1`) and pairs it with
 * the matching `TitleN` if one exists. Everything that is not a recognised
 * `FileN=`/`TitleN=` line — the `[playlist]` header, `numberofentries`,
 * `Length1`, `Version`, blank lines, stray junk — is ignored.
 *
 * @param text raw `.pls` file contents
 * @returns the chosen entry's `{ url, title }`
 * @throws if no usable `FileN=` entry with a non-empty value is present
 */
export function parsePls(text: string): PlsEntry {
  // Strip a leading UTF-8 BOM, then split on CR, LF, or CRLF.
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)

  const files = new Map<number, string>()
  const titles = new Map<number, string>()

  for (const line of lines) {
    const fileMatch = FILE_LINE.exec(line)
    if (fileMatch) {
      const index = Number(fileMatch[1])
      const value = fileMatch[2].trim()
      if (value.length > 0) files.set(index, value)
      continue
    }
    const titleMatch = TITLE_LINE.exec(line)
    if (titleMatch) {
      const index = Number(titleMatch[1])
      const value = titleMatch[2].trim()
      if (value.length > 0) titles.set(index, value)
    }
  }

  if (files.size === 0) {
    throw new Error('no File1 entry found in .pls playlist')
  }

  // Prefer File1; otherwise the lowest-numbered entry present.
  const chosen = Math.min(...files.keys())
  const url = files.get(chosen) as string
  const title = titles.get(chosen) ?? null

  return { url, title }
}
