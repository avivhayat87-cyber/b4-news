// Home: 7 main articles in a swipeable carousel, 14 trending in a strip, then an endless mixed feed
// with a calm ad every few stories (a few at most).
import { CATEGORIES, type ArticleCard, type HomeData } from '@b4/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FeedAd } from '@/components/ad-card';
import { Logo } from '@/components/brand';
import { ArticleImage, ArticleRow, Byline, CenterMessage, Loading, Pill, RankBadge, SectionHeader, openArticle } from '@/components/ui';
import { reachedCap } from '@/lib/ads';
import { api } from '@/lib/api';
import { colors, fonts, rtl, space } from '@/lib/theme';

/** At most this many ads in the feed, however far the reader scrolls: calm, never crowded. */
const MAX_FEED_ADS = 3;

type Row = { kind: 'article'; article: ArticleCard } | { kind: 'ad'; pos: number };

export default function HomeScreen() {
  const home = useQuery({ queryKey: ['home'], queryFn: api.home });
  const feed = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.feed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  // How many stories between ads, as the newsroom set it (the first place's answer carries it).
  const first = useQuery({ queryKey: ['ad', 'app_feed', 1], queryFn: () => api.ad('app_feed', { exclude: reachedCap() }), staleTime: Infinity });
  const every = first.data?.appFeedEvery ?? 8;

  // The feed skips what the carousel and the trending strip already show.
  const feedItems = useMemo(() => {
    const shown = new Set([...(home.data?.main ?? []), ...(home.data?.trending ?? [])].map((a) => a.id));
    return (feed.data?.pages.flatMap((p) => p.items) ?? []).filter((a) => !shown.has(a.id));
  }, [feed.data, home.data]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    feedItems.forEach((article, i) => {
      out.push({ kind: 'article', article });
      const pos = (i + 1) / every;
      if (Number.isInteger(pos) && pos <= MAX_FEED_ADS) out.push({ kind: 'ad', pos });
    });
    return out;
  }, [feedItems, every]);

  // A view is counted when half the ad was on screen for a second (the list measures it).
  const taken = useRef(new Set<string>()).current;
  const tokens = useRef(new Map<number, string>()).current;
  const sent = useRef(new Set<string>()).current;
  const onToken = useCallback((pos: number, token: string) => void tokens.set(pos, token), [tokens]);
  const viewability = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 1000 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
    for (const v of viewableItems) {
      const token = v.item?.kind === 'ad' ? tokens.get(v.item.pos) : undefined;
      if (token && !sent.has(token)) {
        sent.add(token);
        void api.adSeen(token);
      }
    }
  }).current;

  if (home.isPending) return <Loading />;
  if (home.isError)
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <CenterMessage title="אין חיבור" body="לא הצלחנו לטעון את החדשות. בדקו את החיבור ונסו שוב." action="לנסות שוב" onAction={() => home.refetch()} />
      </SafeAreaView>
    );

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'ad' ? `ad-${r.pos}` : String(r.article.id))}
        renderItem={({ item }) =>
          item.kind === 'ad' ? (
            <FeedAd pos={item.pos} taken={taken} onToken={onToken} />
          ) : (
            <View style={{ paddingHorizontal: space.lg }}>
              <ArticleRow article={item.article} />
            </View>
          )
        }
        viewabilityConfig={viewability}
        onViewableItemsChanged={onViewable}
        ListHeaderComponent={<HomeHeader home={home.data} />}
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ margin: space.xl }} /> : <View style={{ height: space.xl }} />}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={home.isRefetching}
            tintColor={colors.brand}
            colors={[colors.brand]}
            onRefresh={() => {
              void home.refetch();
              void feed.refetch();
            }}
          />
        }
      />
    </SafeAreaView>
  );
}

function HomeHeader({ home }: { home: HomeData }) {
  return (
    <View style={{ gap: 22, paddingBottom: space.sm }}>
      <View style={styles.appBar}>
        <Logo width={128} />
      </View>
      <CategoryChips />
      <MainCarousel articles={home.main} />
      <TrendingStrip articles={home.trending} />
      <SectionHeader title="עוד כתבות" />
    </View>
  );
}

function CategoryChips() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <View style={[styles.chip, { backgroundColor: colors.ink }]}>
        <Text style={[styles.chipText, { color: colors.white, fontFamily: fonts.textBold }]}>הכל</Text>
      </View>
      {CATEGORIES.map((c) => (
        <Pressable
          key={c.slug}
          onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: c.slug } })}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
          accessibilityRole="link"
        >
          <Text style={styles.chipText}>{c.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function MainCarousel({ articles }: { articles: ArticleCard[] }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width, 640) - space.lg * 2;
  const [index, setIndex] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / (cardWidth + space.md)));
  };

  return (
    <View style={{ gap: space.sm }} accessibilityLabel="כתבות ראשיות">
      <FlatList
        horizontal
        data={articles}
        keyExtractor={(a) => String(a.id)}
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + space.md}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        onMomentumScrollEnd={onScroll}
        renderItem={({ item, index: i }) => (
          <Pressable onPress={() => openArticle(item)} style={{ width: cardWidth }} accessibilityRole="link">
            <ArticleImage article={item} priority={i === 0} style={styles.carouselCard}>
              <View style={styles.carouselShade} />
              <View style={styles.carouselTop}>
                <Pill label={item.category.name} />
              </View>
              <View style={styles.carouselText}>
                <Text style={styles.carouselTitle} numberOfLines={4}>
                  {item.title}
                </Text>
                <Byline article={item} light />
              </View>
            </ArticleImage>
          </Pressable>
        )}
      />
      <View style={styles.dots} accessibilityLabel={`כתבה ${index + 1} מתוך ${articles.length}`}>
        {articles.map((a, i) => (
          <View key={a.id} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

function TrendingStrip({ articles }: { articles: ArticleCard[] }) {
  if (articles.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title="חדשות חמות" />
      <FlatList
        horizontal
        data={articles}
        keyExtractor={(a) => String(a.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => openArticle(item)} style={{ width: 210, gap: 6 }} accessibilityRole="link">
            <ArticleImage article={item} style={styles.trendingImage}>
              <View style={styles.trendingRank}>
                <RankBadge n={index + 1} />
              </View>
            </ArticleImage>
            <Text style={styles.trendingTitle} numberOfLines={3}>
              {item.title}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  appBar: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  chip: { height: 34, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.stone, justifyContent: 'center' },
  chipText: { fontFamily: fonts.textSemi, fontSize: 14, color: colors.ink },
  carouselCard: { height: 300, borderRadius: 14, justifyContent: 'flex-end' },
  carouselShade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(18,18,20,0.45)' },
  carouselTop: { position: 'absolute', top: 14, ...rtl.atStart(14) },
  carouselText: { padding: 18, gap: 8 },
  carouselTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.white },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D5D3CF' },
  dotActive: { width: 22, backgroundColor: colors.brand },
  trendingImage: { height: 118, borderRadius: 10 },
  trendingRank: { position: 'absolute', bottom: 8, ...rtl.atStart(8) },
  trendingTitle: { fontFamily: fonts.displayBold, fontSize: 14, lineHeight: 20, color: colors.ink },
});
