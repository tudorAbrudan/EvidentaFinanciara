/**
 * Design system – Mindify-inspired (sage / olive, fundal cald, butoane pill).
 * @see docs/DESIGN_SYSTEM.md (actualizat conceptual la paleta Mindify)
 */

export const primary = '#A3B86C';
export const primaryPressed = '#8FA05A';
/** Fundal ușor pentru butoane secundare (ex. Cancel în Mindify) */
export const primaryMuted = '#E8F0D8';
/** Badge / fundal discret pentru accente primary */
export const primaryTint = 'rgba(163, 184, 108, 0.16)';

/** Paleta severity pentru status bar auto */
export const statusColors = {
  ok: primary,
  warning: '#E8A53A',
  critical: '#D84C4C',
} as const;

export type StatusSeverity = 'ok' | 'warning' | 'critical';

/** Accent cald pentru zone sensibile (câmpuri private, avertismente blânde). */
export const sensitive = '#8a6d2f';
export const sensitiveBorder = '#d1b37a';
export const sensitiveBg = 'rgba(209, 179, 122, 0.08)';

export const light = {
  primary,
  primaryPressed,
  primaryMuted,
  primaryTint,
  sensitive,
  sensitiveBorder,
  sensitiveBg,
  text: '#1a1a1a',
  textSecondary: '#6b6b6b',
  /** Fundal ecran – ușor cald, integrat cu tab bar */
  background: '#F5F6F3',
  surface: '#ffffff',
  border: '#E8E9E4',
  tabIconDefault: '#9a9a9a',
  tabIconSelected: primary,
  card: '#ffffff',
  cardShadow: 'rgba(0,0,0,0.06)',
};

export const dark = {
  primary,
  primaryPressed: '#B8C98A',
  primaryMuted: 'rgba(163, 184, 108, 0.22)',
  primaryTint: 'rgba(163, 184, 108, 0.22)',
  sensitive: '#d1b37a',
  sensitiveBorder: '#8a6d2f',
  sensitiveBg: 'rgba(209, 179, 122, 0.12)',
  text: '#f5f5f5',
  textSecondary: '#a8a8a8',
  background: '#1a1b18',
  surface: '#242522',
  border: '#3a3b37',
  tabIconDefault: '#777',
  tabIconSelected: primary,
  card: '#242522',
  cardShadow: 'rgba(0,0,0,0.35)',
};

export type ColorScheme = 'light' | 'dark';

export default { primary, light, dark };
