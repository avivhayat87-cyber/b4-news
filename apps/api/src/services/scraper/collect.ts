// Reading one source: list its new items, then (if configured) open each article page.
import { createHash } from 'node:crypto';
import type { ScrapeMethod, SelectorConfig } from '@b4/shared';
import { decodeText, type FetchResult } from '../../lib/safe-fetch';
import { type FoundItem, extractArticle, parseFeed, parseHtmlList, parseSitemap } from './parse';
import type { RobotsCache } from './robots';

export type Fetcher = (url: string, opts?: { accept?: string; allowTypes?: string[]; maxBytes?: number }) => Promise<FetchResult>;

export type SourceSpec = { name: string; method: ScrapeMethod; listUrls: string[]; config: SelectorConfig };

export type CollectedItem = FoundItem & { canonicalUrl: string; urlHash: string; raw: Record<string, unknown> };

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|cmpid$|ocid$)/i;

/** Same story, same key: lower-case host, no fragment, no tracking parameters, sorted query, no trailing slash. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Fingerprint of the text, to catch the same story published under a second address. */
export function contentHash(body: string | null): string | null {
  const normalized = (body ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length >= 300 ? sha256(normalized.slice(0, 3000)) : null;
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

const looksLikeSitemap = (u: string) => /\.xml(\.gz)?(\?|$)|sitemap/i.test(u);
const NOT_ARTICLE_SITEMAPS = /tag|categor|author|writer|topic|show|contentpage|static|image|video/i;

export async function listPage(fetch: Fetcher, source: SourceSpec, url: string, depth = 0): Promise<FoundItem[]> {
  const res = await fetch(url, { accept: source.method === 'html' ? undefined : FEED_ACCEPT });
  const body = decodeText(res);
  if (source.method === 'rss') return parseFeed(body, res.url);
  if (source.method === 'html') return parseHtmlList(body, res.url, source.config.list);
  const isIndex = /<sitemapindex/i.test(body);
  const items = isIndex ? [] : parseSitemap(body, res.url);
  // A sitemap index (or a sitemap that mostly lists other sitemaps): follow the newest few children.
  if (depth < 2 && (isIndex || (items.length > 0 && items.filter((i) => looksLikeSitemap(i.url)).length > items.length / 2))) {
    const children = isIndex
      ? [...body.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)].map((m) => ({
          url: /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(m[1]!)?.[1] ?? '',
          at: Date.parse(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(m[1]!)?.[1] ?? '') || 0,
        }))
      : items.filter((i) => looksLikeSitemap(i.url)).map((i) => ({ url: i.url, at: i.publishedAt?.getTime() ?? 0 }));
    // Tag, category and author sitemaps change often but list pages, not articles: followed only if there is nothing else.
    const all = children.filter((c) => c.url);
    const articleLike = all.filter((c) => !NOT_ARTICLE_SITEMAPS.test(c.url));
    const newest = (articleLike.length ? articleLike : all).sort((a, b) => b.at - a.at).slice(0, 3);
    const nested = await Promise.all(newest.map((c) => listPage(fetch, source, c.url, depth + 1).catch(() => [])));
    return nested.flat();
  }
  return items;
}

/** Items listed by the source, newest first, after the delta cut-off. */
export async function listItems(fetch: Fetcher, source: SourceSpec, since: Date | null): Promise<FoundItem[]> {
  const seen = new Set<string>();
  const all: FoundItem[] = [];
  for (const url of source.listUrls) {
    for (const item of await listPage(fetch, source, url)) {
      const key = canonicalUrl(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
  }
  // The filter may have several parts separated by spaces ("/economy/ /article-"); an address must contain all of them,
  // in any letter case (sites mix "Article-" and "article-").
  const filter = source.config.list.urlFilter?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return all
    .filter((i) => filter.every((part) => i.url.toLowerCase().includes(part)))
    .filter((i) => !since || !i.publishedAt || i.publishedAt > since)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, source.config.list.maxItems);
}

/**
 * Opens the article page when the source is configured for it (or when the listing gave too little).
 * Pages robots.txt disallows are not opened, and a page that can't be read (paywall, bot
 * protection) falls back to what the feed gave, as long as there is a headline.
 */
export async function completeItem(fetch: Fetcher, source: SourceSpec, item: FoundItem, robots?: RobotsCache): Promise<CollectedItem> {
  const canonical = canonicalUrl(item.url);
  const needsPage = Boolean(source.config.article) || !item.title || (!item.bodyText && !item.intro);
  let merged: FoundItem = item;
  let raw: Record<string, unknown> = { listed: item };
  if (needsPage) {
    try {
      if (robots && !(await robots.allowed(item.url))) throw new Error('robots.txt disallows this page');
      const res = await fetch(item.url, { allowTypes: ['text/html', 'application/xhtml'] });
      const page = extractArticle(decodeText(res), res.url, source.config.article);
      merged = {
        url: item.url,
        title: item.title || page.title,
        intro: page.intro ?? item.intro,
        imageUrl: item.imageUrl ?? page.imageUrl,
        publishedAt: item.publishedAt ?? page.publishedAt,
        bodyText: page.bodyText || item.bodyText,
      };
      raw = { listed: item, page };
    } catch (e) {
      if (!item.title) throw e;
      raw = { listed: item, pageError: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ...merged, bodyText: merged.bodyText ?? merged.intro, canonicalUrl: canonical, urlHash: sha256(canonical), raw };
}

export function categoryFor(url: string, config: SelectorConfig): string | null {
  return config.categoryRules.find((r) => url.includes(r.urlContains))?.category ?? null;
}
