import { useColorScheme } from './useColorScheme';

/** Tokens shared by the salud + suscripciones screens. Lives here so constants/Colors (tab bar) stays untouched. */
export type Palette = {
  /** Page behind the cards. */
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  muted: string;
  track: string;
  accent: string;
  accentSoft: string;
  positive: string;
  positiveSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
};

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#f2f5f9',
    surface: '#ffffff',
    surfaceAlt: '#f2f5f9',
    border: '#e1e6ee',
    muted: '#5b6775',
    track: '#e4e9f1',
    accent: '#2f95dc',
    accentSoft: '#e3f0fa',
    positive: '#14804a',
    positiveSoft: '#e2f2ea',
    warning: '#9a5b00',
    warningSoft: '#fbeeda',
    danger: '#b3261e',
    dangerSoft: '#fbe6e4',
  },
  dark: {
    background: '#0f1216',
    surface: '#1a1f26',
    surfaceAlt: '#242b34',
    border: '#2c343e',
    muted: '#9aa6b4',
    track: '#2c343e',
    accent: '#5cb3ef',
    accentSoft: '#152935',
    positive: '#4cc38a',
    positiveSoft: '#173226',
    warning: '#e0a95b',
    warningSoft: '#33270f',
    danger: '#f2665c',
    dangerSoft: '#351a1a',
  },
};

export function usePalette(): Palette {
  return PALETTES[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
