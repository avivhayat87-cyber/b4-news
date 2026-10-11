// Server-side client for the public API. Every fetch carries cache tags that
// match what the backend sends to /api/revalidate after a publish or correction:
//   home · category:<slug> · article:<id> · article-slug:<slug> · markets
import 'server-only';
import type { ArticleCard, ArticleFull, CategoryPage, HomeData, MarketQuote, Page } from './types';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');

type FetchOpts = { tags: string[]; revalidate?: number | false };

async function getJson<T>(path: string, { tags, revalidate = 300 }: FetchOpts): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: { accept: 'application/json' }, next: { tags, revalidate } });
  } catch (cause) {
    throw new Error(`The API is not reachable at ${API_URL}. Start it with "npm run dev" in the repo root.`, { cause });
  }
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

export function getHome(): Promise<HomeData> {
  return getRequired<HomeData>('/public/home', { tags: ['home'] });
}

export async function getMarkets(): Promise<MarketQuote[]> {
  try {
    return await getRequired<MarketQuote[]>('/public/markets', { tags: ['markets'], revalidate: 60 });
  } catch {
    // A market-data outage must never take the page down.
    return [];
  }
}

export function getArticle(slug: string): Promise<ArticleFull | null> {
  return getJson<ArticleFull>(`/public/articles/${enc(slug)}`, { tags: [`article-slug:${slug}`] });
}

export async function getRelated(article: ArticleFull): Promise<ArticleCard[]> {
  return (
    (await getJson<ArticleCard[]>(`/public/articles/${enc(article.slug)}/related`, {
      tags: [`article:${article.id}`, `category:${article.category.slug}`],
    })) ?? []
  );
}

export function getCategoryPage(slug: string, cursor?: string): Promise<CategoryPage | null> {
  const query = cursor ? `?cursor=${enc(cursor)}` : '';
  return getJson<CategoryPage>(`/public/categories/${enc(slug)}${query}`, { tags: [`category:${slug}`] });
}

export async function searchArticles(q: string, cursor?: string): Promise<Page<ArticleCard>> {
  const query = `?q=${enc(q)}${cursor ? `&cursor=${enc(cursor)}` : ''}`;
  return (await getJson<Page<ArticleCard>>(`/public/search${query}`, { tags: ['search'], revalidate: 60 })) ?? { items: [], nextCursor: null };
}

/** Resolves the short deep-link path /a/<id> (used in social posts and push) to a slug. */
export async function resolveArticleId(id: string): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  const found = await getJson<{ slug: string }>(`/public/a/${id}`, { tags: [`article:${id}`] });
  return found?.slug ?? null;
}

export async function listRecentForSitemap(): Promise<ArticleCard[]> {
  return (await getJson<Page<ArticleCard>>('/public/feed?limit=500', { tags: ['home'], revalidate: 900 }))?.items ?? [];
}
