// The first addresses in a sitemap (following an index into its first child), to see a site's URL pattern. Saves nothing.
//   npx tsx scripts/list-sitemap.ts https://www.example.co.il/sitemap.xml
import { loadConfig } from '../src/config';
import { decodeText } from '../src/lib/safe-fetch';
import { createFetcher } from '../src/services/context';

const fetch = createFetcher(loadConfig({ NODE_ENV: 'development', SCRAPER_ALLOW_PRIVATE: 'false' } as NodeJS.ProcessEnv));
const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => m[1]!.trim());

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('usage: list-sitemap.ts <sitemap-url>');
  const xml = decodeText(await fetch(url));
  const entries = locs(xml);
  console.log(/<sitemapindex/i.test(xml) ? 'index' : 'urlset', entries.length, 'entries');
  console.log(entries.slice(0, 10).join('\n'));
  // Sections, by the first two path segments (to pick a filter such as "/business").
  const sections = new Map<string, number>();
  for (const e of entries) {
    const p = new URL(e).pathname.split('/').filter(Boolean).slice(0, 2).join('/');
    sections.set(p.replace(/\/?article-?\d+.*$/i, ''), (sections.get(p.replace(/\/?article-?\d+.*$/i, '')) ?? 0) + 1);
  }
  console.log('\nsections:', [...sections].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k || '/'} ${v}`).join(' | '));
  if (/<sitemapindex/i.test(xml) && entries[0]) {
    const child = locs(decodeText(await fetch(entries[0])));
    console.log(`\nfirst child (${entries[0]}): ${child.length} entries`);
    console.log(child.slice(0, 15).join('\n'));
  }
}

void main();
