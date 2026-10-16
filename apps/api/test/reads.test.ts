// What the site tells about its readers and what it shows them before launch: the newsroom's
// own count of reads (numbers only), the editor's name under an article, the share picture,
// and a ticker that holds only the last day's news.
import { articles, eq, isNotNull, mediaAssets, users } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: ReturnType<typeof staffClient>;
let adminCookie: string;

beforeAll(async () => {
  ctx = await setup();
  adminCookie = await signInStaff(ctx, 'admin');
  admin = staffClient(ctx, adminCookie);
});
afterAll(() => ctx.close());

const pub = async (method: 'GET' | 'POST', url: string, payload?: object) => {
  const res = await ctx.app.inject({ method, url: `/api/v1/public${url}`, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

async function liveArticles(n: number) {
  const feed = await pub('GET', `/feed?limit=${n}`);
  return feed.body.items as { id: number; slug: string; title: string }[];
}

describe('reads', () => {
  it('counts each read with where it came from, and the dashboard shows today, the week, the sources and the most read', async () => {
    const [a, b] = await liveArticles(2);
    for (const from of ['search', 'search', 'app'] as const) expect((await pub('POST', '/reads', { articleId: a!.id, from })).status).toBe(204);
    expect((await pub('POST', '/reads', { articleId: b!.id, from: 'social' })).status).toBe(204);

    const { reads } = (await admin.get('/dashboard')).body;
    expect(reads.today).toBe(4);
    expect(reads.week).toHaveLength(7);
    expect(reads.week[6].reads).toBe(4);
    expect(reads.from).toMatchObject({ search: 2, app: 1, social: 1, direct: 0 });
    expect(reads.top[0]).toMatchObject({ id: a!.id, slug: a!.slug, reads: 3 });
    expect(reads.top[1]).toMatchObject({ id: b!.id, reads: 1 });
  });

  it('ignores an article that is not on the site, and refuses a kind of arrival it does not know', async () => {
    const before = (await admin.get('/dashboard')).body.reads.today;
    expect((await pub('POST', '/reads', { articleId: 987654321, from: 'direct' })).status).toBe(204);
    const [a] = await liveArticles(1);
    await ctx.db.update(articles).set({ status: 'unpublished' }).where(eq(articles.id, a!.id));
    expect((await pub('POST', '/reads', { articleId: a!.id, from: 'direct' })).status).toBe(204);
    await ctx.db.update(articles).set({ status: 'published' }).where(eq(articles.id, a!.id));
    expect((await admin.get('/dashboard')).body.reads.today).toBe(before);

    expect((await pub('POST', '/reads', { articleId: a!.id, from: 'https://www.google.com/' })).status).toBe(400);
  });
});

describe('the article page', () => {
  it("shows the editor's name only as the editor chose it, never the account's name", async () => {
    const [a] = await liveArticles(1);
    const [me] = await ctx.db.select().from(users).where(eq(users.email, 'admin@newsroom.test'));
    await ctx.db.update(articles).set({ editorId: me!.id }).where(eq(articles.id, a!.id));
    expect((await pub('GET', `/articles/${a!.slug}`)).body.editor).toBeNull();

    const named = await admin.patch(`/users/${me!.id}`, { bylineName: 'דנה לוי' });
    expect(named.body.bylineName).toBe('דנה לוי');
    expect((await pub('GET', `/articles/${a!.slug}`)).body.editor).toEqual({ name: 'דנה לוי' });

    expect((await admin.patch(`/users/${me!.id}`, { bylineName: '' })).body.bylineName).toBeNull();
    expect((await pub('GET', `/articles/${a!.slug}`)).body.editor).toBeNull();
  });

  it('gives link previews the 1200x630 JPEG of the main picture', async () => {
    const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#aa3344' } }).png().toBuffer();
    const boundary = '----b4reads';
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/media',
      headers: { cookie: adminCookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    const mediaId = JSON.parse(upload.body).id as string;
    const [media] = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId));
    expect(media!.variants.og).toMatch(/\.jpg$/);

    const [a] = await liveArticles(1);
    await ctx.db.update(articles).set({ heroMediaId: mediaId }).where(eq(articles.id, a!.id));
    const article = (await pub('GET', `/articles/${a!.slug}`)).body;
    expect(article.shareImage).toMatchObject({ width: 1200, height: 630 });
    expect(article.shareImage.url).toContain(media!.variants.og);
    expect(article.image.url).toMatch(/\.webp$/);
  });
});

describe('the breaking-news ticker', () => {
  it('holds only what was published in the last day, and is empty on a quiet day', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await ctx.db.update(articles).set({ publishedAt: twoDaysAgo, tickerAt: null });
    expect((await pub('GET', '/home')).body.breaking).toEqual([]);

    const [a, b, c] = await liveArticles(3);
    await ctx.db.update(articles).set({ publishedAt: new Date(Date.now() - 3_600_000) }).where(eq(articles.id, a!.id));
    await ctx.db.update(articles).set({ publishedAt: new Date(Date.now() - 7_200_000) }).where(eq(articles.id, c!.id));
    const breaking = async () => (await pub('GET', '/home')).body.breaking.map((x: { id: number }) => x.id);
    // Nothing marked: the latest of the last day.
    expect(await breaking()).toEqual([a!.id, c!.id]);

    // An old article marked for the ticker never comes back on it.
    await ctx.db.update(articles).set({ tickerAt: new Date() }).where(eq(articles.id, b!.id));
    expect(await breaking()).toEqual([a!.id, c!.id]);
    // A fresh marked one: the marked ones only.
    await ctx.db.update(articles).set({ tickerAt: new Date() }).where(eq(articles.id, c!.id));
    expect(await breaking()).toEqual([c!.id]);
    expect(await ctx.db.select({ id: articles.id }).from(articles).where(isNotNull(articles.tickerAt))).toHaveLength(2);
  });
});
