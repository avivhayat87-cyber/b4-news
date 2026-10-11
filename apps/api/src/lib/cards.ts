// Shared query + mapping for article cards (the shape every listing returns).
import type { ArticleCard } from '@b4/shared';
import { type Db, and, articles, authors, categories, eq, lte, mediaAssets, sql } from '@b4/db';

export const cardColumns = {
  id: articles.id,
  slug: articles.slug,
  title: articles.title,
  excerpt: articles.excerpt,
  publishedAt: articles.publishedAt,
  categorySlug: categories.slug,
  categoryName: categories.name,
  authorSlug: authors.slug,
  authorName: authors.displayName,
  authorTitle: authors.title,
  imageKey: mediaAssets.storageKey,
  imageVariants: mediaAssets.variants,
  imageWidth: mediaAssets.width,
  imageHeight: mediaAssets.height,
  imageAlt: mediaAssets.altText,
  imageCredit: mediaAssets.credit,
};

/** Published, already-live articles with category, author and hero image joined. */
export function cardsQuery(db: Db) {
  return db
    .select(cardColumns)
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(authors, eq(articles.authorId, authors.id))
    .leftJoin(mediaAssets, eq(articles.heroMediaId, mediaAssets.id))
    .$dynamic();
}

export const isLive = and(eq(articles.status, 'published'), lte(articles.publishedAt, sql`now()`));

type CardRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date;
  categorySlug: string;
  categoryName: string;
  authorSlug: string | null;
  authorName: string | null;
  authorTitle: string | null;
  imageKey: string | null;
  imageVariants: Record<string, string> | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageAlt: string | null;
  imageCredit: string | null;
};

export function mediaUrl(base: string, key: string): string {
  return base ? `${base}/${key}` : `/media/${key}`;
}

export function toCard(row: CardRow, mediaBase: string, variant = 'card'): ArticleCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt === row.title ? null : row.excerpt,
    publishedAt: row.publishedAt.toISOString(),
    category: { slug: row.categorySlug, name: row.categoryName },
    author: row.authorSlug && row.authorName ? { slug: row.authorSlug, name: row.authorName, title: row.authorTitle } : null,
    image:
      row.imageKey && row.imageWidth && row.imageHeight
        ? {
            url: mediaUrl(mediaBase, row.imageVariants?.[variant] ?? row.imageKey),
            width: row.imageWidth,
            height: row.imageHeight,
            alt: row.imageAlt ?? row.title,
            credit: row.imageCredit,
          }
        : null,
  };
}

/** Opaque keyset cursor: "<publishedAt ISO>|<id>" in base64url. */
export function encodeCursor(card: { publishedAt: string; id: number }): string {
  return Buffer.from(`${card.publishedAt}|${card.id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { publishedAt: Date; id: number } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const publishedAt = new Date(iso ?? '');
  const n = Number(id);
  if (Number.isNaN(publishedAt.getTime()) || !Number.isSafeInteger(n)) return null;
  return { publishedAt, id: n };
}

export function olderThan(cursor: { publishedAt: Date; id: number } | null) {
  return cursor
    ? sql`(${articles.publishedAt}, ${articles.id}) < (${cursor.publishedAt.toISOString()}::timestamptz, ${cursor.id})`
    : undefined;
}
