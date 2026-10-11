// The B4 seal logo drawn natively (same geometry as brand/b4-logo.svg).
import { View } from 'react-native';
import Svg, { Circle, G, Path, Polygon } from 'react-native-svg';
import { colors } from '@/lib/theme';

const B4_STROKES =
  'M8.5 0V80M8.5 8.5H37.5a12 12 0 0 1 12 12V27.5a12 12 0 0 1-12 12H8.5M8.5 39.5H39.5a12 12 0 0 1 12 12V59.5a12 12 0 0 1-12 12H8.5M118.5 0V80M68 55.5H134';

function Seal({ fill = colors.brand, ink = colors.white }: { fill?: string; ink?: string }) {
  return (
    <>
      <Circle cx="60" cy="60" r="58" fill={fill} />
      <Path d="M60 12A48 48 0 1 0 101.57 36" fill="none" stroke={ink} strokeWidth={3} strokeLinecap="round" />
      <Circle cx="84" cy="18.43" r="4.5" fill={ink} />
      <G transform="translate(26.5 40) scale(0.5)">
        <Path d={B4_STROKES} fill="none" stroke={ink} strokeWidth={17} />
        <Polygon points="106,0 127,0 89,52 68,52" fill={ink} />
      </G>
    </>
  );
}

/** Seal + NEW'S wordmark. */
export function Logo({ width = 128 }: { width?: number }) {
  const height = (width * 124) / 334;
  return (
    <Svg width={width} height={height} viewBox="0 0 334 124" accessibilityLabel="B4 NEW'S">
      <G transform="translate(2 2)">
        <Seal />
        <G transform="translate(144 36) scale(0.6)">
          <Path
            d="M8.5 0V80M53.5 0V80M78.5 0V80M78.5 8.5H120M78.5 40H115M78.5 71.5H120M303 8.5H267.5a12 12 0 0 0-12 12V28a12 12 0 0 0 12 12H282.5a12 12 0 0 1 12 12V59.5a12 12 0 0 1-12 12H247"
            fill="none"
            stroke={colors.ink}
            strokeWidth={17}
          />
          <Polygon points="0,0 20,0 62,80 42,80" fill={colors.ink} />
          <Polygon points="125,0 143,0 161,80 143,80" fill={colors.ink} />
          <Polygon points="143,80 161,80 183,0 165,0" fill={colors.ink} />
          <Polygon points="165,0 183,0 205,80 187,80" fill={colors.ink} />
          <Polygon points="187,80 205,80 223,0 205,0" fill={colors.ink} />
          <Polygon points="230,0 244,0 235,30 227,30" fill={colors.brand} />
        </G>
      </G>
    </Svg>
  );
}

/** The seal in miniature, opening every section title. */
export function SealDot({ size = 20 }: { size?: number }) {
  // Decorative: hidden from screen readers on every platform.
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 26 26">
        <Circle cx="13" cy="13" r="13" fill={colors.brand} />
        <Path d="M13 5.5A7.5 7.5 0 1 0 19.5 9.25" fill="none" stroke={colors.white} strokeWidth={1.8} strokeLinecap="round" />
        <Circle cx="16.75" cy="6.5" r="1.4" fill={colors.white} />
      </Svg>
    </View>
  );
}
