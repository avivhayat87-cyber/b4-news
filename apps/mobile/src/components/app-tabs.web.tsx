// Web build: a bottom bar like the design canvas (native tabs have no web tab bar).
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, fonts } from '@/lib/theme';

type IconName = 'home' | 'person' | 'grid' | 'bookmark' | 'search';

function Icon({ name, color }: { name: IconName; color: string }) {
  const p = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      {name === 'home' ? <Path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" {...p} /> : null}
      {name === 'person' ? (
        <>
          <Circle cx={12} cy={8.5} r={3.5} {...p} />
          <Path d="M5 20c1-3.6 3.7-5.5 7-5.5s6 1.9 7 5.5" {...p} />
        </>
      ) : null}
      {name === 'grid' ? (
        <>
          <Rect x={4} y={4} width={6.5} height={6.5} rx={1.5} {...p} />
          <Rect x={13.5} y={4} width={6.5} height={6.5} rx={1.5} {...p} />
          <Rect x={4} y={13.5} width={6.5} height={6.5} rx={1.5} {...p} />
          <Rect x={13.5} y={13.5} width={6.5} height={6.5} rx={1.5} {...p} />
        </>
      ) : null}
      {name === 'bookmark' ? <Path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" {...p} /> : null}
      {name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={6.5} {...p} />
          <Path d="m20 20-4.2-4.2" {...p} />
        </>
      ) : null}
    </Svg>
  );
}

function TabButton({ isFocused, label, icon, ...props }: TabTriggerSlotProps & { label: string; icon: IconName }) {
  const color = isFocused ? colors.brand : colors.ink2;
  return (
    <Pressable {...props} style={styles.button} accessibilityState={{ selected: isFocused }}>
      <Icon name={icon} color={color} />
      <Text style={[styles.label, { color, fontFamily: isFocused ? fonts.textHeavy : fonts.textSemi }]}>{label}</Text>
    </Pressable>
  );
}

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList asChild>
        <View style={styles.bar}>
          <TabTrigger name="index" href="/" asChild>
            <TabButton label="בית" icon="home" />
          </TabTrigger>
          <TabTrigger name="my" href="/my" asChild>
            <TabButton label="הפיד שלי" icon="person" />
          </TabTrigger>
          <TabTrigger name="categories" href="/categories" asChild>
            <TabButton label="קטגוריות" icon="grid" />
          </TabTrigger>
          <TabTrigger name="saved" href="/saved" asChild>
            <TabButton label="שמורים" icon="bookmark" />
          </TabTrigger>
          <TabTrigger name="search" href="/search" asChild>
            <TabButton label="חיפוש" icon="search" />
          </TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white, paddingTop: 6, paddingBottom: 14 },
  button: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6 },
  label: { fontSize: 12 },
});
