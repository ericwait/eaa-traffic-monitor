// Pure User-Agent hygiene for the FR24 browser view. Kept here (no Electron, no
// DOM) so the exact string transform is unit-testable — the FR24 Cloudflare
// challenge is the dominant Phase 1 risk, and "does the UA still read as plain
// Chrome?" is precisely the kind of thing that must not regress silently.

/**
 * Strip the Electron-identifying tokens from a default Electron user-agent so it
 * reads as an ordinary Chrome UA — Cloudflare hygiene for the FR24 view.
 *
 * Electron builds its default UA as (app name is not "Electron"):
 *   `Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) \
 *    <appName>/<ver> Chrome/<ver> Electron/<ver> Safari/537.36`
 * Both the `<appName>/<ver>` product token and the `Electron/<ver>` token give
 * away that this is not a stock browser. We remove both, leaving the
 * Chrome/Safari tokens intact.
 *
 * @param userAgent the default UA (e.g. `app.userAgentFallback`)
 * @param appName   the Electron app name (`app.getName()`) whose product token
 *                  should also be removed; omit if there is none to strip
 * @returns the cleaned UA with collapsed whitespace
 */
export function stripUserAgentTokens(userAgent: string, appName?: string): string {
  let ua = userAgent

  // Remove the `Electron/<version>` token (version may contain dots, dashes,
  // build metadata — match to the next space).
  ua = ua.replace(/\s*\bElectron\/\S+/gi, '')

  // Remove the app's own `<appName>/<version>` product token, if present. The
  // app name can contain regex-special characters, so escape it first.
  if (appName && appName.trim().length > 0) {
    const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ua = ua.replace(new RegExp(`\\s*\\b${escaped}\\/\\S+`, 'gi'), '')
  }

  // Collapse any doubled spaces left behind by the removals, and trim.
  return ua.replace(/\s{2,}/g, ' ').trim()
}
