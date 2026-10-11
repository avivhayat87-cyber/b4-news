// B4 NEW'S brand tokens for the app (same values as the site, apps/web/app/globals.css).
import { Platform } from 'react-native';

// The reading start side (right in Hebrew). Devices run in RTL and resolve logical "start"
// to the right, but swap physical left/right; the web build resolves "start" as left.
// So: logical props on devices, physical right on the web.
const web = Platform.OS === 'web';
export const rtl = {
  atStart: (v: number) => (web ? { right: v } : { start: v }),
  padStart: (v: number) => (web ? { paddingRight: v } : { paddingStart: v }),
  marginStart: (v: number) => (web ? { marginRight: v } : { marginStart: v }),
  borderStart: (width: number, color: string) =>
    web ? { borderRightWidth: width, borderRightColor: color } : { borderStartWidth: width, borderStartColor: color },
};

export const colors = {
  brand: '#D9121F',
  brandDeep: '#A80E18',
  brandSoft: '#FFE3E5',
  ink: '#121214',
  ink2: '#4A4A52',
  muted: '#6B6B73',
  line: '#E6E4E1',
  lineSoft: '#EFEDEA',
  stone: '#F4F3F1',
  white: '#FFFFFF',
  pending: '#FFF4D6',
  pendingText: '#7A5600',
} as const;

// One family name per weight: Android does not pick weights from fontWeight for custom fonts.
export const fonts = {
  text: 'Heebo_400Regular',
  textSemi: 'Heebo_600SemiBold',
  textBold: 'Heebo_700Bold',
  textHeavy: 'Heebo_800ExtraBold',
  display: 'Rubik_800ExtraBold',
  displayBold: 'Rubik_700Bold',
  mono: 'Courier',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

const TONES = ['#2B3B50', '#353841', '#5E5139', '#2A4844', '#40354F', '#4D3E31', '#4A2023'] as const;

/** Muted placeholder color behind an image while it loads, or instead of a missing one. */
export function tone(seed: number): string {
  return TONES[Math.abs(seed) % TONES.length]!;
}
