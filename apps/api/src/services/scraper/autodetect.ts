// Automatic trigger setup from a site's address: find its feeds (declared in the
// page, at the usual paths) and news sitemaps (from robots.txt), keep the one
// that lists the most dated articles, and test it end to end.
import { type ConfigureSourceInput, SelectorConfig, type SourceTestResult } from '@b4/shared';
import * as cheerio from 'cheerio';
import { decodeText } from '../../lib/safe-fetch';
import type { Fetcher } from './collect';
import { listPage } from './collect';
import { absolute, cleanText } from './parse';
import { RobotsCache } from './robots';
import { testSource } from './test-source';

const FEED_PATHS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/rss/', '/feeds/rss', '/rss/all'];

type Candidate = { url: string; method: 'rss' | 'sitemap'; items: number; dated: number; recent: number };

export type AutodetectResult = {
  name: string | null;
  /** The page's declared language (ISO 639-1), e.g. "en". */
  language: string | null;
  config: ConfigureSourceInput | null;
  test: SourceTestResult | null;
  candidates: Candidate[];
  notes: string[];
};

const PROBE_CONFIG = SelectorConfig.parse({ list: { maxItems: 200 } });

/** How useful a feed or sitemap is: how many articles it lists, and how many from the last week. */
async function evaluate(fetch: Fetcher, url: string, method: 'rss' | 'sitemap'): Promise<Candidate | null> {
  try {
    const items = await listPage(fetch, { name: '', method, listUrls: [url], config: PROBE_CONFIG }, url);
    // A sitemap whose entries are not pages with titles or dates is not a news sitemap.
    const usable = items.filter((i) => !/\.xml(\?|$)/i.test(i.url));
    if (usable.length === 0) return null;
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      url,
      method,
      items: usable.length,
      dated: usable.filter((i) => i.publishedAt).length,
      recent: usable.filter((i) => i.publishedAt && i.publishedAt.getTime() > weekAgo).length,
    };
  } catch {
    return null;
  }
}
/** International sites keep their own-language feeds; Israeli sites skip foreign-language editions. */
export async function autodetect(fetch: Fetcher, siteUrl: string, userAgent: string, region: 'local' | 'international' = 'local'): Promise<AutodetectResult> {
  const notes: string[] = [];
  const origin = new URL(siteUrl).origin;
  const found = new Map<string, 'rss' | 'sitemap'>();
  let name: string | null = null;
  let language: string | null = null;

  try {
    const res = await fetch(siteUrl, { allowTypes: ['text/html', 'application/xhtml'] });
    const $ = cheerio.load(decodeText(res));
    name = cleanText($('meta[property="og:site_name"]').attr('content') ?? $('title').first().text()).split(/[|\-–—]/)[0]?.trim() || null;
    language = /^([a-z]{2})\b/i.exec($('html').attr('lang') ?? $('meta[http-equiv="content-language"]').attr('content') ?? '')?.[1]?.toLowerCase() ?? null;
    $('link[rel="alternate"]').each((_, el) => {
      const type = ($(el).attr('type') ?? '').toLowerCase();
      const href = absolute($(el).attr('href'), res.url);
      if (href && (type.includes('rss') || type.includes('atom'))) found.set(href, 'rss');
    });
    // Links to feeds in the page itself ("RSS" pages).
    $('a[href]').each((_, el) => {
      const href = absolute($(el).attr('href'), res.url);
      if (href && /(\/rss|\/feed|\.rss|\.xml)(\/|\?|$)/i.test(href) && new URL(href).origin === origin && found.size < 25) found.set(href, 'rss');
    });
  } catch (e) {
    notes.push(`לא הצלחנו לפתוח את דף הבית (${e instanceof Error ? e.message : 'שגיאה'}).`);
  }

  if (found.size === 0) for (const p of FEED_PATHS) found.set(`${origin}${p}`, 'rss');
  const robots = new RobotsCache(fetch, userAgent);
  const sitemaps = await robots.sitemaps(origin);
  for (const sm of sitemaps.slice(0, 8)) found.set(sm, 'sitemap');
  if (!sitemaps.length) found.set(`${origin}/sitemap.xml`, 'sitemap');

  // Other-language editions (English, Arabic, Russian) are not what a Hebrew site wants.
  const foreign = /([?&](lang|language)=(en|ar|ru))|\/(en|english|ar|arabic|ru)(\/|$)/i;
  const candidates = (await Promise.all([...found].filter(([url]) => region === 'international' || !foreign.test(url)).slice(0, 30).map(([url, method]) => evaluate(fetch, url, method)))).filter(
    (c): c is Candidate => Boolean(c && c.items > 0),
  );
  // RSS first when it is alive (it carries a summary per article and often one feed per section);
  // otherwise the sitemap with the most recent, dated items.
  const liveRss = candidates.some((c) => c.method === 'rss' && c.recent >= 5);
  const rank = (c: Candidate) => (liveRss && c.method === 'rss' ? 1 : 0);
  candidates.sort((a, b) => rank(b) - rank(a) || b.recent - a.recent || b.dated - a.dated || b.items - a.items);
  const best = candidates[0];
  if (!best) {
    notes.push('לא נמצא פיד RSS או sitemap. האתר צריך הגדרה ידנית של עמוד רשימה וסלקטורים.');
    return { name, language, config: null, test: null, candidates, notes };
  }

  // Up to three feeds of the same kind (for example a site's economy and real-estate feeds).
  const listUrls = candidates.filter((c) => c.method === best.method && c.recent > 0).slice(0, 3).map((c) => c.url);
  const config: ConfigureSourceInput = {
    method: best.method,
    listUrls: listUrls.length ? listUrls : [best.url],
    defaultCategory: null,
    scrapeIntervalMin: 30,
    devNotes: `הוגדר אוטומטית (${best.method === 'rss' ? 'RSS' : 'sitemap'}). ${candidates.length} מקורות נבדקו.`,
    selectorConfig: { list: { maxItems: 40 }, article: { remove: [] }, categoryRules: [] },
  };
  // A section address (e.g. /economy) with a whole-site sitemap: keep only that section's articles.
  const section = new URL(siteUrl).pathname.replace(/\/+$/, '');
  if (section && best.method === 'sitemap') {
    config.selectorConfig.list.urlFilter = section;
    config.devNotes += ` מסונן לכתובות שמכילות "${section}".`;
  }
  const test = await testSource(fetch, name ?? origin, config);
  return { name, language, config, test, candidates, notes };
}
