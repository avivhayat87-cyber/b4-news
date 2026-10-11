import { CATEGORIES } from '@b4/shared';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SealDot } from '@/components/brand';
import { BackChevron } from '@/components/top-bar';
import { colors, fonts, space } from '@/lib/theme';

export default function CategoriesScreen() {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.white }}>
      <Text style={styles.heading} accessibilityRole="header">
        קטגוריות
      </Text>
      <FlatList
        data={CATEGORIES}
        keyExtractor={(c) => c.slug}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: item.slug } })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.stone }]}
            accessibilityRole="link"
          >
            <SealDot size={22} />
            <Text style={styles.name}>{item.name}</Text>
            <View style={{ flex: 1 }} />
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <BackChevron />
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 16, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  name: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
});
