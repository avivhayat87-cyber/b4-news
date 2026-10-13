// Public content shapes returned by /api/v1/public/* (camelCase JSON).
import { z } from 'zod';

export const CategoryRef = z.object({
  slug: z.string(),
  name: z.string(),
});
export type CategoryRef = z.infer<typeof CategoryRef>;

export const ImageRef = z.object({
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  alt: z.string(),
  credit: z.string().nullable().optional(),
});
export type ImageRef = z.infer<typeof ImageRef>;

export const AuthorRef = z.object({
  slug: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});
export type AuthorRef = z.infer<typeof AuthorRef>;

export const ArticleCard = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable().optional(),
  category: CategoryRef,
  publishedAt: z.string(),
  author: AuthorRef.nullable().optional(),
  image: ImageRef.nullable().optional(),
  commentCount: z.number().int().optional(),
});
export type ArticleCard = z.infer<typeof ArticleCard>;

export const TagRef = z.object({ slug: z.string(), name: z.string() });
export type TagRef = z.infer<typeof TagRef>;

export const ArticleFull = ArticleCard.extend({
  subtitle: z.string(),
  bodyHtml: z.string(),
  tags: z.array(TagRef),
  editor: z.object({ name: z.string() }).nullable().optional(),
  updatedAt: z.string(),
  readingMinutes: z.number().int(),
  source: z.object({ name: z.string(), url: z.string() }).nullable().optional(),
  commentsEnabled: z.boolean(),
  /** The writer's disclosure of interests ("גילוי נאות"), when there is one. */
  disclosure: z.string().nullable().optional(),
});
export type ArticleFull = z.infer<typeof ArticleFull>;

export const HomeSection = z.object({
  category: CategoryRef,
  items: z.array(ArticleCard),
});
export type HomeSection = z.infer<typeof HomeSection>;

export const Podcast = z.object({
  id: z.string(),
  show: z.string(),
  title: z.string(),
  meta: z.string(),
  href: z.string(),
});
export type Podcast = z.infer<typeof Podcast>;

export const HomeData = z.object({
  main: z.array(ArticleCard),
  trending: z.array(ArticleCard),
  latest: z.array(ArticleCard),
  sections: z.array(HomeSection),
  podcasts: z.array(Podcast),
});
export type HomeData = z.infer<typeof HomeData>;

export const MarketQuote = z.object({
  symbol: z.string(),
  name: z.string(),
  value: z.string(),
  change: z.string(),
  direction: z.enum(['up', 'down', 'flat']),
});
export type MarketQuote = z.infer<typeof MarketQuote>;

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

export const CategoryPage = z.object({
  category: CategoryRef,
  page: pageOf(ArticleCard),
});
export type CategoryPage = z.infer<typeof CategoryPage>;
