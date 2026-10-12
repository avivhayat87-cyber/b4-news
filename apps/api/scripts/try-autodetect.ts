// Dry run of automatic site setup against real addresses. Saves nothing.
//   npx tsx scripts/try-autodetect.ts https://www.example.co.il [more…]
import { loadConfig } from '../src/config';
import { createFetcher } from '../src/services/context';
import { autodetect } from '../src/services/scraper/autodetect';

const config = loadConfig({ NODE_ENV: 'development', SCRAPER_ALLOW_PRIVATE: 'false' } as NodeJS.ProcessEnv);
const fetch = createFetcher(config);

for (const url of process.argv.slice(2)) {
  const started = Date.now();
  const r = await autodetect(fetch, url, config.scraper.userAgent);
  console.log(`\n=== ${url} (${Math.round((Date.now() - started) / 1000)}s)`);
  console.log('name:', r.name);
  console.log('method:', r.config?.method ?? '—', '| feeds:', r.config?.listUrls.join(' , ') ?? '—');
  console.log('candidates:', r.candidates.slice(0, 5).map((c) => `${c.method} ${c.items}/${c.recent} ${c.url}`).join('\n            '));
  if (r.test) {
    console.log('test ok:', r.test.ok, '| items:', r.test.items.length, '| errors:', r.test.errors.join(' / ') || '—');
    console.log('first:', r.test.items[0]?.title);
    console.log('urls:', r.test.items.slice(0, 4).map((i) => i.url).join(' '));
    console.log('filter:', r.config?.selectorConfig.list.urlFilter ?? '—');
    console.log('article body chars:', r.test.article?.bodyText.length ?? 0);
  }
  if (r.notes.length) console.log('notes:', r.notes.join(' / '));
}
