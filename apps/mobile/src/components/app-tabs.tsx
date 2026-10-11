// Native bottom tabs (iOS tab bar / Android navigation bar). Order flips automatically in RTL.
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { colors } from '@/lib/theme';

export default function AppTabs() {
  return (
    <NativeTabs tintColor={colors.brand} labelStyle={{ color: colors.ink2 }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>בית</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="categories">
        <NativeTabs.Trigger.Label>קטגוריות</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="grid_view" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>שמורים</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bookmark', selected: 'bookmark.fill' }} md="bookmark" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Label>חיפוש</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
