import type { MetadataRoute } from 'next';
import { listRecentForSitemap } from '@/lib/api';
import { MARKET_TABS, marketsHref } from '@/lib/markets';
import { CATEGORIES, SITE, articleHref, categoryHref } from '@/lib/site';

export const revalidate = 900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const abs = (path: string) => new URL(path, SITE.url).toString();
  const articles = await listRecentForSitemap();
  return [
    { url: abs('/'), changeFrequency: 'always', priority: 1 },
    ...CATEGORIES.map((c) => ({ url: abs(categoryHref(c.slug)), changeFrequency: 'hourly' as const, priority: 0.7 })),
    ...MARKET_TABS.map((t) => ({ url: abs(marketsHref(t.slug)), changeFrequency: 'daily' as const, priority: 0.5 })),
    ...articles.map((a) => ({ url: abs(articleHref(a)), lastModified: a.publishedAt, priority: 0.6 })),
  ];
}
