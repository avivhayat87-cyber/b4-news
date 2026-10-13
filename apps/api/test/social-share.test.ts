// The social page: published articles -> AI kit -> branded post and story ->
// publishing to the chosen accounts (prepared for manual posting without tokens).
import { articleDrafts, articleSharePosts, articles, desc, eq, jobs, socialAccounts, socialPackages, socialPosts, users } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let viewer: ReturnType<typeof staffClient>;
let articleId: number;

beforeAll(async () => {
  ctx = await setup();
  await ctx.seedSources(); // sample social accounts (no tokens)
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
  const [latest] = await ctx.db.select({ id: articles.id }).from(articles).orderBy(desc(articles.publishedAt)).limit(1);
  articleId = latest!.id;
});
afterAll(() => ctx.close());

describe('social page', () => {
  it('lists the published articles that have not gone out yet', async () => {
    const res = await editor.get('/social/articles?filter=pending');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(20);
    expect(res.body.pendingCount).toBe(res.body.total);
    expect(res.body.items[0].articleId).toBe(articleId);
    expect(res.body.items[0].hasKit).toBe(false);
    const empty = await editor.get(`/social/articles/${articleId}`);
    expect(empty.body.version).toBe(0);
    expect(empty.body.rendered.feed).toBeNull();
  });

  it('writes a kit with the AI and renders a 4:5 post and a 9:16 story', async () => {
    expect((await viewer.post('/social/generate', { articleIds: [articleId] })).status).toBe(403);
    const queued = await editor.post('/social/generate', { articleIds: [articleId] });
    expect(queued.status).toBe(202);
    expect((await editor.get('/social/articles?filter=pending')).body.items[0].busy).toBe(true);
    await ctx.drain();
    const failed = await ctx.db.select({ error: jobs.lastError }).from(jobs).where(eq(jobs.kind, 'social.kit'));
    expect(failed.map((j) => j.error)).toEqual([null]);

    const share = (await editor.get(`/social/articles/${articleId}`)).body;
    expect(share.headline.length).toBeGreaterThan(5);
    expect(share.hook.length).toBeGreaterThan(5);
    expect(share.caption).toContain('?');
    expect(share.hashtags.length).toBeGreaterThan(0);
    expect(share.version).toBeGreaterThan(0);
    for (const [format, w, h] of [
      ['feed', 1080, 1350],
      ['story', 1080, 1920],
    ] as const) {
      const key = String(share.rendered[format]).replace('http://media.test/', '');
      const meta = await sharp(await ctx.storage.get(key)).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', w, h]);
    }
    // Per-platform text: the link goes in the first comment on Facebook, inline on Telegram.
    const accounts = await ctx.db.select().from(socialAccounts);
    const fb = accounts.find((a) => a.platform === 'facebook')!;
    const tg = accounts.find((a) => a.platform === 'telegram')!;
    expect(share.texts[fb.id]).toContain('בתגובה הראשונה');
    expect(share.texts[fb.id]).not.toContain('/a/');
    expect(share.texts[tg.id]).toContain(`/a/${articleId}?utm_source=telegram`);
  });

  it('saves the editor’s text, re-renders, and refuses stale versions', async () => {
    const share = (await editor.get(`/social/articles/${articleId}`)).body;
    const input = { version: share.version, template: 'breaking', kicker: 'מבזק', headline: 'כותרת חדשה לפוסט', hook: 'משפט פתיחה.', caption: 'הסבר קצר. מה דעתכם?', hashtags: ['#כלכלה', 'ריבית בנק'] };
    const saved = await editor.put(`/social/articles/${articleId}`, input);
    expect(saved.status).toBe(200);
    expect(saved.body.template).toBe('breaking');
    expect(saved.body.hashtags).toEqual(['כלכלה', 'ריבית_בנק']);
    expect(saved.body.rendered.feed).not.toBe(share.rendered.feed);
    await expect(ctx.storage.get(String(share.rendered.feed).replace('http://media.test/', ''))).rejects.toThrow(); // old file removed
    expect((await editor.put(`/social/articles/${articleId}`, input)).status).toBe(409);
  });

  it('publishes to the chosen accounts once, and moves the article to "shared"', async () => {
    const targets = (await editor.get('/social/targets')).body as { id: string; platform: string; connected: boolean }[];
    const chosen = targets.filter((t) => t.platform === 'facebook' || t.platform === 'telegram').map((t) => t.id);
    expect(chosen).toHaveLength(2);
    expect((await editor.post('/social/publish', { articleIds: [articleId + 999], formats: ['feed'], accountIds: chosen })).status).toBe(422);
    const res = await editor.post('/social/publish', { articleIds: [articleId], formats: ['feed', 'story'], accountIds: chosen });
    expect(res.status).toBe(202);
    await ctx.drain();
    const posts = await ctx.db.select().from(articleSharePosts).where(eq(articleSharePosts.articleId, articleId));
    expect(posts).toHaveLength(4);
    // No tokens in tests: everything is prepared for manual posting, nothing is sent.
    expect(posts.every((p) => p.status === 'skipped' && p.lastError)).toBe(true);

    // A post that went out is never sent again, and the article leaves the "pending" list.
    const marked = await editor.post(`/social/articles/${articleId}/posted`, { accountId: posts[0]!.socialAccountId, format: posts[0]!.format });
    expect(marked.status).toBe(204); // posted by hand
    expect((await editor.post(`/social/articles/${articleId}/posted`, { accountId: posts[0]!.socialAccountId, format: posts[0]!.format })).status).toBe(404);
    await editor.post('/social/publish', { articleIds: [articleId], formats: ['feed', 'story'], accountIds: chosen });
    await ctx.drain();
    const [again] = await ctx.db.select().from(articleSharePosts).where(eq(articleSharePosts.id, posts[0]!.id));
    expect(again!.status).toBe('posted');
    const pending = (await editor.get('/social/articles?filter=pending')).body;
    expect(pending.items.some((i: { articleId: number }) => i.articleId === articleId)).toBe(false);
    const shared = (await editor.get('/social/articles?filter=shared')).body;
    expect(shared.items.map((i: { articleId: number }) => i.articleId)).toEqual([articleId]);
    expect(shared.items[0].posts.length).toBe(4);
  });

  it('counts posts made from the editor’s social module as shared', async () => {
    const [other] = await ctx.db.select({ id: articles.id }).from(articles).orderBy(desc(articles.publishedAt)).offset(1).limit(1);
    const before = (await editor.get('/social/articles?filter=pending')).body.pendingCount;
    // The editor flow keys posts by draft; here only the article link matters.
    const [account] = await ctx.db.select().from(socialAccounts).limit(1);
    const [user] = await ctx.db.select({ id: users.id }).from(users).limit(1);
    const [draft] = await ctx.db.insert(articleDrafts).values({ origin: 'manual_write', status: 'editing', title: 'x', createdBy: user!.id }).returning({ id: articleDrafts.id });
    await ctx.db.insert(socialPackages).values({ draftId: draft!.id });
    await ctx.db.insert(socialPosts).values({ draftId: draft!.id, socialAccountId: account!.id, articleId: other!.id, status: 'posted', postedAt: new Date() });
    expect((await editor.get('/social/articles?filter=pending')).body.pendingCount).toBe(before - 1);
  });
});
