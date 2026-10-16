// /news-sitemap.xml: Google News' sitemap, the articles of the last two days (Google reads only
// those), so a new article is found within minutes. Refreshed with the home page ("home" tag).
import { listLatest } from '@/lib/api';
import { SITE, articleHref } from '@/lib/site';

export const revalidate = 300;

const TWO_DAYS_MS = 2 * 86_400_000;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET() {
  const since = Date.now() - TWO_DAYS_MS;
  const articles = (await listLatest(500)).filter((a) => new Date(a.publishedAt).getTime() >= since);
  const urls = articles.map(
    (a) =>
      `<url><loc>${xml(new URL(articleHref(a), SITE.url).toString())}</loc><news:news><news:publication><news:name>${xml(SITE.name)}</news:name><news:language>he</news:language></news:publication><news:publication_date>${a.publishedAt}</news:publication_date><news:title>${xml(a.title)}</news:title></news:news></url>`,
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
