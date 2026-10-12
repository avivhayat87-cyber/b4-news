// What a source's list returns, before and after its filter. Saves nothing.
//   npx tsx scripts/try-list.ts <method rss|sitemap> <list-url> ["url filter"]
import { loadConfig } from '../src/config';
import { createFetcher } from '../src/services/context';
import { listItems, listPage } from '../src/services/scraper/collect';

const fetch = createFetcher(loadConfig({ NODE_ENV: 'development', SCRAPER_ALLOW_PRIVATE: 'false' } as NodeJS.ProcessEnv));

async function main() {
  const [method, url, urlFilter] = process.argv.slice(2) as ['rss' | 'sitemap', string, string | undefined];
  const spec = { name: 'try', method, listUrls: [url], config: { list: { maxItems: 40, urlFilter }, article: { remove: [] }, categoryRules: [] } };
  const raw = await listPage(fetch, spec, url);
  console.log('listed', raw.length, '| with a date', raw.filter((i) => i.publishedAt).length);
  console.log('newest dates:', raw.map((i) => i.publishedAt?.toISOString()).filter(Boolean).sort().slice(-3));
  for (const part of urlFilter?.toLowerCase().split(/\s+/).filter(Boolean) ?? []) {
    const hits = raw.filter((i) => i.url.toLowerCase().includes(part));
    console.log(`contain "${part}":`, hits.length, hits.slice(0, 3).map((i) => `${i.url} ${i.publishedAt?.toISOString()}`));
  }
  const kept = await listItems(fetch, spec, null);
  console.log(`after filter "${urlFilter ?? ''}":`, kept.length);
  for (const i of kept.slice(0, 8)) console.log(' ', i.publishedAt?.toISOString() ?? '—', i.url, i.title ?? '');
}

void main();
