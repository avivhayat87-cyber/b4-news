import type { ArticleCard } from '@b4/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatPublished } from '@/lib/format';
import { colors, fonts, space, tone } from '@/lib/theme';
import { SealDot } from './brand';

export const openArticle = (a: { slug: string }) => router.push({ pathname: '/article/[slug]', params: { slug: a.slug } });

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <SealDot size={20} />
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={{ flex: 1 }} />
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Pill({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: dark ? colors.ink : colors.brand }]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function RankBadge({ n, size = 32 }: { n: number; size?: number }) {
  return (
    <View style={[styles.rank, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.rankText, { fontSize: size / 2 }]}>{n}</Text>
    </View>
  );
}

/** Article image with a toned placeholder (also shown while loading or offline). */
export function ArticleImage({
  article,
  style,
  children,
  priority,
}: {
  article: Pick<ArticleCard, 'id' | 'image'>;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  priority?: boolean;
}) {
  return (
    <View style={[{ backgroundColor: tone(article.id), overflow: 'hidden' }, style]}>
      {article.image ? (
        <Image
          source={{ uri: article.image.url }}
          alt={article.image.alt}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          priority={priority ? 'high' : 'normal'}
        />
      ) : null}
      {children}
    </View>
  );
}

export function Byline({ article, light = false }: { article: ArticleCard; light?: boolean }) {
  return (
    <Text style={[styles.byline, light && { color: '#C9C9D0' }]}>
      {article.author ? `מאת ${article.author.name} · ` : ''}
      {formatPublished(article.publishedAt)}
    </Text>
  );
}

/** Thumbnail row used by feeds, categories, search and saved. */
export function ArticleRow({ article, onPress }: { article: ArticleCard; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress ?? (() => openArticle(article))} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} accessibilityRole="link">
      <ArticleImage article={article} style={styles.rowImage} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowCategory}>{article.category.name}</Text>
        <Text style={styles.rowTitle} numberOfLines={3}>
          {article.title}
        </Text>
        <Byline article={article} />
      </View>
    </Pressable>
  );
}

export function CenterMessage({ title, body, action, onAction }: { title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.centerTitle}>{title}</Text>
      {body ? <Text style={styles.centerBody}>{body}</Text> : null}
      {action && onAction ? (
        <Pressable onPress={onAction} style={styles.primaryButton} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

export const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  sectionTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink },
  sectionAction: { fontFamily: fonts.textHeavy, fontSize: 13, color: colors.brand },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  pillText: { fontFamily: fonts.textHeavy, fontSize: 12, color: colors.white },
  rank: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white },
  rankText: { fontFamily: fonts.display, color: colors.white },
  byline: { fontFamily: fonts.text, fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowImage: { width: 104, height: 72, borderRadius: 8 },
  rowCategory: { fontFamily: fonts.textHeavy, fontSize: 12, color: colors.brand },
  rowTitle: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: 21, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  centerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, textAlign: 'center' },
  centerBody: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: colors.ink2, textAlign: 'center' },
  primaryButton: { backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 22, height: 46, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontFamily: fonts.textHeavy, fontSize: 15, color: colors.white },
});
