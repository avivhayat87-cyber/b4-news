// Server-side client for the public API. Every fetch carries cache tags that
// match what the backend sends to /api/revalidate after a publish or correction:
//   home · category:<slug> · article:<id> · article-slug:<slug> · markets
// With API_URL unset, everything comes from lib/mock.ts.

import type { ArticleCard, ArticleFull, CategoryRef, HomeData, MarketQuote, Page } from './types';
import { categoryBySlug } from './site';
import { mockArticle, mockArticles, mockHome, mockMarkets, mockRelated } from './mock';

const API_URL = process.env.API_URL?.replace(/\/+$/, '');
const useMock = !API_URL;

type FetchOpts = { tags: string[]; revalidate?: number | false };

async function getJson<T>(path: string, { tags, revalidate = 300 }: FetchOpts): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { accept: 'application/json' },
    next: { tags, revalidate },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

async function getRequired<T>(path: string, opts: FetchOpts): Promise<T> {
  const data = await getJson<T>(path, opts);
  if (data === null) throw new Error(`GET ${path} returned 404`);
  return data;
}

const enc = encodeURIComponent;

export async function getHome(): Promise<HomeData> {
  if (useMock) return mockHome;
  return getRequired<HomeData>('/public/home', { tags: ['home'] });
}

export async function getLatest(): Promise<ArticleCard[]> {
  return (await getHome()).latest;
}

export async function getMarkets(): Promise<MarketQuote[]> {
  if (useMock) return mockMarkets;
  try {
    return await getRequired<MarketQuote[]>('/public/markets', { tags: ['markets'], revalidate: 60 });
  } catch {
    // A market-data outage must never take the page down.
    return [];
  }
}

export async function getArticle(slug: string): Promise<ArticleFull | null> {
  if (useMock) return mockArticle(slug);
  return getJson<ArticleFull>(`/public/articles/${enc(slug)}`, { tags: [`article-slug:${slug}`] });
}

export async function getRelated(article: ArticleFull): Promise<ArticleCard[]> {
  if (useMock) return mockRelated(article.slug);
  return (
    (await getJson<ArticleCard[]>(`/public/articles/${enc(article.slug)}/related`, {
      tags: [`article:${article.id}`, `category:${article.category.slug}`],
    })) ?? []
  );
}

export async function getCategoryPage(
  slug: string,
  cursor?: string,
): Promise<{ category: CategoryRef; page: Page<ArticleCard> } | null> {
  if (useMock) {
    const category = categoryBySlug(slug);
    if (!category) return null;
    const items = mockArticles.filter((a) => a.category.slug === slug);
    return { category, page: { items, nextCursor: null } };
  }
  const query = cursor ? `?cursor=${enc(cursor)}` : '';
  return getJson(`/public/categories/${enc(slug)}${query}`, { tags: [`category:${slug}`] });
}

export async function searchArticles(q: string, cursor?: string): Promise<Page<ArticleCard>> {
  if (useMock) {
    const needle = q.trim();
    const items = needle ? mockArticles.filter((a) => a.title.includes(needle) || (a.excerpt ?? '').includes(needle)) : [];
    return { items, nextCursor: null };
  }
  const query = `?q=${enc(q)}${cursor ? `&cursor=${enc(cursor)}` : ''}`;
  return (await getJson<Page<ArticleCard>>(`/public/search${query}`, { tags: ['search'], revalidate: 60 })) ?? { items: [], nextCursor: null };
}

/** Resolves the short deep-link path /a/<id> (used in social posts and push) to a slug. */
export async function resolveArticleId(id: string): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  if (useMock) return mockArticles.find((a) => String(a.id) === id)?.slug ?? null;
  const found = await getJson<{ slug: string }>(`/public/a/${id}`, { tags: [`article:${id}`] });
  return found?.slug ?? null;
}

export async function listRecentForSitemap(): Promise<ArticleCard[]> {
  if (useMock) return mockArticles;
  return (await getJson<ArticleCard[]>('/public/feed?limit=500', { tags: ['home'], revalidate: 900 })) ?? [];
}

export const isMockMode = useMock;
