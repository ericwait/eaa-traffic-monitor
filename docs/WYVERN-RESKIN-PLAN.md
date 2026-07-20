# Re-skin the app with the Wyvern Watch brand system (Phase 6 token/typography slice)

## Context

The running renderer still wears the provisional dark-only blue skin hardcoded in `src/renderer/src/assets/main.css` (`--accent: #3fb0ff` etc.), while a complete, dual-theme brand system — **Wyvern Watch**, Cream Classic (light) / Ember (dark) — sits unused in `design/brand/` (`DESIGN-LANGUAGE.md`, `tokens.css`, `tokens.ts`, `brand-preview.html`). This is exactly the "token adoption + typography" scope of **Phase 6 — Brand application** in `docs/Implementation-Plan.md` (the packaging-icon and docs-site items of Phase 6 are separate slices, out of scope here).

User decisions already made:
- **Theme selection:** follow the OS by default **plus** an in-app toggle (System / Cream / Ember) that persists across restarts.
- **Typography:** bundle Barlow Semi Condensed + Inter as **woff2 files committed to the repo** (offline-safe, no CDN, no npm font deps). Mono stays the system stack.

Why the migration is low-risk: components are ~100% styled via classes → CSS custom properties. Only ~8 literal hexes exist in the pre-channel-manager `main.css`; no component sets a color inline. Note: the channel-manager work (Phase 7) appended ~235 lines at the end of `main.css` that mostly ride existing tokens but add one more literal hex — `#263141` on `.add-channel-status` — so the audit below must cover that block too.

## Branch

New branch `feature/wyvern-skin` off `develop` (current `feature/channel-manager` is unrelated). PR targets `develop`. Merge commits only.

## Step 1 — Adopt the tokens (colors, radii, motion)

**Files:** `src/renderer/src/main.tsx`, `src/renderer/src/assets/main.css`, `design/brand/tokens.css`.

1. Import the canonical token file directly in `src/renderer/src/main.tsx`, **before** `main.css`:
   ```ts
   import '../../../design/brand/tokens.css'
   import './assets/main.css'
   ```
   Vite bundles CSS imports at build time, so a path outside the renderer root works in dev and in the packaged loopback-server build (verify once in `just up`). Single source of truth — no copy to drift. *(decision stamp: canonical import over copying, 2026-07-19 — inline comment in main.tsx + row in `docs/decisions/README.md`, same commit.)*
2. Replace the legacy `:root` block in `main.css` with a **compatibility alias layer** so all 1227 lines re-point at once:
   ```css
   :root {
     --bg: var(--color-bg);
     --panel: var(--color-surface);
     --panel-2: var(--color-surface-2);
     --ink: var(--color-fg);
     --muted: var(--color-fg-muted);
     --accent: var(--color-accent);
     --line: var(--color-border);
     --line-strong: color-mix(in srgb, var(--color-border) 60%, var(--color-fg));
   }
   ```
   Remove `color-scheme: dark` (tokens.css owns `color-scheme: light dark`). Keep the alias layer permanently — a full var rename across main.css is optional follow-up, not this PR.
3. Add the missing semantic tokens to `design/brand/tokens.css` (both theme blocks *and* the `[data-theme="dark"]` force block), because status/category colors carry aviation meaning and must not ride on UI accent colors:
   - `--color-reconnect` (light `#B26A00` amber-copper / dark `#FF9E4A`) — the audio "reconnecting" state.
   - `--color-cat-vfr / -mvfr / -ifr / -lifr` — keep the green / blue / red / magenta hue families, tuned per surface (light: `#3E7C4F / #3E6C8A / #C0392B / #8E44AD`; dark: `#6FB07C / #7FB0CE / #E06055 / #CE7FD0`). Note dark IFR gets a true red distinct from the Ember orange accent. Fine-tune against `design/brand/brand-preview.html`.
4. Re-point the locally scoped tokens:
   - `.audio-panel` (main.css ~line 638): `--ok: var(--color-ok)`, `--warn: var(--color-warn)`, `--bad: var(--color-danger)`, `--reconn: var(--color-reconnect)`.
   - `.weather-panel` (~line 1027): `--vfr: var(--color-cat-vfr)` etc.
5. Fix the literal hexes (the ~8 pre-existing ones plus channel-manager's `#263141`):
   - `#05202f` accent-contrast text (modal close ~376, solo button ~964) → `var(--color-accent-contrast)`.
   - `#263141` channel-manager status dot (`.add-channel-status`, in the appended block near the file end) → a token-derived neutral (e.g. `var(--color-surface-2)` or a `color-mix` on `--color-border`); verify the down/default dot stays legible in both themes.
   - `rgba(3,6,10,…)` overlay scrims (~326, ~510, ~556) → `color-mix(in srgb, var(--color-bg) N%, transparent)` so scrims stay theme-correct.
   - `#3ddc84` LIVE badge (~534) → `var(--color-ok)`.
   - Video-tile placeholder gradient `#05070a`/`#10151c` (~428, ~476) → **keep deliberately dark in both themes** (it stands in for video content, which is dark regardless of theme); add a comment saying so.
6. Light-theme audit pass over `main.css` by category, checked visually in both themes against `brand-preview.html`:
   - box-shadows/glows written for dark grounds (activity-light glow `.activity-light`, ~774–792) — verify the lit/unlit distinction survives on cream; if weak, add a border-color shift alongside the glow. The light must stay clearly visible **while muted** (design contract).
   - any remaining dark-assuming rgba borders/hover fills → `color-mix` with tokens.
   - the appended channel-manager block (~235 lines at the file end: add-channel modal, status dots incl. the `#263141` fix above, drag/remove affordances) — audit it in both themes like the rest; it mostly rides existing tokens, so it migrates for free through the alias layer, but the status dots assume a dark ground.
   - radii: adopt `--radius-panel`/`--radius-md` where main.css hardcodes px (mechanical, low priority — only where touched).

**Commit 1:** "Adopt the Wyvern Watch tokens in the renderer" (+ decision rows).

## Step 2 — Typography

**Files:** `src/renderer/src/assets/fonts/` (new), `src/renderer/src/assets/fonts.css` (new), `main.tsx`, `main.css`.

1. Download latin-subset woff2 at implementation time (Google Fonts static files): Barlow Semi Condensed **500/600/700**, Inter **400/500/600** — the exact weights `tokens.css` uses. Six files under `src/renderer/src/assets/fonts/`. woff2 is not LFS-routed and `.gitattributes` stays untouched (per CLAUDE.md); commit as normal binaries (~<200 KB total). *(decision stamp: bundled woff2, no CDN — offline at the airfield, 2026-07-19.)*
2. `fonts.css` with six `@font-face` rules, `font-display: swap`; import in `main.tsx` before tokens.css.
3. `main.css` typography adoption:
   - `body` font-family → `var(--font-sans)`.
   - Header `<h1>` and panel titles (`.panel-title`, `.app-header h1`) → `var(--font-display)` with the `.label-caps` treatment (uppercase, `--tracking-caps`) for panel headers, per DESIGN-LANGUAGE.md.
   - Frequencies/callsigns/URLs already use a ui-monospace stack → re-point to `var(--font-mono)` and add `font-variant-numeric: tabular-nums` where numbers tick (weather, stream strip).
   - Restyle the header badge ("Phase 1 · skeleton") with token colors only — text content untouched.

**Commit 2:** "Bundle the brand fonts and adopt the type stacks" (+ decision row).

## Step 3 — Theme toggle (System / Cream / Ember)

**Architecture:** the toggle drives `nativeTheme.themeSource` in the **main process** — flipping it changes `prefers-color-scheme` in every renderer at once, so the pop-out windows and OS window chrome follow automatically with zero per-window sync code, and `tokens.css` needs no `data-theme` plumbing. Persist the choice in the existing session store. *(decision stamp in `src/main/ipc.ts` or session.ts + row, same commit.)*

**Files:** `src/shared/ipc.ts`, `src/shared/session.ts`, `src/main/session.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts` + `index.d.ts`, `src/renderer/src/components/LayoutShell.tsx`, `main.css`, `tests/unit/session.test.ts`.

1. `src/shared/session.ts`: add `theme: 'system' | 'light' | 'dark'` to `SessionState` (default `'system'`) and to `SessionPatch`; keep the pure merge in lockstep.
2. `src/shared/ipc.ts`: add channel following the existing naming style:
   - `themeSet: 'theme:set'` (renderer → main, invoke) — payload `'system' | 'light' | 'dark'`.
   - Current value is read via the existing `session:get`; no new getter channel.
3. Main: on `theme:set` → set `nativeTheme.themeSource`, persist via the session store's existing write path. On app ready (`src/main/index.ts`), apply the persisted value before windows are created.
4. Preload: expose `themeSet` alongside the existing bridge surface, mirroring current patterns in `src/preload/index.ts` / `index.d.ts`.
5. Renderer: a small cycling button in the `.app-header` (right side, near the About trigger): System → Cream → Ember → System, showing the active mode (e.g. "Theme: System"). Reads initial value from the session bootstrap (`state/sessionBootstrap.ts` already fetches `session:get`). No zustand slice needed beyond the current mode for the label.
6. Tests: extend `tests/unit/session.test.ts` for the new field's default and merge behavior.

**Commit 3:** "Add the persisted Cream/Ember theme toggle" (+ decision row).

## Step 4 — Docs

- `docs/Implementation-Plan.md`: this trim is already done — the shipped brand slices (packaging icons, renderer favicon, in-app mark; PR #25) were cut to a Progress-log row, and Phase 6 now reads as this plan's skin/type/theme remainder plus the residual docs-site social/OG item. When this plan ships, append its own Progress-log line. Semantic line breaks.
- `docs/decisions/README.md`: rows land with their stamping commits (steps 1–3), not here.

**Commit 4:** "Record the brand-application progress in the plan doc".

## Verification

1. `just lint`, `just typecheck`, `just fmt`, `just test` — all clean (session tests updated in step 3).
2. `just dev` manual checklist:
   - Cream and Ember both render: header, three panels, About modal, audio strip, weather card, video grid.
   - Toggle cycles System/Cream/Ember; **pop-out window follows instantly** (nativeTheme propagation).
   - Restart the app → theme choice restored (session persistence).
   - Activity lights clearly visible lit vs unlit in **both** themes, including on a muted stream.
   - Weather category badge readable "from across the room" in both themes (VFR/MVFR/IFR/LIFR hues intact).
   - About modal still hides the FR24 native view (`overlayOpen` contract untouched).
   - Fonts render as Barlow Semi Condensed / Inter (check devtools computed styles), tabular numerics on frequencies.
3. `just up` — packaged loopback build: tokens.css and woff2 assets load (confirms the outside-root import bundles correctly).
4. `just e2e` smoke.

## Risks / notes

- `color-mix()` is fine in Electron 43's Chromium.
- If the Vite import of `design/brand/tokens.css` from outside the renderer root misbehaves in dev (fs.allow), fallback is a one-line `@import` from `main.css` or copying the file into assets — but direct import should work since the workspace root is the git root.
- tokens.css ships its own minimal base layer (body/h1–4/a/focus/selection rules). Import order (tokens first, main.css second) lets main.css keep ownership; delete any main.css rules that become redundant rather than fighting specificity.
- The brand mark `<img>` (`LayoutShell.tsx:58`, `AboutModal.tsx:39`) is already adaptive via its internal media query — nativeTheme flips it for free; no change needed.
