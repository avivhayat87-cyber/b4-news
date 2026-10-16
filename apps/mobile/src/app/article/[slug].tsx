import { INVESTMENT_NOTICE, needsInvestmentNotice, type ArticleFull } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ArticleAd } from '@/components/ad-card';
import { ArticleBody } from '@/components/article-body';
import { Comments } from '@/components/comments';
import { IconButton, TopBar } from '@/components/top-bar';
import { ArticleImage, ArticleRow, CenterMessage, Loading, Pill, SectionHeader } from '@/components/ui';
import { SITE_URL, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { getSavedArticle, toggleSaved, useSaved } from '@/lib/saved';
import { colors, fonts, space } from '@/lib/theme';

/** Articles already counted as read in this run of the app (the newsroom counts one read per visit). */
const counted = new Set<number>();

export default function ArticleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isSaved } = useSaved();
  // Online first; a saved copy keeps the article readable offline.
  const article = useQuery({
    queryKey: ['article', slug],
    queryFn: async () => {
      try {
        return await api.article(slug);
      } catch (err) {
        const saved = await getSavedArticle(slug);
        if (saved) return saved;
        throw err;
      }
    },
  });
  const related = useQuery({ queryKey: ['related', slug], queryFn: () => api.related(slug), enabled: article.isSuccess });

  const a = article.data;
  const saved = isSaved(slug);
  // Where the reader is in the article: the ad after it counts a view only once really seen.
  const [scroll, setScroll] = useState({ y: 0, height: 0 });

  const articleId = a?.id;
  useEffect(() => {
    if (!articleId || counted.has(articleId)) return;
    counted.add(articleId);
    void api.read(articleId);
  }, [articleId]);

  const actions = a ? (
    <>
      <IconButton label={saved ? 'הסרה מהשמורים' : 'שמירה לקריאה אחר כך'} onPress={() => void toggleSaved(a)}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" fill={saved ? colors.brand : 'none'} stroke={saved ? colors.brand : colors.ink} strokeWidth={2} strokeLinejoin="round" />
        </Svg>
      </IconButton>
      <IconButton label="שיתוף" onPress={() => share(a)}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6.5A1.5 1.5 0 0 0 6.5 20.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </IconButton>
    </>
  ) : null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.white }}>
      <TopBar actions={actions} />
      {article.isPending ? (
        <Loading />
      ) : !a ? (
        <CenterMessage title="לא הצלחנו לטעון את הכתבה" body="בדקו את החיבור ונסו שוב." action="לנסות שוב" onAction={() => article.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={250}
          onLayout={(e) => setScroll((v) => ({ ...v, height: e.nativeEvent.layout.height }))}
          onScroll={(e) => setScroll({ y: e.nativeEvent.contentOffset.y, height: e.nativeEvent.layoutMeasurement.height })}
        >
          <View style={styles.head}>
            <Pill label={a.category.name} />
            <Text style={styles.title} accessibilityRole="header">
              {a.title}
            </Text>
            {a.subtitle ? <Text style={styles.subtitle}>{a.subtitle}</Text> : null}
            <Text style={styles.meta}>
              {a.author ? `${a.author.name} · ` : ''}
              {formatDateTime(a.publishedAt)} · {a.readingMinutes} דק׳ קריאה
            </Text>
            {/* The original report, as on the site: one short line under the byline; a tap opens it. */}
            {a.source ? (
              <Text style={styles.meta} accessibilityRole="link" onPress={() => void Linking.openURL(a.source!.url)}>
                על בסיס דיווח ב-<Text style={styles.sourceName}>{a.source.name}</Text>
              </Text>
            ) : null}
          </View>

          <ArticleImage article={a} priority style={styles.hero} />
          {a.image?.credit ? <Text style={styles.credit}>{a.image.credit}</Text> : null}

          <View style={styles.body}>
            <ArticleBody html={a.bodyHtml} />
          </View>

          {a.disclosure ? (
            <Text style={styles.disclosure}>
              <Text style={{ fontFamily: fonts.textBold, color: colors.ink }}>גילוי נאות: </Text>
              {a.disclosure}
            </Text>
          ) : null}
          {needsInvestmentNotice(a.category.slug) ? <Text style={styles.notice}>{INVESTMENT_NOTICE}</Text> : null}

          {a.tags.length ? (
            <View style={styles.tags}>
              {a.tags.map((t) => (
                <Text key={t.slug} style={styles.tag} onPress={() => router.push({ pathname: '/search', params: { q: t.name } })}>
                  {t.name}
                </Text>
              ))}
            </View>
          ) : null}

          <ArticleAd category={a.category.slug} scroll={scroll} />

          <View style={{ marginTop: space.xl }}>
            <Comments articleId={a.id} articleSlug={a.slug} enabled={a.commentsEnabled} />
          </View>

          {related.data?.length ? (
            <View style={{ marginTop: space.xl, gap: space.sm }}>
              <SectionHeader title="עוד בנושא" />
              <View style={{ paddingHorizontal: space.lg }}>
                {related.data.slice(0, 5).map((r) => (
                  <ArticleRow key={r.id} article={r} onPress={() => router.push({ pathname: '/article/[slug]', params: { slug: r.slug } })} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function share(a: ArticleFull) {
  const url = `${SITE_URL}/a/${a.id}?utm_source=app&utm_medium=share`;
  void Share.share({ title: a.title, message: `${a.title}\n${url}`, url });
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink },
  subtitle: { fontFamily: fonts.text, fontSize: 18, lineHeight: 27, color: colors.ink2 },
  meta: { fontFamily: fonts.text, fontSize: 13, color: colors.muted },
  sourceName: { textDecorationLine: 'underline' },
  hero: { marginTop: space.lg, marginHorizontal: space.lg, aspectRatio: 16 / 9, borderRadius: 12 },
  credit: { fontFamily: fonts.text, fontSize: 12, color: colors.muted, paddingHorizontal: space.lg, paddingTop: 6 },
  body: { paddingHorizontal: space.lg, paddingTop: space.lg },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg },
  disclosure: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: colors.ink2, paddingHorizontal: space.lg, paddingTop: space.lg },
  notice: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 20,
    color: colors.ink2,
    backgroundColor: colors.stone,
    borderRadius: 12,
    padding: space.md,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    overflow: 'hidden',
  },
  tag: { fontFamily: fonts.textBold, fontSize: 14, color: colors.ink, backgroundColor: colors.stone, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, overflow: 'hidden' },
});
