// Comments as a conversation: likes (one each, never your own), "@name" replies, the editors'
// pick, "top" and "new" sorting, and what readers are told: the bell at once, the phone when
// signed in to the app, and one mail an hour later with what they haven't seen.
import { articles, desc, eq, jobs, readers } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInReader, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let dana: string;
let yoav: string;
let articleId: number;

beforeAll(async () => {
  ctx = await setup();
  dana = await signInReader(ctx, 'dana@example.com', 'דנה');
  yoav = await signInReader(ctx, 'yoav@example.com', 'יואב');
  [{ id: articleId }] = (await ctx.db.select({ id: articles.id }).from(articles).orderBy(desc(articles.publishedAt)).limit(1)) as [{ id: number }];
});
afterAll(() => ctx.close());

const as = (cookie: string) => ({
  get: async (url: string) => {
    const r = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
    return { status: r.statusCode, body: r.json() };
  },
  send: async (method: 'POST' | 'DELETE' | 'PUT', url: string, payload?: object) => {
    const r = await ctx.app.inject({ method, url: `/api/v1${url}`, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  },
});

describe('a conversation', () => {
  let first: string;
  let reply: string;

  it('notifies the author of the comment a reply answers, and shows whom it answers', async () => {
    first = (await as(dana).send('POST', `/articles/${articleId}/comments`, { body: 'הריבית תעלה עוד לפני סוף השנה' })).body.id;
    reply = (await as(yoav).send('POST', `/articles/${articleId}/comments`, { body: 'לא בטוח, האינפלציה יורדת', parentId: first })).body.id;
    // A reply to the reply: same thread, "@יואב", and Yoav is the one told.
    const third = await as(dana).send('POST', `/articles/${articleId}/comments`, { body: 'יורדת, אבל לאט', parentId: reply });
    expect(third.body).toMatchObject({ parentId: first, replyTo: { id: reply, displayName: 'יואב' } });

    const bell = (await as(dana).get('/auth/reader/notifications')).body;
    expect(bell.unread).toBe(1);
    expect(bell.items[0]).toMatchObject({ kind: 'reply', actor: 'יואב', read: false, article: { id: articleId } });
    expect((await as(yoav).get('/auth/reader/notifications')).body.items[0]).toMatchObject({ kind: 'reply', actor: 'דנה' });
  });

  it('likes once each, never your own, gathered into one notice', async () => {
    expect((await as(dana).send('POST', `/comments/${first}/like`)).status).toBe(400);
    expect((await as(yoav).send('POST', `/comments/${first}/like`)).body).toEqual({ likeCount: 1, likedByMe: true });
    expect((await as(yoav).send('POST', `/comments/${first}/like`)).body).toEqual({ likeCount: 1, likedByMe: true });
    expect((await as(yoav).send('DELETE', `/comments/${first}/like`)).body).toEqual({ likeCount: 0, likedByMe: false });
    await as(yoav).send('POST', `/comments/${first}/like`);
    const likes = (await as(dana).get('/auth/reader/notifications')).body.items.filter((n: { kind: string }) => n.kind === 'like');
    expect(likes).toHaveLength(1);
    const list = (await as(yoav).get(`/public/articles/${articleId}/comments`)).body;
    expect(list.items.find((c: { id: string }) => c.id === first)).toMatchObject({ likeCount: 1, likedByMe: true, isMine: false });
  });

  it('sorts the editors\' picks first, then the most liked; "new" is by time', async () => {
    const later = (await as(yoav).send('POST', `/articles/${articleId}/comments`, { body: 'שאלה טובה, מחכה לנתונים' })).body.id;
    let top = (await as(yoav).get(`/public/articles/${articleId}/comments?sort=top`)).body.items.filter((c: { parentId: string | null }) => !c.parentId);
    expect(top[0].id).toBe(first); // one like beats none
    const newest = (await as(yoav).get(`/public/articles/${articleId}/comments?sort=new`)).body.items.filter((c: { parentId: string | null }) => !c.parentId);
    expect(newest[0].id).toBe(later);

    const editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
    expect((await editor.post(`/comments/${later}/pick`, { picked: true })).status).toBe(204);
    top = (await as(yoav).get(`/public/articles/${articleId}/comments?sort=top`)).body.items.filter((c: { parentId: string | null }) => !c.parentId);
    expect(top[0]).toMatchObject({ id: later, picked: true });
    expect((await as(yoav).get('/auth/reader/notifications')).body.items[0]).toMatchObject({ kind: 'pick', actor: null });

    // The CMS sees a reader's comments, with likes and picks.
    const [y] = await ctx.db.select({ id: readers.id }).from(readers).where(eq(readers.email, 'yoav@example.com'));
    const mine = (await editor.get(`/readers/${y!.id}/comments`)).body;
    expect(mine.find((c: { id: string }) => c.id === later)).toMatchObject({ picked: true, isReply: false });
  });

  it('mails what is still unseen, once, an hour later; and one click stops the mails', async () => {
    expect((await as(dana).send('POST', '/auth/reader/notifications/read', {})).status).toBe(204); // Dana saw hers on the site
    expect((await as(dana).get('/auth/reader/notifications')).body.unread).toBe(0);
    await ctx.drain(); // the immediate jobs: pushes (none in tests) and the mail scheduled for later
    const [scheduled] = await ctx.db.select().from(jobs).where(eq(jobs.kind, 'reader.digest'));
    expect(scheduled!.runAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    await ctx.db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.kind, 'reader.digest'));
    await ctx.drain();

    expect(ctx.mailer.lastTo('dana@example.com')?.subject ?? '').not.toMatch(/הגיב|אהב|עדכונים/); // all seen already
    const mail = ctx.mailer.lastTo('yoav@example.com')!;
    expect(mail.subject).toMatch(/עדכונים|הגיב|נבחרה/);
    expect(mail.text).toContain('/account');
    const off = mail.headers!['List-Unsubscribe']!.slice(1, -1).replace(ctx.config.publicApiUrl, '');
    expect((await ctx.app.inject({ method: 'POST', url: off, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })).statusCode).toBe(204);
    expect((await as(yoav).get('/auth/reader/prefs')).body).toEqual({ notifyEmail: false, notifyPush: true });
    expect((await as(yoav).send('PUT', '/auth/reader/prefs', { notifyEmail: true, notifyPush: false })).body).toEqual({ notifyEmail: true, notifyPush: false });
  });
});
