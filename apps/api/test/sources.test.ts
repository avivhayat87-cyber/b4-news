// Adding sites from a list of links: automatic feed detection, testing, approval;
// robots.txt rules.
import { eq, sources } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '../src/services/scraper/robots';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let developer: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  developer = staffClient(ctx, await signInStaff(ctx, 'developer'));
});
afterAll(() => ctx.close());

describe('sites from a list of links', () => {
  it('creates each site, finds its feed, tests it, and leaves approval to the developer', async () => {
    const res = await editor.post('/sources/bulk', { urls: ['http://api.test/dev/sites/calc/', 'http://api.test/dev/sites/nothing-here/', 'http://api.test/dev/sites/calc/'] });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);

    const listed = await editor.get('/sources');
    expect(listed.body.filter((x: { setupRunning: boolean }) => x.setupRunning)).toHaveLength(2);
    await ctx.drain();

    const [calc] = await ctx.db.select().from(sources).where(eq(sources.baseUrl, 'http://api.test/dev/sites/calc/'));
    expect(calc).toMatchObject({ status: 'in_development', method: 'rss', name: 'כלכלה לדוגמה' });
    expect(calc!.listUrls).toEqual(['http://api.test/dev/sites/calc/feed.xml']);
    expect(calc!.lastTestPassedAt).not.toBeNull();

    const [missing] = await ctx.db.select().from(sources).where(eq(sources.baseUrl, 'http://api.test/dev/sites/nothing-here/'));
    expect(missing!.status).toBe('pending_dev');
    expect(missing!.devNotes).toContain('לא הצליחה');

    expect((await editor.post('/sources/approve-tested')).status).toBe(403);
    const approved = await developer.post('/sources/approve-tested');
    expect(approved.body.approved).toBe(1);

    const again = await editor.post('/sources/bulk', { urls: ['http://api.test/dev/sites/calc/'] });
    expect(again.body.skipped[0].reason).toContain('קיים');
  });
});

describe('robots.txt', () => {
  const txt = ['User-agent: *', 'Disallow: /premium/', 'Allow: /premium/free-*', 'Disallow: /*.pdf$', '', 'User-agent: OtherBot', 'Disallow: /', 'Sitemap: https://example.com/news-sitemap.xml'].join('\n');

  it('applies the longest matching rule for our agent', () => {
    const { rules, sitemaps } = parseRobots(txt, 'B4NewsBot/1.0');
    expect(isAllowed(rules, '/economy/article-1')).toBe(true);
    expect(isAllowed(rules, '/premium/story')).toBe(false);
    expect(isAllowed(rules, '/premium/free-story')).toBe(true);
    expect(isAllowed(rules, '/files/report.pdf')).toBe(false);
    expect(sitemaps).toEqual(['https://example.com/news-sitemap.xml']);
  });

  it('uses the group that names the agent', () => {
    expect(isAllowed(parseRobots(txt, 'OtherBot').rules, '/anything')).toBe(false);
  });
});
