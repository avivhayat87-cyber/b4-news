// Turning source pages into items: RSS/Atom feeds, sitemaps, HTML listing
// pages, and article pages (with the developer's selectors, or best-effort
// detection when there are none, e.g. "add by link").
import type { SelectorConfig } from '@b4/shared';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

export type FoundItem = {
  url: string;
  title: string;
  intro: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  /** Some feeds carry the full text; then the article page needn't be fetched. */
  bodyText: string | null;
};

export type ExtractedArticle = { title: string; intro: string | null; bodyText: string; imageUrl: string | null; publishedAt: Date | null };

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', processEntities: true, htmlEntities: true });

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function textOf(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text'] ?? '');
  return '';
}

export function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Text content of an HTML fragment (feed descriptions often contain markup). */
export function htmlToText(fragment: string): string {
  if (!fragment.includes('<')) return cleanText(fragment);
  return cleanText(cheerio.load(`<div>${fragment}</div>`)('div').first().text());
}

export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
}

export function absolute(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** RSS 2.0 and Atom. */
export function parseFeed(body: string, base: string): FoundItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  const rssItems = asArray(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
  if (rssItems.length) {
    return rssItems.flatMap((it: Record<string, any>) => {
      const url = absolute(textOf(it.link) || textOf(it.guid), base);
      const title = htmlToText(textOf(it.title));
      if (!url || !title) return [];
      const media = asArray(it['media:content']).concat(asArray(it['media:thumbnail']))[0] as Record<string, string> | undefined;
      const enclosure = asArray(it.enclosure).find((e: Record<string, string>) => (e['@type'] ?? '').startsWith('image')) as Record<string, string> | undefined;
      const descriptionHtml = textOf(it.description);
      const imgInDescription = /<img[^>]+src=["']([^"']+)/i.exec(descriptionHtml)?.[1];
      const full = textOf(it['content:encoded']);
      return [
        {
          url,
          title,
          intro: htmlToText(descriptionHtml) || null,
          imageUrl: absolute(enclosure?.['@url'] ?? media?.['@url'] ?? imgInDescription, base),
          publishedAt: parseDate(textOf(it.pubDate) || textOf(it['dc:date'])),
          bodyText: full ? htmlBlocksToText(full) : null,
        },
      ];
    });
  }
  return asArray(doc.feed?.entry).flatMap((e: Record<string, any>) => {
    const links = asArray(e.link) as Record<string, string>[];
    const href = (links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0])?.['@href'];
    const url = absolute(href, base);
    const title = htmlToText(textOf(e.title));
    if (!url || !title) return [];
    const content = textOf(e.content);
    return [
      {
        url,
        title,
        intro: htmlToText(textOf(e.summary)) || null,
        imageUrl: absolute((asArray(e['media:thumbnail'])[0] as Record<string, string> | undefined)?.['@url'], base),
        publishedAt: parseDate(textOf(e.published) || textOf(e.updated)),
        bodyText: content ? htmlBlocksToText(content) : null,
      },
    ];
  });
}

/** Sitemaps, including Google News and image extensions. Sitemap indexes return their child sitemaps as items with no title. */
export function parseSitemap(body: string, base: string): FoundItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  return asArray(doc.urlset?.url).flatMap((u: Record<string, any>) => {
    const url = absolute(textOf(u.loc), base);
    if (!url) return [];
    const news = u['news:news'] as Record<string, any> | undefined;
    const image = asArray(u['image:image'])[0] as Record<string, any> | undefined;
    return [
      {
        url,
        title: htmlToText(textOf(news?.['news:title'])),
        intro: null,
        imageUrl: absolute(textOf(image?.['image:loc']), base),
        publishedAt: parseDate(textOf(news?.['news:publication_date']) || textOf(u.lastmod)),
        bodyText: null,
      },
    ];
  });
}

/** Listing pages, with the developer's selectors. */
export function parseHtmlList(html: string, pageUrl: string, cfg: SelectorConfig['list']): FoundItem[] {
  const $ = cheerio.load(html);
  if (!cfg.item) return [];
  const items: FoundItem[] = [];
  $(cfg.item).each((_, el) => {
    const node = $(el);
    const linkEl = cfg.link ? node.find(cfg.link).first() : node.is('a') ? node : node.find('a').first();
    const url = absolute(linkEl.attr('href'), pageUrl);
    const title = cleanText(cfg.title ? node.find(cfg.title).first().text() : linkEl.text());
    if (!url || !title) return;
    const dateEl = cfg.publishedAt ? node.find(cfg.publishedAt).first() : node.find('time').first();
    const img = node.find('img').first();
    items.push({
      url,
      title,
      intro: null,
      imageUrl: absolute(img.attr('data-src') ?? img.attr('src'), pageUrl),
      publishedAt: parseDate(dateEl.attr('datetime') ?? dateEl.attr('content') ?? dateEl.text()),
      bodyText: null,
    });
  });
  return items;
}

const NOISE = 'script, style, noscript, iframe, nav, aside, footer, header, figure figcaption, .ad, .ads, [class*="advert"], [class*="share"], [class*="related"], [class*="newsletter"]';

/** Search boxes and sign-up forms go; a form that wraps the whole page (ASP.NET sites such as Globes) stays. */
function removeSmallForms($: cheerio.CheerioAPI) {
  $('form')
    .filter((_, f) => cleanText($(f).find('p').text()).length < 400)
    .remove();
}

/** Paragraph and sub-heading text of an element, as blocks separated by blank lines ("## " marks sub-headings). */
function blocksOf($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): string {
  const blocks: string[] = [];
  root.find('p, h2, h3, li, blockquote').each((_, el) => {
    const node = $(el);
    if (node.parents('li, blockquote').length && !node.is('li, blockquote')) return;
    const text = cleanText(node.text());
    if (text.length < 2) return;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    blocks.push(tag === 'h2' || tag === 'h3' ? `## ${text}` : tag === 'blockquote' ? `> ${text}` : tag === 'li' ? `- ${text}` : text);
  });
  return blocks.join('\n\n');
}

function htmlBlocksToText(fragment: string): string {
  const $ = cheerio.load(`<div id="__root">${fragment}</div>`);
  return blocksOf($, $('#__root')) || htmlToText(fragment);
}

function meta($: cheerio.CheerioAPI, ...names: string[]): string | null {
  for (const n of names) {
    const v = $(`meta[property="${n}"], meta[name="${n}"]`).attr('content');
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/** The container with the most paragraph text: good enough for most news article templates. */
function largestTextBlock($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  const article = $('article').first();
  if (article.length && cleanText(article.find('p').text()).length > 400) return article;
  let best = $('body');
  let bestLen = 0;
  $('div, section, main').each((_, el) => {
    const node = $(el);
    const len = node.children('p').text().length;
    if (len > bestLen) {
      bestLen = len;
      best = node;
    }
  });
  return best;
}

type LdArticle = { headline?: string; description?: string; articleBody?: string; image?: unknown; datePublished?: string };

/** schema.org NewsArticle data, which most news sites embed for search engines. */
function jsonLdArticle($: cheerio.CheerioAPI): LdArticle | null {
  const found: LdArticle[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, unknown>;
    const type = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    if (type.some((t) => /Article$/i.test(t))) found.push(o as LdArticle);
    if (o['@graph']) visit(o['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  });
  return found.sort((a, b) => (b.articleBody?.length ?? 0) - (a.articleBody?.length ?? 0))[0] ?? null;
}

function ldImage(image: unknown): string | undefined {
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return ldImage(image[0]);
  if (image && typeof image === 'object' && 'url' in image) return String((image as { url: unknown }).url);
  return undefined;
}

export function extractArticle(html: string, pageUrl: string, cfg?: SelectorConfig['article']): ExtractedArticle {
  const $ = cheerio.load(html);
  const ld = jsonLdArticle($);
  for (const sel of cfg?.remove ?? []) $(sel).remove();
  $(NOISE).remove();
  removeSmallForms($);

  const title =
    cleanText(cfg?.title ? $(cfg.title).first().text() : null) || meta($, 'og:title', 'twitter:title') || cleanText(ld?.headline) || cleanText($('h1').first().text()) || cleanText($('title').text());
  const intro = cleanText(cfg?.intro ? $(cfg.intro).first().text() : null) || meta($, 'og:description', 'description', 'twitter:description') || cleanText(ld?.description);
  const bodyRoot = cfg?.body ? $(cfg.body).first() : largestTextBlock($);
  let bodyText = bodyRoot.length ? blocksOf($, bodyRoot) : '';
  // Without a body selector, the structured data often has the cleanest full text.
  const ldBody = ld?.articleBody
    ? htmlBlocksToText(
        ld.articleBody
          .split(/\r?\n+/)
          .map((p) => `<p>${p}</p>`)
          .join(''),
      )
    : '';
  if (!cfg?.body && ldBody.length > bodyText.length) bodyText = ldBody;
  const imageEl = cfg?.image ? $(cfg.image).first() : null;
  const imageUrl = absolute(imageEl ? (imageEl.attr('content') ?? imageEl.attr('data-src') ?? imageEl.attr('src')) : (meta($, 'og:image', 'twitter:image') ?? ldImage(ld?.image)), pageUrl);
  const dateEl = cfg?.publishedAt ? $(cfg.publishedAt).first() : null;
  const publishedAt = parseDate(
    dateEl
      ? (dateEl.attr('datetime') ?? dateEl.attr('content') ?? dateEl.text())
      : (meta($, 'article:published_time', 'og:published_time', 'pubdate') ?? ld?.datePublished ?? $('time[datetime]').first().attr('datetime')),
  );
  return { title, intro: intro || null, bodyText, imageUrl, publishedAt };
}
