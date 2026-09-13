import { useColorScheme } from './useColorScheme';

export type Palette = {
  background: string;
  ambientCool: string;
  ambientWarm: string;
  surface: string;
  surfaceAlt: string;
  surfaceSage: string;
  surfaceBlush: string;
  surfaceMint: string;
  border: string;
  ink: string;
  muted: string;
  track: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  /** Fondo de botones principales. accentDeep se aclara en oscuro y el texto blanco dejaba de leerse. */
  primary: string;
  onPrimary: string;
  positive: string;
  positiveSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
};

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#070A0D',
    ambientCool: '#111720',
    ambientWarm: '#2A1119',
    surface: '#11161C',
    surfaceAlt: '#171D24',
    surfaceSage: '#101A18',
    surfaceBlush: '#211318',
    surfaceMint: '#10201B',
    border: 'rgba(255,255,255,0.09)',
    ink: '#F7F8FA',
    muted: '#959EAD',
    track: '#28313A',
    accent: '#FF3B57',
    accentDeep: '#FF536B',
    accentSoft: 'rgba(255,59,87,0.14)',
    primary: '#FF3B57',
    onPrimary: '#FFFFFF',
    positive: '#4FD29A',
    positiveSoft: 'rgba(79,210,154,0.14)',
    warning: '#F4B55D',
    warningSoft: 'rgba(244,181,93,0.14)',
    danger: '#FF536B',
    dangerSoft: 'rgba(255,59,87,0.14)',
  },
  dark: {
    background: '#070A0D',
    ambientCool: '#111720',
    ambientWarm: '#2A1119',
    surface: '#11161C',
    surfaceAlt: '#171D24',
    surfaceSage: '#101A18',
    surfaceBlush: '#211318',
    surfaceMint: '#10201B',
    border: 'rgba(255,255,255,0.09)',
    ink: '#F7F8FA',
    muted: '#959EAD',
    track: '#28313A',
    accent: '#FF3B57',
    accentDeep: '#FF536B',
    accentSoft: 'rgba(255,59,87,0.14)',
    primary: '#FF3B57',
    onPrimary: '#FFFFFF',
    positive: '#4FD29A',
    positiveSoft: 'rgba(79,210,154,0.14)',
    warning: '#F4B55D',
    warningSoft: 'rgba(244,181,93,0.14)',
    danger: '#FF536B',
    dangerSoft: 'rgba(255,59,87,0.14)',
  },
};

export function usePalette(): Palette {
  return PALETTES[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
