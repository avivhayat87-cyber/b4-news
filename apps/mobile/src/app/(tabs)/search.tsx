import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArticleRow, CenterMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, fonts, space } from '@/lib/theme';

export default function SearchScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState(q ?? '');
  const [query, setQuery] = useState(q ?? '');
  useEffect(() => {
    if (q) {
      setText(q);
      setQuery(q);
    }
  }, [q]);
  const results = useInfiniteQuery({
    queryKey: ['search', query],
    queryFn: ({ pageParam }) => api.search(query, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: query.length > 0,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.white }}>
      <Text style={styles.heading} accessibilityRole="header">
        חיפוש
      </Text>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => setQuery(text.trim())}
          returnKeyType="search"
          placeholder="חיפוש כתבות, נושאים ואנשים"
          placeholderTextColor={colors.muted}
          style={styles.input}
          accessibilityLabel="מה לחפש"
          autoCorrect={false}
        />
      </View>
      {!query ? (
        <CenterMessage title="מה מעניין אותך?" body="הקלידו מילה וחפשו בכל הכתבות של B4." />
      ) : results.isPending ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : results.isError ? (
        <CenterMessage title="החיפוש נכשל" body="בדקו את החיבור ונסו שוב." action="לנסות שוב" onAction={() => results.refetch()} />
      ) : items.length === 0 ? (
        <CenterMessage title={`לא נמצאו כתבות עבור ״${query}״`} body="נסו מילה אחרת או קצרה יותר." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
          renderItem={({ item }) => <ArticleRow article={item} />}
          onEndReached={() => {
            if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
          }}
          keyboardDismissMode="on-drag"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, paddingHorizontal: space.lg, paddingVertical: space.md },
  input: { height: 48, borderRadius: 999, borderWidth: 1.5, borderColor: colors.ink, paddingHorizontal: 18, fontFamily: fonts.text, fontSize: 16, color: colors.ink },
});
