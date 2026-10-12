import { CATEGORIES } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SealDot } from '@/components/brand';
import { BackChevron } from '@/components/top-bar';
import { SITE_URL, api } from '@/lib/api';
import { colors, fonts, space } from '@/lib/theme';

const SOCIAL_LABELS: Record<string, string> = {
  telegram: 'ערוץ הטלגרם',
  whatsapp: 'ערוץ הוואטסאפ',
  instagram: 'אינסטגרם',
  facebook: 'פייסבוק',
  x: 'X',
  tiktok: 'טיקטוק',
  youtube: 'יוטיוב',
};

/** About, privacy, terms and the newsroom's channels, as set in the CMS. */
function InfoFooter() {
  const site = useQuery({ queryKey: ['site'], queryFn: api.site, staleTime: 10 * 60_000 });
  if (!site.data) return null;
  const social = Object.entries(SOCIAL_LABELS).filter(([k]) => site.data.links[k]);
  return (
    <View style={styles.footer}>
      {social.length > 0 ? (
        <>
          <Text style={styles.footerTitle}>הערוצים שלנו</Text>
          <View style={styles.chips}>
            {social.map(([k, label]) => (
              <Pressable key={k} onPress={() => void Linking.openURL(site.data.links[k]!)} style={styles.chip} accessibilityRole="link">
                <Text style={styles.chipText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.footerTitle}>B4 NEW&apos;S</Text>
      {site.data.pages.map((p) => (
        <Pressable key={p.slug} onPress={() => void Linking.openURL(`${SITE_URL}/${p.slug}`)} style={styles.infoRow} accessibilityRole="link">
          <Text style={styles.infoText}>{p.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

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
        ListFooterComponent={<InfoFooter />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 16, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  name: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  footer: { marginTop: space.xl, gap: space.sm },
  footerTitle: { fontFamily: fonts.textHeavy, fontSize: 13, color: colors.muted, marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderRadius: 999, backgroundColor: colors.brandSoft, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontFamily: fonts.textBold, fontSize: 14, color: colors.brandDeep },
  infoRow: { paddingVertical: 10 },
  infoText: { fontFamily: fonts.textSemi, fontSize: 16, color: colors.ink2 },
});
