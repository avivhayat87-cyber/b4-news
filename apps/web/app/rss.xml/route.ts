// /rss.xml: the newest 50 articles as RSS 2.0, for feed readers, aggregators and partners.
// Linked from every page's head. Refreshed with the home page ("home" tag).
import { listLatest } from '@/lib/api';
import { SITE, articleHref } from '@/lib/site';

export const revalidate = 300;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET() {
  const articles = await listLatest(50);
  const abs = (path: string) => new URL(path, SITE.url).toString();
  const items = articles.map((a) => {
    const link = abs(articleHref(a));
    const image = a.image ? `<enclosure url="${xml(new URL(a.image.url, SITE.url).toString())}" type="image/webp" length="0"/>` : '';
    return `<item><title>${xml(a.title)}</title><link>${xml(link)}</link><guid isPermaLink="true">${xml(link)}</guid><pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate><category>${xml(a.category.name)}</category>${a.excerpt ? `<description>${xml(a.excerpt)}</description>` : ''}${image}</item>`;
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(SITE.name)}</title>
<link>${xml(abs('/'))}</link>
<description>${xml(SITE.description)}</description>
<language>he</language>
<atom:link href="${xml(abs('/rss.xml'))}" rel="self" type="application/rss+xml"/>
${items.join('\n')}
</channel>
</rss>
`;
  return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
