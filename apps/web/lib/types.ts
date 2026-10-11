// Shapes returned by the public API (/api/v1/public/*), camelCase.

export type Tone = 'graphite' | 'steel' | 'bronze' | 'teal' | 'plum' | 'sand' | 'wine';

export type CategoryRef = {
  slug: string;
  name: string;
};

export type ImageRef = {
  url: string;
  width: number;
  height: number;
  alt: string;
  credit?: string | null;
};

export type AuthorRef = {
  slug: string;
  name: string;
  title?: string | null;
  avatarUrl?: string | null;
};

export type ArticleCard = {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  category: CategoryRef;
  publishedAt: string;
  author?: AuthorRef | null;
  image?: ImageRef | null;
  /** Placeholder color when there is no image (sample data only). */
  tone?: Tone;
};

export type TagRef = {
  slug: string;
  name: string;
};

export type ArticleFull = ArticleCard & {
  subtitle: string;
  bodyHtml: string;
  tags: TagRef[];
  editor?: { name: string } | null;
  updatedAt: string;
  readingMinutes: number;
  source?: { name: string; url: string } | null;
};

export type HomeSection = {
  category: CategoryRef;
  items: ArticleCard[];
};

export type Podcast = {
  id: string;
  show: string;
  title: string;
  meta: string;
  href: string;
  tone?: Tone;
};

export type HomeData = {
  /** Exactly 7 when the newsroom has filled every main slot. */
  main: ArticleCard[];
  /** Up to 14. */
  trending: ArticleCard[];
  /** Newest articles, for the breaking-news ticker. */
  latest: ArticleCard[];
  sections: HomeSection[];
  podcasts: Podcast[];
};

export type MarketQuote = {
  symbol: string;
  name: string;
  value: string;
  change: string;
  direction: 'up' | 'down' | 'flat';
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};
