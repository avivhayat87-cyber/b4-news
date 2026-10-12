// Article extraction from real-world page shapes, and narrowing a whole-site list to one section.
import { describe, expect, it } from 'vitest';
import { type Fetcher, listItems } from '../src/services/scraper/collect';
import { extractArticle } from '../src/services/scraper/parse';

const paragraphs = Array.from({ length: 6 }, (_, i) => `<p>פסקה ${i + 1} של הכתבה, עם מספיק מילים כדי להיראות כמו טקסט עיתונאי אמיתי על השווקים והכלכלה.</p>`).join('');

describe('extractArticle', () => {
  it('keeps the article when the whole page is one form (ASP.NET sites such as Globes)', () => {
    const html = `<html><head><meta property="og:title" content="כותרת הכתבה"></head><body>
      <form id="aspnetForm" action="/news/article.aspx">
        <div class="menu"><ul><li>מבזקים</li><li>שוק ההון</li></ul></div>
        <div class="articleInner">${paragraphs}</div>
        <form class="search"><p>חיפוש</p><input name="q"></form>
      </form></body></html>`;
    const page = extractArticle(html, 'https://news.example.co.il/news/article.aspx?did=1');
    expect(page.bodyText).toContain('פסקה 1 של הכתבה');
    expect(page.bodyText).toContain('פסקה 6 של הכתבה');
    expect(page.bodyText).not.toContain('חיפוש');
  });

  it('keeps only the section articles when the filter has several parts', async () => {
    const urls = ['/economy', '/economy/israel', '/economy/israel/article-11', '/news/law/article-12', '/economy/tech/article-13'].map((p) => `https://news.example.co.il${p}`);
    const sitemap = `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
    const fetch: Fetcher = async (url) => ({ url, status: 200, contentType: 'application/xml', body: Buffer.from(sitemap) });
    const spec = (urlFilter: string) => ({ name: 'site', method: 'sitemap' as const, listUrls: ['https://news.example.co.il/sitemap.xml'], config: { list: { maxItems: 40, urlFilter }, article: { remove: [] }, categoryRules: [] } });
    const found = async (filter: string) => (await listItems(fetch, spec(filter), null)).map((i) => new URL(i.url).pathname).sort();
    expect(await found('/economy')).toEqual(['/economy', '/economy/israel', '/economy/israel/article-11', '/economy/tech/article-13']);
    expect(await found('/economy/ /article-')).toEqual(['/economy/israel/article-11', '/economy/tech/article-13']);
  });

  it('follows the article sitemaps, not the tag and category ones that change more often', async () => {
    const index = `<?xml version="1.0"?><urlset>${[
      ['SiteMap_Tags.xml', '2026-10-12T22:09'],
      ['SiteMap_Categories.xml', '2026-10-12T22:13'],
      ['SiteMap_Articles_54.xml', '2026-10-12T22:07'],
    ]
      .map(([f, at]) => `<url><loc>https://news.example.co.il/SitemapFiles/${f}</loc><lastmod>${at}</lastmod></url>`)
      .join('')}</urlset>`;
    const child = (u: string) =>
      u.includes('Articles')
        ? '<urlset><url><loc>https://news.example.co.il/economy/israel/article-1</loc></url></urlset>'
        : '<urlset><url><loc>https://news.example.co.il/tags/economy</loc></url></urlset>';
    const fetch: Fetcher = async (url) => ({ url, status: 200, contentType: 'application/xml', body: Buffer.from(url.endsWith('sitemap.xml') ? index : child(url)) });
    const spec = { name: 'site', method: 'sitemap' as const, listUrls: ['https://news.example.co.il/sitemap.xml'], config: { list: { maxItems: 40 }, article: { remove: [] }, categoryRules: [] } };
    expect((await listItems(fetch, spec, null)).map((i) => i.url)).toEqual(['https://news.example.co.il/economy/israel/article-1']);
  });

  it('still drops sign-up forms inside the article', () => {
    const html = `<html><body><article>${paragraphs}<form class="signup"><p>הירשמו לעדכונים</p><input name="email"></form></article></body></html>`;
    const page = extractArticle(html, 'https://news.example.co.il/a/1');
    expect(page.bodyText).toContain('פסקה 3');
    expect(page.bodyText).not.toContain('הירשמו');
  });
});
