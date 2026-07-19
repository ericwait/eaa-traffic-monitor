# DragonPlane — visual language

The mark for the EAA AirVenture traffic monitor.
A top-down view of a WWII-era, twin-prop warbird whose wings are dragon/bat wings.
Icon-only: there is no wordmark.

Semantic line breaks are used throughout this file (one sentence per line), matching the repo convention.

## The mark

The silhouette reads as a warbird planform from directly above:
a lengthened fuselage with a framed WWII canopy,
two propellers, and a tail plane.
The wings are the dragon: a bat-style membrane with a scalloped trailing edge and visible finger bones.

Three construction rules keep redraws consistent.

- **Golden-ish finger bones.**
  Each wing has four finger bones running from a shared wrist to the four wing edge points (the wingtip plus three trailing-edge scallop tips).
  Every bone has two knuckles at ~40% and ~72% of its length.
  Bones are drawn straight, and bent at the knuckles only as much as needed to stay inside the membrane.
- **Half-hidden propellers.**
  Each propeller hub sits exactly on the wing leading edge, and the disc is drawn behind the wing, so only the forward half shows.
  Blades are canted to 45°.
- **Contrails from the props, under the wing.**
  Vapor trails originate at each propeller and pass beneath the wing, tapering and fading toward the tail.

## Color

Two themes. Cream Classic is the light default; Ember is the dark theme.
Both are high-contrast, and each ships with its own background baked into the icon.

### Cream Classic (light, default)

| Role | Hex |
| --- | --- |
| Background | `#F1EAD9` |
| Airframe / text (ink) | `#21303A` |
| Accent (roundel red) | `#C0392B` |
| Secondary / contrails (steel) | `#7C8A93` |

### Ember (dark)

| Role | Hex |
| --- | --- |
| Background | `#161210` |
| Airframe / text (ink) | `#F0E9DE` |
| Accent (ember orange) | `#E4572E` |
| Secondary / contrails | `#F0E9DE` |

The full semantic set (surfaces, borders, muted text, states) lives in `tokens.css` and `tokens.ts`.
Prefer the semantic tokens (`--color-*`) over raw hues so light/dark stays automatic.

## Typography

No serifs anywhere.

- **Display / headings:** Barlow Semi Condensed — an industrial, gauge-like face that suits the aviation tone.
- **Body / UI:** Inter.
- **Numeric / data:** a monospace stack (`--font-mono`) for callsigns, frequencies, and altitudes, with tabular figures.

Uppercase, letter-spaced Barlow works well for panel headers (`.label-caps`).
If the web fonts are not bundled, every stack falls back to the native system sans, so nothing breaks.

## Clear space and minimum sizes

Keep clear space around the mark equal to the height of the canopy.
The full mark (with contrails, struts, and knuckle dots) is intended for ~32px and up.
Below that, use the reduced variants:

- `icon-simple*` drops the knuckle dots and canopy frame lines (good ~24–48px).
- `icon-micro` is a bare silhouette with props and canopy only (used for the 16px favicon).

## Asset inventory

```
design/brand/
  svg/
    icon.svg              adaptive (Cream light / Ember dark)   ← primary
    icon-cream.svg        fixed Cream Classic
    icon-ember.svg        fixed Ember
    icon-mono.svg         single-color, currentColor (tint in CSS)
    icon-simple.svg       adaptive, no dots/frames
    icon-simple-cream.svg / icon-simple-ember.svg
    icon-micro.svg        bare silhouette for tiny sizes
  png/
    favicon-16/32/48.png
    apple-touch-icon-180.png
    app-icon-cream-512/1024.png
    app-icon-ember-512/1024.png
  ico/favicon.ico         multi-size 16/32/48
  social/og-cream-1200x630.png, og-ember-1200x630.png
  tokens.css, tokens.ts, brand-preview.html, DESIGN-LANGUAGE.md
```

`icon-mono.svg` uses `currentColor`; tint it by setting `color` on the SVG or a parent, e.g. `color: var(--color-fg)`.

## Web favicon snippet

```html
<link rel="icon" href="/design/brand/svg/icon.svg" type="image/svg+xml">
<link rel="icon" href="/design/brand/ico/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/design/brand/png/apple-touch-icon-180.png">
```

## App packaging (electron-builder)

Point electron-builder at a 1024×1024 master; it derives platform formats.
Ember reads boldly as an app icon; Cream suits light contexts.

```jsonc
// electron-builder config
"mac":   { "icon": "design/brand/png/app-icon-ember-1024.png" },  // .icns generated
"win":   { "icon": "design/brand/ico/favicon.ico" },
"linux": { "icon": "design/brand/png/app-icon-ember-1024.png" }
```

For a true multi-resolution macOS `.icns`, run `iconutil` on macOS or `png2icns` from the 1024 master.

## Usage notes

- Do not recolor the mark outside the two theme palettes; use `icon-mono` if you need a single custom tint.
- Do not add a drop shadow or gradient to the airframe; the only gradient in the system is the contrail fade.
- Keep the accent for the canopy, prop hubs, and finger bones — it should stay a small proportion of the mark.
- The mark is symmetric; do not stretch it non-uniformly.
