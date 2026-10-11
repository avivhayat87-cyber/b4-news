// Header for pushed screens: back on the start side (right in Hebrew), actions on the end side.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, space } from '@/lib/theme';

export function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={({ pressed }) => [styles.icon, pressed && { opacity: 0.6 }]}>
      {children}
    </Pressable>
  );
}

export function BackChevron() {
  // Points right: "back" in a right-to-left interface.
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d="m9.5 5.5 6.5 6.5-6.5 6.5" fill="none" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TopBar({ title, actions }: { title?: string; actions?: ReactNode }) {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.bar}>
      <IconButton label="חזרה" onPress={back}>
        <BackChevron />
      </IconButton>
      {title ? (
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={{ flexDirection: 'row', gap: space.sm }}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, backgroundColor: colors.white },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.stone, alignItems: 'center', justifyContent: 'center' },
});
