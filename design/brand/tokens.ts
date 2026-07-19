/**
 * DragonPlane design tokens (framework-agnostic).
 *
 * Mirror of tokens.css for TypeScript consumers. Pure data — no DOM or Electron
 * imports — so it is safe to place under `src/shared/` and import via `@shared/*`
 * from any process if you want a single source of truth.
 *
 * Themes: `light` (Cream Classic, default) and `dark` (Ember).
 */

export const palette = {
  light: {
    bg: '#F1EAD9',
    surface: '#FBF6EA',
    surface2: '#E7DDC8',
    border: '#D8CDB4',
    fg: '#21303A',
    fgMuted: '#566570',
    accent: '#C0392B',
    accentHover: '#A6301F',
    accentContrast: '#FBF6EA',
    secondary: '#7C8A93',
    focus: '#C0392B',
    ok: '#3E7C4F',
    warn: '#C08A2B',
    danger: '#C0392B',
    info: '#3E6C8A',
  },
  dark: {
    bg: '#161210',
    surface: '#201A17',
    surface2: '#2B2420',
    border: '#3A302A',
    fg: '#F0E9DE',
    fgMuted: '#B3A99B',
    accent: '#E4572E',
    accentHover: '#F26B44',
    accentContrast: '#161210',
    secondary: '#9AA7AD',
    focus: '#E4572E',
    ok: '#6FB07C',
    warn: '#E0B24E',
    danger: '#E4572E',
    info: '#7FB0CE',
  },
} as const;

/** Raw brand hues, for one-off needs (charts, prints). Prefer `palette`. */
export const brand = {
  cream: '#F1EAD9',
  slate: '#21303A',
  roundel: '#C0392B',
  steel: '#7C8A93',
  emberBg: '#161210',
  emberFg: '#F0E9DE',
  ember: '#E4572E',
} as const;

export const font = {
  display: '"Barlow Semi Condensed", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace',
} as const;

export const fontSize = {
  xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem',
  xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem',
} as const;

export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

export const space = {
  0: '0', 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem',
  5: '1.5rem', 6: '2rem', 7: '3rem', 8: '4rem',
} as const;

export const radius = {
  sm: '4px', md: '8px', lg: '12px', panel: '14px', pill: '999px',
} as const;

export const shadow = {
  light: {
    sm: '0 1px 2px rgba(20,24,28,0.10)',
    md: '0 4px 12px rgba(20,24,28,0.14)',
    lg: '0 12px 32px rgba(20,24,28,0.20)',
  },
  dark: {
    sm: '0 1px 2px rgba(0,0,0,0.4)',
    md: '0 4px 12px rgba(0,0,0,0.5)',
    lg: '0 12px 32px rgba(0,0,0,0.6)',
  },
} as const;

export const motion = {
  ease: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
  durFast: '120ms',
  durMed: '220ms',
} as const;

export type ThemeName = keyof typeof palette;
export type ThemeColors = (typeof palette)[ThemeName];

export const tokens = { palette, brand, font, fontSize, fontWeight, space, radius, shadow, motion } as const;
export default tokens;
