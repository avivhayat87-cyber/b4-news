import { findCategory } from '@b4/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopBar } from '@/components/top-bar';
import { ArticleRow, CenterMessage, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, space } from '@/lib/theme';

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const page = useInfiniteQuery({
    queryKey: ['category', slug],
    queryFn: ({ pageParam }) => api.category(slug, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.nextCursor,
  });
  const name = page.data?.pages[0]?.category.name ?? findCategory(slug)?.name ?? '';
  const items = page.data?.pages.flatMap((p) => p.page.items) ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.white }}>
      <TopBar title={name} />
      {page.isPending ? (
        <Loading />
      ) : page.isError ? (
        <CenterMessage title="לא הצלחנו לטעון" body="בדקו את החיבור ונסו שוב." action="לנסות שוב" onAction={() => page.refetch()} />
      ) : items.length === 0 ? (
        <CenterMessage title="עדיין אין כתבות במדור הזה" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
          renderItem={({ item }) => <ArticleRow article={item} />}
          onEndReached={() => {
            if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
          }}
          ListFooterComponent={page.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ margin: space.xl }} /> : null}
        />
      )}
    </SafeAreaView>
  );
}
