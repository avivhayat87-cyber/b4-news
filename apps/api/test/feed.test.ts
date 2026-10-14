// "הפיד שלי": the reader's topics only, with the conversation (the editors' pick or the most liked
// comment, and the count); an article with no comments invites the first; three orders.
import { articles, categories, desc, eq, inArray } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInReader } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let reader: string;
let other: string;

beforeAll(async () => {
  ctx = await setup();
  reader = await signInReader(ctx, 'feed@example.com', 'קורא פיד');
  other = await signInReader(ctx, 'other@example.com', 'מגיבה');
  // Fresh articles in two topics.
  const rows = await ctx.db
    .select({ id: articles.id, slug: categories.slug })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .where(inArray(categories.slug, ['real-estate', 'hi-tech']))
    .orderBy(desc(articles.publishedAt));
  await ctx.db
    .update(articles)
    .set({ publishedAt: new Date(Date.now() - 2 * 3600_000) })
    .where(inArray(articles.id, rows.map((r) => r.id)));
});
afterAll(() => ctx.close());

const get = async (cookie: string | null, url: string) => {
  const r = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });
  return { status: r.statusCode, body: r.json() };
};
const send = (cookie: string, method: 'POST' | 'PUT', url: string, payload: object) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { cookie, origin: ORIGIN }, payload });

describe('my feed', () => {
  it('is for signed-in readers, in their topics, with the conversation around each article', async () => {
    expect((await get(null, '/auth/reader/feed')).status).toBe(401);
    await send(reader, 'PUT', '/auth/reader/digest', { sections: ['real-estate'], hour: 7, frequency: 'daily', email: false, push: false });

    const page = (await get(reader, '/auth/reader/feed?mode=new')).body;
    expect(page.sections).toEqual(['real-estate']);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i: { article: { category: { slug: string } } }) => i.article.category.slug === 'real-estate')).toBe(true);
    const first = page.items[0];
    expect(first).toMatchObject({ commentCount: 0, topComment: null }); // an invitation to be the first

    // A conversation on it: the most liked comment leads.
    const a = (await send(other, 'POST', `/articles/${first.article.id}/comments`, { body: 'תגובה ראשונה על הנדל"ן' })).json();
    const b = (await send(other, 'POST', `/articles/${first.article.id}/comments`, { body: 'תגובה שנייה, יותר טובה' })).json();
    await send(reader, 'POST', `/comments/${b.id}/like`, {});
    await send(reader, 'POST', `/articles/${first.article.id}/comments`, { body: 'מסכים', parentId: b.id });
    const forYou = (await get(reader, '/auth/reader/feed?mode=for-you&seed=42')).body;
    const item = forYou.items.find((i: { article: { id: number } }) => i.article.id === first.article.id);
    expect(item).toMatchObject({ commentCount: 3, topComment: { id: b.id, author: 'מגיבה', likeCount: 1, replies: 1 } });
    expect(a.id).not.toBe(b.id);
    // The talked-about article leads "popular".
    expect((await get(reader, '/auth/reader/feed?mode=popular')).body.items[0].article.id).toBe(first.article.id);
  });

  it('shows everything when no topic was chosen', async () => {
    await send(reader, 'PUT', '/auth/reader/digest', { sections: [], hour: 7, frequency: 'daily', email: false, push: false });
    const slugs = new Set((await get(reader, '/auth/reader/feed?mode=new')).body.items.map((i: { article: { category: { slug: string } } }) => i.article.category.slug));
    expect(slugs.size).toBeGreaterThan(1);
  });
});
