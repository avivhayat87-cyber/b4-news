// What the extractor gets from a real article page, to tune a site's selectors. Saves nothing.
//   npx tsx scripts/inspect-article.ts https://www.example.co.il/article/123 [css-selector]
import * as cheerio from 'cheerio';
import { loadConfig } from '../src/config';
import { decodeText } from '../src/lib/safe-fetch';
import { createFetcher } from '../src/services/context';
import { extractArticle } from '../src/services/scraper/parse';

const config = loadConfig({ NODE_ENV: 'development', SCRAPER_ALLOW_PRIVATE: 'false' } as NodeJS.ProcessEnv);
const fetch = createFetcher(config);
const [url, selector] = process.argv.slice(2);
if (!url) throw new Error('usage: inspect-article.ts <url> [selector]');

const res = await fetch(url, { allowTypes: ['text/html', 'application/xhtml'] });
const html = decodeText(res);
const page = extractArticle(html, res.url);
console.log('status', res.status, '| html chars', html.length, '| final url', res.url);
console.log('title:', page.title);
console.log('intro:', page.intro?.slice(0, 160));
console.log('body chars:', page.bodyText.length, '| image:', page.imageUrl);
console.log('body start:', page.bodyText.slice(0, 300).replace(/\n/g, ' ⏎ '));

const $ = cheerio.load(html);
console.log('json-ld articleBody:', /"articleBody"/.test(html));
// The elements holding the most paragraph text: candidates for the body selector.
const scores = new Map<string, number>();
$('p').each((_, p) => {
  const parent = $(p).parent();
  const key = `${parent.prop('tagName')?.toLowerCase()}${parent.attr('id') ? `#${parent.attr('id')}` : ''}${parent.attr('class') ? `.${parent.attr('class')!.trim().split(/\s+/).join('.')}` : ''}`;
  scores.set(key, (scores.get(key) ?? 0) + $(p).text().trim().length);
});
console.log('top paragraph containers:');
for (const [k, v] of [...scores].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${v}\t${k}`);
if (selector) console.log(`\n${selector}:`, $(selector).text().replace(/\s+/g, ' ').trim().slice(0, 600));
