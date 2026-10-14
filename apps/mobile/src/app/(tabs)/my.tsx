// "הפיד שלי": articles in the reader's topics with the conversation around them, an invitation
// to be first where nobody commented, and "בשבילך" that changes a little on every visit.
// Topics, the hour and how the personal issue arrives are set below the feed ("העיתון שלי").
import type { DigestPrefs, FeedMode } from '@b4/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignIn, useReader } from '@/components/comments';
import { ArticleRow, Loading } from '@/components/ui';
import { ApiFailure, api } from '@/lib/api';
import { colors, fonts, space } from '@/lib/theme';

const MODES: { id: FeedMode; label: string }[] = [
  { id: 'for-you', label: 'בשבילך' },
  { id: 'new', label: 'חדש' },
  { id: 'popular', label: 'פופולרי' },
];

export default function MyFeedScreen() {
  const qc = useQueryClient();
  const reader = useReader();
  const [mode, setMode] = useState<FeedMode>('for-you');
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const feed = useInfiniteQuery({
    queryKey: ['my-feed', mode, seed],
    queryFn: ({ pageParam }) => api.myFeed(mode, pageParam, seed),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(reader.data),
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  if (reader.isPending) return <Loading />;
  if (!reader.data) {
    return (
      <SafeAreaView edges={['top']} style={s.screen}>
        <Text style={s.heading} accessibilityRole="header">
          הפיד שלי
        </Text>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text style={s.note}>כתבות מהתחומים שבחרת, עם התגובות המובילות והשיחות סביבן.</Text>
          <SignIn title="התחברות לפיד שלי" onSignedIn={(r) => qc.setQueryData(['reader'], r)} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.article.id)}
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        contentContainerStyle={{ paddingBottom: space.xl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingBottom: space.md }}>
            <Text style={s.heading} accessibilityRole="header">
              הפיד שלי
            </Text>
            <View style={s.modes} accessibilityRole="tablist">
              {MODES.map((m) => (
                <Pressable key={m.id} onPress={() => setMode(m.id)} style={[s.mode, mode === m.id && s.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === m.id }}>
                  <Text style={[s.modeText, mode === m.id && { color: colors.white }]}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <ArticleRow article={item.article} />
            {item.topComment ? (
              <Pressable onPress={() => router.push(`/article/${item.article.slug}` as never)} style={s.top} accessibilityRole="link">
                <Text style={s.topAuthor}>
                  {item.topComment.author}
                  {item.topComment.picked ? '  · בחירת העורכים' : ''}
                  {item.topComment.likeCount ? `  · ♥ ${item.topComment.likeCount}` : ''}
                </Text>
                <Text style={s.topBody} numberOfLines={3}>
                  {item.topComment.body}
                </Text>
                <Text style={s.topMore}>
                  {item.commentCount === 1 ? 'תגובה אחת' : `${item.commentCount} תגובות`}{item.topComment.replies ? ` · ${item.topComment.replies === 1 ? 'תשובה אחת' : `${item.topComment.replies} תשובות`} בשיחה` : ''} · להצטרף לשיחה
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => router.push(`/article/${item.article.slug}` as never)} style={s.first} accessibilityRole="link">
                <Text style={s.firstText}>היו הראשונים להגיב!</Text>
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={feed.isPending ? <Loading /> : <Text style={[s.note, { padding: space.lg }]}>עוד אין כתבות חדשות בתחומים שלך. נסו &quot;חדש&quot;, או הוסיפו תחומים למטה.</Text>}
        ListFooterComponent={<MyPaper />}
      />
    </SafeAreaView>
  );
}

/** "העיתון שלי": topics (they also shape the feed), the hour, and how it arrives. */
function MyPaper() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ['digest'], queryFn: api.digest });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories, staleTime: 3600_000 });
  if (!prefs.data || !categories.data) return null;
  const p = prefs.data;
  const save = async (next: DigestPrefs) => {
    qc.setQueryData(['digest'], next);
    try {
      qc.setQueryData(['digest'], await api.saveDigest(next));
      void qc.invalidateQueries({ queryKey: ['my-feed'] });
    } catch (e) {
      Alert.alert('שגיאה', e instanceof ApiFailure ? e.message : 'השמירה נכשלה');
      void prefs.refetch();
    }
  };
  const toggle = (slug: string) => void save({ ...p, sections: p.sections.includes(slug) ? p.sections.filter((x) => x !== slug) : [...p.sections, slug] });
  return (
    <View style={s.paper}>
      <Text style={s.paperTitle}>העיתון שלי</Text>
      <Text style={s.note}>לחצו על התחומים לפי סדר החשיבות. הם קובעים גם את הפיד.</Text>
      <View style={s.chips}>
        {categories.data.map((c) => {
          const place = p.sections.indexOf(c.slug);
          return (
            <Pressable key={c.slug} onPress={() => toggle(c.slug)} style={[s.chip, place >= 0 && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: place >= 0 }}>
              <Text style={[s.chipText, place >= 0 && { color: colors.white }]}>
                {place >= 0 ? `${place + 1}. ` : ''}
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.note}>שעת המשלוח</Text>
      <View style={s.chips}>
        {[7, 13, 20].map((h) => (
          <Pressable key={h} onPress={() => void save({ ...p, hour: h })} style={[s.chip, p.hour === h && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: p.hour === h }}>
            <Text style={[s.chipText, p.hour === h && { color: colors.white }]}>{`${String(h).padStart(2, '0')}:00`}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => void save({ ...p, frequency: p.frequency === 'daily' ? 'weekly' : 'daily' })} style={s.chip} accessibilityRole="button">
          <Text style={s.chipText}>{p.frequency === 'daily' ? 'כל יום' : 'פעם בשבוע'}</Text>
        </Pressable>
      </View>
      <View style={s.switchRow}>
        <Text style={[s.note, { flex: 1 }]}>התראה בטלפון</Text>
        <Switch value={p.push} onValueChange={(v) => void save({ ...p, push: v })} accessibilityLabel="העיתון בהתראה בטלפון" />
      </View>
      <View style={s.switchRow}>
        <Text style={[s.note, { flex: 1 }]}>במייל</Text>
        <Switch value={p.email} onValueChange={(v) => void save({ ...p, email: v })} accessibilityLabel="העיתון במייל" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  heading: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, paddingHorizontal: space.lg, paddingTop: space.md },
  note: { fontFamily: fonts.text, fontSize: 14, color: colors.ink2 },
  modes: { flexDirection: 'row', alignSelf: 'flex-start', marginHorizontal: space.lg, backgroundColor: colors.stone, borderRadius: 999, padding: 3, gap: 2 },
  mode: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  modeOn: { backgroundColor: colors.ink },
  modeText: { fontFamily: fonts.textBold, fontSize: 14, color: colors.ink2 },
  card: { marginHorizontal: space.lg, marginBottom: space.md, borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: 'hidden' },
  top: { backgroundColor: colors.stone, padding: space.md, gap: 4 },
  topAuthor: { fontFamily: fonts.textBold, fontSize: 13, color: colors.ink },
  topBody: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: colors.ink },
  topMore: { fontFamily: fonts.textSemi, fontSize: 13, color: colors.ink2 },
  first: { backgroundColor: colors.brandSoft, padding: space.md },
  firstText: { fontFamily: fonts.textHeavy, fontSize: 15, color: colors.brandDeep },
  paper: { margin: space.lg, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  paperTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.textBold, fontSize: 14, color: colors.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
