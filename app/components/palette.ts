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
  positive: string;
  positiveSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
};

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#F8F7F3',
    ambientCool: '#E8F3FA',
    ambientWarm: '#F2EDE4',
    surface: '#FFFDF9',
    surfaceAlt: '#F1F0EB',
    surfaceSage: '#E9EAE2',
    surfaceBlush: '#FCEAE8',
    surfaceMint: '#E7F4EB',
    border: '#DEDED8',
    ink: '#071A3D',
    muted: '#667080',
    track: '#DEDCD5',
    accent: '#005A91',
    accentDeep: '#001A3D',
    accentSoft: '#E5F0F7',
    positive: '#087A46',
    positiveSoft: '#DFF1E6',
    warning: '#95600B',
    warningSoft: '#F7ECD7',
    danger: '#D03027',
    dangerSoft: '#FBE5E2',
  },
  dark: {
    background: '#101821',
    ambientCool: '#142C3B',
    ambientWarm: '#26241F',
    surface: '#1A232D',
    surfaceAlt: '#222D37',
    surfaceSage: '#28302D',
    surfaceBlush: '#392421',
    surfaceMint: '#20342A',
    border: '#34404A',
    ink: '#F7F7F4',
    muted: '#AAB2BA',
    track: '#36414A',
    accent: '#70BCE5',
    accentDeep: '#D5EEFB',
    accentSoft: '#173548',
    positive: '#65CE98',
    positiveSoft: '#1B3B2B',
    warning: '#E5B56B',
    warningSoft: '#3B2E19',
    danger: '#FF766D',
    dangerSoft: '#422321',
  },
};

export function usePalette(): Palette {
  return PALETTES[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
