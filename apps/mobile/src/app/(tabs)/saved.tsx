// Saved articles live on the device, so they open without a connection.
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArticleRow, CenterMessage } from '@/components/ui';
import { useSaved } from '@/lib/saved';
import { colors, fonts, space } from '@/lib/theme';

export default function SavedScreen() {
  const { entries } = useSaved();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.white }}>
      <Text style={styles.heading} accessibilityRole="header">
        שמורים
      </Text>
      {entries.length === 0 ? (
        <CenterMessage title="עוד לא שמרת כתבות" body="לחצו על סימן השמירה בכתבה כדי לקרוא אותה אחר כך, גם בלי אינטרנט." />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.article.slug}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
          ListHeaderComponent={<Text style={styles.note}>{entries.length} כתבות זמינות לקריאה גם בלי חיבור</Text>}
          renderItem={({ item }) => (
            <View>
              <ArticleRow article={item.article} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, paddingHorizontal: space.lg, paddingVertical: space.md },
  note: { fontFamily: fonts.text, fontSize: 13, color: colors.muted, paddingBottom: space.sm },
});
